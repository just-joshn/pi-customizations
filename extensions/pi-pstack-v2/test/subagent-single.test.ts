import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, test, vi } from 'vitest';
import { assistantLine, CHILD_WAIT_MS, dies, says, startedChildren } from './subagent-child-output.ts';
import { fakePi } from './subagent-fake-pi.ts';
import { loadSubagent, makeCtx, textOf, useWorkspace, writeAgent } from './subagent-host.ts';

const workspace = useWorkspace();
const FAILED_EXIT_CODE = 7;
const SESSION_MODEL = { provider: 'p', id: 'default' };
const MIN_UPDATES = 2;
const LONG_ANSWER_LINES = 3000;
const HUGE_LINE_CHARS = 120_000;
const MODE_FLAG_SPAN = 4;
const BUN_POSIX_SCRIPT = '/$bunfs/root/pi';
const BUN_WINDOWS_SCRIPT = 'B:/~BUN/root/pi';
const MISSING_SCRIPT = '/missing/cli.js';
const BUN_PATH = '/usr/bin/bun';
const NODE_PATH = '/usr/bin/node';
const BUN_EXE_PATH = '/bin/BUN.EXE';

const callScout = (params: Record<string, unknown> = {}, ctxOptions: Parameters<typeof makeCtx>[1] = {}) => {
  const { call } = loadSubagent();
  return call({ agent: 'scout', task: 'look', ...params }, makeCtx(workspace().project, ctxOptions));
};
const onlyChild = () => fakePi.children()[0];

describe('single mode, how Pi is started', () => {
  test('returns the final assistant text and starts Pi in json mode in the project directory', async () => {
    const result = await callScout();
    expect(textOf(result)).toBe('done');
    expect(result.details?.mode).toBe('single');
    expect(result.details?.isError).toBe(false);
    const child = onlyChild();
    expect(child?.args.slice(child.args.indexOf('--mode'), child.args.indexOf('--mode') + MODE_FLAG_SPAN)).toEqual(['--mode', 'json', '-p', '--no-session']);
    expect(child?.args.at(-1)).toBe('Task: look');
    expect(child?.cwd).toBe(workspace().project);
  });

  test('runs the current Pi script when Pi was started from a script file', async () => {
    await callScout();
    expect(onlyChild()?.via).toBe('script');
  });

  test.for([
    ['a bun virtual script on posix', BUN_POSIX_SCRIPT, BUN_PATH],
    ['a bun virtual script on windows', BUN_WINDOWS_SCRIPT, BUN_PATH],
    ['a missing script under node', MISSING_SCRIPT, NODE_PATH],
    ['a missing script under bun.exe', MISSING_SCRIPT, BUN_EXE_PATH],
  ])('starts the pi command when Pi runs from %s', async ([, script, execPath]) => {
    vi.stubGlobal('process', { ...process, argv: [execPath, script], execPath });
    await callScout();
    expect(onlyChild()?.via).toBe('pi');
    expect(onlyChild()?.args[0]).toBe('--mode');
  });

  test('starts a compiled Pi binary directly', async () => {
    const compiled = fakePi.compiledPi();
    vi.stubGlobal('process', { ...process, argv: [compiled], execPath: compiled });
    await callScout();
    expect(onlyChild()?.via).toBe('pi-compiled');
    expect(onlyChild()?.args[0]).toBe('--mode');
  });
});

