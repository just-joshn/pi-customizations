import { describe, expect, test } from 'vitest';
import { assistantLine, printing } from './subagent-child-output.ts';
import { fakePi } from './subagent-fake-pi.ts';
import { loadSubagent, makeCtx, textOf, useWorkspace, writeAgent } from './subagent-host.ts';

const workspace = useWorkspace();
const ctx = () => makeCtx(workspace().project);
const ALL_AGENTS = 'ci-watcher (package), comment-sicko (package), poteto-agent (package), scout (package), thermo-nuclear-code-quality-review (package), worker (package)';

describe('registering the subagent tool', () => {
  test('registers one tool that describes its modes, agent scopes and wake', () => {
    const { tool } = loadSubagent();
    expect(tool.name).toBe('subagent');
    expect(tool.description).toContain('single (agent + task), parallel (tasks array), chain');
    expect(tool.description).toContain(`from ${workspace().root}/agent/agents`);
    expect(tool.description).toContain('agentScope: "both"');
    expect(tool.description).toContain('With wake set, it returns a job id at once');
  });
});

describe('marking a subagent result as an error', () => {
  const hook = (event: unknown) => loadSubagent().fire('tool_result', event, ctx());

  test('marks a subagent result whose details say error', () => {
    expect(hook({ toolName: 'subagent', details: { isError: true } })).toEqual({ isError: true });
  });

  test('leaves other tools, clean results and results without details alone', () => {
    expect(hook({ toolName: 'bash', details: { isError: true } })).toBeUndefined();
    expect(hook({ toolName: 'subagent', details: { isError: false } })).toBeUndefined();
    expect(hook({ toolName: 'subagent' })).toBeUndefined();
  });

  test('a failing child makes the tool result an error, which Pi then reports', async () => {
    const subagent = loadSubagent();
    fakePi.onChild((child) => child.exit(1));
    const result = await subagent.call({ agent: 'scout', task: 'x' }, ctx());
    expect(subagent.fire('tool_result', { toolName: 'subagent', details: result.details }, ctx())).toEqual({ isError: true });
  });
});

describe('a call with the wrong mode', () => {
  test('with no mode, says to provide exactly one and lists the agents', async () => {
    const result = await loadSubagent().call({}, ctx());
    expect(textOf(result)).toBe(`Invalid parameters. Provide exactly one mode.\nAvailable agents: ${ALL_AGENTS}`);
    expect(result.details).toMatchObject({ mode: 'single', isError: true });
    expect(fakePi.children()).toHaveLength(0);
  });

  test('with two modes, says the same and lists user agents too', async () => {
    writeAgent(workspace().userAgents, 'mine');
    const result = await loadSubagent().call({ agent: 'scout', task: 'x', tasks: [{ agent: 'scout', task: 'y' }] }, ctx());
    expect(textOf(result)).toContain('Invalid parameters. Provide exactly one mode.');
    expect(textOf(result)).toContain('mine (user)');
    expect(fakePi.children()).toHaveLength(0);
  });

  test('with an agent but no task, is not a single call', async () => {
    expect(textOf(await loadSubagent().call({ agent: 'scout' }, ctx()))).toContain('Invalid parameters');
  });

  test('with parameters of the wrong shape, throws before anything runs', () => {
    expect(() => loadSubagent().call({ agent: 5 }, ctx())).toThrow();
    expect(() => loadSubagent().call({ tasks: [{ agent: 'a' }] }, ctx())).toThrow();
    expect(() => loadSubagent().call({ thinking: 'extreme' }, ctx())).toThrow();
    expect(fakePi.children()).toHaveLength(0);
  });
});

describe('what the tool keeps of the child output', () => {
  const run = async (...lines: string[]) => {
    fakePi.onChild(printing(...lines));
    return loadSubagent().call({ agent: 'scout', task: 'x' }, ctx());
  };

  test('keeps the child message whole, with every field it came with', async () => {
    const message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'hi' }],
      api: 'a',
      model: 'm',
      usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 5, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 0.25 } },
      stopReason: 'stop',
      timestamp: 1,
    };
    const result = await run(JSON.stringify({ type: 'message_end', message }));
    expect(result.details?.results[0]).toMatchObject({ messages: [message], usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.25, contextTokens: 5, turns: 1 }, model: 'm' });
  });

  test('keeps user and tool result messages with their extra fields', async () => {
    const toolResult = { zeta: 1, role: 'toolResult', alpha: { deep: [1] } };
    const result = await run(JSON.stringify({ type: 'message_end', message: toolResult }), assistantLine('end'));
    const [first] = result.details?.results[0]?.messages ?? [];
    expect(first).toStrictEqual(toolResult);
    expect(textOf(result)).toBe('end');
  });

  test.for<[string, string]>([
    ['a JSON number', '5'],
    ['a JSON string', '"text"'],
    ['a JSON list', '[]'],
    ['an empty object', '{}'],
    ['an event that is not a message end', JSON.stringify({ type: 'agent_start' })],
    ['a message with an unknown role', JSON.stringify({ type: 'message_end', message: { role: 'custom', content: [] } })],
    ['a message with no role', JSON.stringify({ type: 'message_end', message: { content: [] } })],
    ['a message whose role is a list', JSON.stringify({ type: 'message_end', message: { role: ['user'] } })],
  ])('ignores %s and still reads the answer after it', async ([, line]) => {
    expect(textOf(await run(line, assistantLine('the answer')))).toBe('the answer');
  });

  test.for<[string, string]>([
    ['a JSON null', 'null'],
    ['a message end with no message', JSON.stringify({ type: 'message_end' })],
  ])('loses the output that arrived together with %s', async ([, line]) => {
    expect(textOf(await run(line, assistantLine('lost')))).toBe('(no output)');
  });

  test('keeps an assistant message whose usage is incomplete, counting what is there', async () => {
    const partial = { role: 'assistant', content: [{ type: 'text', text: 'kept' }], usage: { input: 1, output: 2, cost: {} } };
    const result = await run(JSON.stringify({ type: 'message_end', message: partial }));
    expect(textOf(result)).toBe('kept');
    expect(result.details?.results[0]).toMatchObject({ usage: { input: 1, output: 2 } });
  });
});