describe('single mode, the model, tools and prompt the child gets', () => {
  test('passes the agent model, tools and system prompt file, and removes the prompt file afterwards', async () => {
    const { project, userAgents } = workspace();
    writeAgent(userAgents, 'scout', 'tools: read, bash\nmodel: fancy/model\n', 'You scout.');
    let promptSeen = '';
    let promptFile = '';
    fakePi.onChild((child) => {
      promptFile = child.flag('--append-system-prompt') ?? '';
      promptSeen = fs.readFileSync(promptFile, 'utf8');
      says('ok')(child);
    });
    await callScout({}, { model: SESSION_MODEL, thinkingLevel: 'high' });
    const child = onlyChild();
    expect(child?.flag('--model')).toBe('fancy/model');
    expect(child?.flag('--tools')).toBe('read,bash');
    expect(child?.flag('--thinking')).toBeUndefined();
    expect(promptSeen).toContain('You scout.');
    expect(fs.existsSync(promptFile)).toBe(false);
    expect(fs.existsSync(path.dirname(promptFile))).toBe(false);
    expect(child?.cwd).toBe(project);
  });

  test('falls back to the session model and thinking level, with no tools or prompt flags for a bare agent', async () => {
    const { userAgents } = workspace();
    writeAgent(userAgents, 'scout', '', '');
    await callScout({}, { model: SESSION_MODEL, thinkingLevel: 'high' });
    const child = onlyChild();
    expect(child?.flag('--model')).toBe('p/default');
    expect(child?.flag('--thinking')).toBe('high');
    expect(child?.args).not.toContain('--append-system-prompt');
    expect(child?.args).not.toContain('--tools');
  });

  test('starts with no model flags when neither the call, the agent nor the session names one', async () => {
    await callScout();
    expect(onlyChild()?.args).not.toContain('--model');
    expect(onlyChild()?.args).not.toContain('--thinking');
  });

  test('a call-level model and thinking level beat the agent and the session', async () => {
    const { userAgents } = workspace();
    writeAgent(userAgents, 'scout', 'model: fancy/model\n');
    await callScout({ model: 'role/model', thinking: 'low' }, { model: SESSION_MODEL, thinkingLevel: 'high' });
    expect(onlyChild()?.flag('--model')).toBe('role/model');
    expect(onlyChild()?.flag('--thinking')).toBe('low');
    expect(onlyChild()?.args).not.toContain('fancy/model');
  });

  test('a model named by the call runs at its own default thinking level', async () => {
    await callScout({ model: 'role/model' }, { model: SESSION_MODEL, thinkingLevel: 'high' });
    expect(onlyChild()?.flag('--model')).toBe('role/model');
    expect(onlyChild()?.args).not.toContain('--thinking');
  });
});

describe('single mode, where the child runs', () => {
  test('resolves a relative cwd against the project directory', async () => {
    fs.mkdirSync(path.join(workspace().project, 'sub'));
    await callScout({ cwd: 'sub' });
    expect(onlyChild()?.cwd).toBe(path.join(workspace().project, 'sub'));
  });

  test('keeps a task with quotes and spaces intact for the child', async () => {
    const task = `say "it's fine" now`;
    await callScout({ task });
    expect(onlyChild()?.task).toBe(task);
  });
});

describe('single mode, an agent that does not exist', () => {
  test('says unknown agent and names the agents it can run', async () => {
    const result = await callScout({ agent: 'ghost' });
    expect(textOf(result)).toContain('Agent failed:');
    expect(textOf(result)).toContain('Unknown agent: "ghost". Available agents: "ci-watcher", "comment-sicko", "poteto-agent", "scout",');
    expect(result.details?.isError).toBe(true);
    expect(fakePi.children()).toHaveLength(0);
  });
});

describe('single mode, a child that fails', () => {
  test('says (no output) when the child printed no text', async () => {
    fakePi.onChild(says(''));
    expect(textOf(await callScout())).toBe('(no output)');
  });

  test('surfaces a failed child with its exit code and stderr', async () => {
    fakePi.onChild(dies(FAILED_EXIT_CODE, 'boom'));
    const result = await callScout();
    expect(textOf(result)).toContain(`Subagent exited with code ${FAILED_EXIT_CODE}`);
    expect(textOf(result)).toContain('stderr: boom');
    expect(result.details?.results[0]?.status).toBe('failed');
    expect(result.details?.isError).toBe(true);
  });

  test('reports a tmux that cannot start', async () => {
    fakePi.failToStart();
    const result = await callScout();
    expect(textOf(result)).toContain('Failed to spawn subagent:');
    expect(result.details?.results[0]?.status).toBe('failed');
  });

  test('reports a session that vanished without an exit code', async () => {
    fakePi.onChild((child) => child.vanish());
    expect(textOf(await callScout())).toContain('Subagent exited with code null');
  });
});

describe('single mode, what the child printed', () => {
  test('reports a child turn that ended in error, with the error message and its partial text', async () => {
    fakePi.onChild(says('partial', { stopReason: 'error', errorMessage: 'rate limited' }));
    const result = await callScout();
    expect(textOf(result)).toContain('Agent error: Error: rate limited');
    expect(textOf(result)).toContain('Assistant output: partial');
    expect(result.details?.results[0]?.status).toBe('failed');
  });

  test('reports a child turn that ended aborted', async () => {
    fakePi.onChild(says('partial', { stopReason: 'aborted' }));
    const result = await callScout();
    expect(result.details?.results[0]?.status).toBe('aborted');
    expect(textOf(result)).toContain('Agent aborted:');
  });

  test('ignores output lines that are not messages and reads a last line with no newline', async () => {
    fakePi.onChild((child) => {
      child.stdout('not json\n{"type":"agent_start"}\n');
      child.stdout(assistantLine('last'));
      child.exit(0);
    });
    expect(textOf(await callScout())).toBe('last');
  });

  test('a streamed assistant message without usage is dropped and never reaches the answer', async () => {
    fakePi.onChild((child) => {
      child.stdout(`${JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'lost' }] } })}\n`);
      child.exit(0);
    });
    expect(textOf(await callScout())).toBe('(no output)');
  });

  test('truncates a very long answer and says how much was cut', async () => {
    fakePi.onChild(says(Array.from({ length: LONG_ANSWER_LINES }, (_, i) => `line ${i}`).join('\n')));
    const text = textOf(await callScout());
    expect(text).toContain('line 0');
    expect(text).toMatch(/\[Output truncated: \d+ bytes omitted\. Full output preserved in tool details\.\]$/);
  });

  test('shows only the notice when a single line is too big to keep', async () => {
    fakePi.onChild(says('x'.repeat(HUGE_LINE_CHARS)));
    expect(textOf(await callScout())).toMatch(/^\[Output truncated: \d+ bytes omitted/);
  });
});

describe('single mode, streaming and abort', () => {
  test('streams the running state, then each new assistant message, to onUpdate', async () => {
    fakePi.onChild((child) => {
      child.stdout(`${assistantLine('first')}\n`);
      child.stdout(`${assistantLine('second')}\n`);
      child.exit(0);
    });
    const onUpdate = vi.fn();
    const { call } = loadSubagent();
    await call({ agent: 'scout', task: 'look' }, makeCtx(workspace().project), undefined, onUpdate);
    const texts = onUpdate.mock.calls.map(([update]) => update.content[0].text);
    expect(texts[0]).toBe('(running...)');
    expect(texts.at(-1)).toBe('second');
    expect(texts.length).toBeGreaterThanOrEqual(MIN_UPDATES);
  });
});

describe('single mode, abort', () => {
  test('never starts a child when the call is already aborted', async () => {
    const { call } = loadSubagent();
    const result = await call({ agent: 'scout', task: 'look' }, makeCtx(workspace().project), AbortSignal.abort());
    expect(textOf(result)).toContain('Subagent was aborted before starting');
    expect(fakePi.children()).toHaveLength(0);
  });

  test('never starts a child when the call aborts while its prompt is being written', async () => {
    const controller = new AbortController();
    const { call } = loadSubagent();
    const running = call({ agent: 'scout', task: 'look' }, makeCtx(workspace().project), controller.signal);
    controller.abort();
    expect(textOf(await running)).toContain('Subagent was aborted before starting');
    expect(fakePi.children()).toHaveLength(0);
  });

  test('an abort while the child runs stops the child and ends the call aborted', async () => {
    fakePi.onChild(() => undefined);
    const controller = new AbortController();
    const { call } = loadSubagent();
    const running = call({ agent: 'scout', task: 'look' }, makeCtx(workspace().project), controller.signal);
    const [child] = await startedChildren(1);
    controller.abort();
    const result = await running;
    await vi.waitFor(() => expect(child?.state).toBe('gone'), CHILD_WAIT_MS);
    expect(result.details?.results[0]).toMatchObject({ status: 'aborted', terminationSignal: 'SIGTERM' });
    expect(textOf(result)).toContain('Subagent was aborted');
  });
});
