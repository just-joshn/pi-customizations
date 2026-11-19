import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { executeSubagent } from '../src/subagent/dispatch.ts';
import { getPiInvocation } from '../src/subagent/pi-invocation.ts';
import { type ProcessOutcome, runPiInTmux } from '../src/subagent/run-in-tmux.ts';
import type { ParsedSubagentParams } from '../src/subagent/schema.ts';

vi.mock('../src/subagent/run-in-tmux.ts', () => ({ runPiInTmux: vi.fn() }));

type TmuxOptions = Parameters<typeof runPiInTmux>[0];
type Reply = { lines?: string[]; stderr?: string; outcome?: ProcessOutcome };

const OK: ProcessOutcome = { code: 0, signal: null };
const FAILED_EXIT_CODE = 7;
const OVER_LIMIT_TASKS = 9;
const MAX_ARG_INDEX = -1;
const BLANK = '';
const RUNS_WITHOUT_APPROVAL = 3;
const NODE_PATH = '/usr/bin/node';
const BUN_PATH = '/usr/bin/bun';
const BUN_EXE_PATH = '/bin/BUN.EXE';
const COMPILED_PATH = '/opt/pi/pi-compiled';
const BUN_POSIX_SCRIPT = '/$bunfs/root/pi';
const BUN_WINDOWS_SCRIPT = 'B:/~BUN/root/pi';

let root = BLANK;
let userAgents = BLANK;
let project = BLANK;
const tmux = vi.mocked(runPiInTmux);

const assistantLine = (text: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: text ? [{ type: 'text', text }] : [],
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 1, cost: { total: 1 } },
      model: 'child-model',
      ...extra,
    },
  });

const respond =
  (reply: Reply) =>
  async (options: TmuxOptions): Promise<ProcessOutcome> => {
    for (const line of reply.lines ?? []) options.onStdoutChunk(`${line}\n`);
    if (reply.stderr) options.onStderrChunk(reply.stderr);
    return reply.outcome ?? OK;
  };

const taskOf = (options: TmuxOptions): string => (options.args.at(MAX_ARG_INDEX) ?? BLANK).replace(/^Task: /, '');

const replyByTask = (replies: Record<string, Reply>) => async (options: TmuxOptions) => respond(replies[taskOf(options)] ?? {})(options);

const writeAgent = (dir: string, name: string, header = 'tools: ""\n', body = 'Be helpful.'): string => {
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${name}.md`);
  writeFileSync(filePath, `---\nname: ${name}\ndescription: ${name} agent\n${header}---\n${body}\n`);
  return filePath;
};

const makeCtx = (overrides: Record<string, unknown> = {}): ExtensionContext =>
  ({
    cwd: project,
    hasUI: false,
    model: undefined,
    thinkingLevel: undefined,
    isProjectTrusted: () => true,
    ui: { confirm: vi.fn(async () => true) },
    ...overrides,
  }) as unknown as ExtensionContext;

const run = (params: ParsedSubagentParams, ctx = makeCtx(), signal?: AbortSignal, onUpdate?: Parameters<typeof executeSubagent>[2]) => executeSubagent(params, signal, onUpdate, ctx);

const textOf = (result: Awaited<ReturnType<typeof run>>): string => {
  const [first] = result.content;
  return first?.type === 'text' ? first.text : BLANK;
};

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'subagent-dispatch-')));
  userAgents = join(root, 'agent', 'agents');
  project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  vi.stubEnv('PI_CODING_AGENT_DIR', join(root, 'agent'));
  tmux.mockReset();
  tmux.mockImplementation(respond({ lines: [assistantLine('done')] }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test('rejects a call with no mode and lists the bundled agents', async () => {
  const result = await run({});
  expect(textOf(result)).toContain('Invalid parameters. Provide exactly one mode.');
  expect(textOf(result)).toContain('Available agents: ci-watcher (package), comment-sicko (package), poteto-agent (package), scout (package), thermo-nuclear-code-quality-review (package), worker (package)');
  expect(result.details?.isError).toBe(true);
  expect(tmux).not.toHaveBeenCalled();
});

test('rejects a call mixing modes and lists available agents', async () => {
  writeAgent(userAgents, 'scout');
  const result = await run({ agent: 'scout', task: 'x', tasks: [{ agent: 'scout', task: 'y' }] });
  expect(textOf(result)).toContain('poteto-agent (package), scout (user), thermo-nuclear');
  expect(tmux).not.toHaveBeenCalled();
});

test('single mode returns the final assistant text and builds the pi command', async () => {
  writeAgent(userAgents, 'scout', 'tools: read, bash\nmodel: fancy/model\n');
  const ctx = makeCtx({ model: { provider: 'p', id: 'default' }, thinkingLevel: 'high' });
  const result = await run({ agent: 'scout', task: 'look' }, ctx);
  expect(textOf(result)).toBe('done');
  expect(result.details?.mode).toBe('single');
  const options = tmux.mock.calls[0]?.[0];
  expect(options?.cwd).toBe(project);
  expect(options?.args).toEqual(expect.arrayContaining(['--mode', 'json', '--model', 'fancy/model', '--tools', 'read,bash', '--append-system-prompt', 'Task: look']));
  expect(options?.args).not.toContain('--thinking');
});

test('single mode falls back to the session model and thinking level', async () => {
  writeAgent(userAgents, 'scout', undefined, BLANK);
  const ctx = makeCtx({ model: { provider: 'p', id: 'default' }, thinkingLevel: 'high' });
  await run({ agent: 'scout', task: 'look' }, ctx);
  const args = tmux.mock.calls[0]?.[0].args ?? [];
  expect(args).toEqual(expect.arrayContaining(['--model', 'p/default', '--thinking', 'high']));
  expect(args).not.toContain('--append-system-prompt');
  expect(args).not.toContain('--tools');
});

test('a call-level model and thinking level override the agent and session defaults', async () => {
  writeAgent(userAgents, 'scout', 'tools: read, bash\nmodel: fancy/model\n');
  const ctx = makeCtx({ model: { provider: 'p', id: 'default' }, thinkingLevel: 'high' });
  await run({ agent: 'scout', task: 'look', model: 'role/model', thinking: 'low' }, ctx);
  const args = tmux.mock.calls[0]?.[0].args ?? [];
  expect(args).toEqual(expect.arrayContaining(['--model', 'role/model', '--thinking', 'low']));
  expect(args).not.toContain('fancy/model');
});

test('parallel tasks and chain steps each take their own model and thinking level', async () => {
  writeAgent(userAgents, 'a');
  const modelArgs = (index: number) => {
    const args = tmux.mock.calls[index]?.[0].args ?? [];
    return [args[args.indexOf('--model') + 1], args[args.indexOf('--thinking') + 1]];
  };
  await run({ tasks: [{ agent: 'a', task: 'one', model: 'x/one', thinking: 'minimal' }] });
  expect(modelArgs(0)).toEqual(['x/one', 'minimal']);
  await run({ chain: [{ agent: 'a', task: 'two', model: 'x/two', thinking: 'xhigh' }] });
  expect(modelArgs(1)).toEqual(['x/two', 'xhigh']);
});

test('single mode resolves a relative cwd against the context cwd', async () => {
  writeAgent(userAgents, 'scout');
  await run({ agent: 'scout', task: 'look', cwd: 'sub' });
  expect(tmux.mock.calls[0]?.[0].cwd).toBe(join(project, 'sub'));
});

test('single mode reports an unknown agent with the available names', async () => {
  writeAgent(userAgents, 'scout');
  const result = await run({ agent: 'ghost', task: 'look' });
  expect(textOf(result)).toContain('Agent failed:');
  expect(textOf(result)).toContain('Unknown agent: "ghost". Available agents: "ci-watcher", "comment-sicko", "poteto-agent", "scout",');
  expect(tmux).not.toHaveBeenCalled();
});

test('single mode reports an unknown agent when only the bundled agents exist', async () => {
  const result = await run({ agent: 'ghost', task: 'look' });
  expect(textOf(result)).toContain('Available agents: "ci-watcher", "comment-sicko", "poteto-agent", "scout", "thermo-nuclear-code-quality-review", "worker".');
});

test('single mode says (no output) when the child produced no text', async () => {
  writeAgent(userAgents, 'scout');
  tmux.mockImplementation(respond({ lines: [assistantLine(BLANK)] }));
  expect(textOf(await run({ agent: 'scout', task: 'look' }))).toBe('(no output)');
});

test('single mode surfaces a failed child with its exit code and stderr', async () => {
  writeAgent(userAgents, 'scout');
  tmux.mockImplementation(respond({ stderr: 'boom', outcome: { code: FAILED_EXIT_CODE, signal: null } }));
  const result = await run({ agent: 'scout', task: 'look' });
  expect(textOf(result)).toContain(`Subagent exited with code ${FAILED_EXIT_CODE}`);
  expect(textOf(result)).toContain('stderr: boom');
  expect(result.details?.results[0]?.status).toBe('failed');
});

test('single mode reports spawn errors and termination signals', async () => {
  writeAgent(userAgents, 'scout');
  tmux.mockImplementation(respond({ outcome: { code: null, signal: null, spawnError: new Error('no tmux') } }));
  expect(textOf(await run({ agent: 'scout', task: 'look' }))).toContain('Failed to spawn subagent: no tmux');
  tmux.mockImplementation(respond({ outcome: { code: null, signal: 'SIGKILL' } }));
  expect(textOf(await run({ agent: 'scout', task: 'look' }))).toContain('Subagent terminated by signal SIGKILL');
});

test('single mode maps error and aborted stop reasons from the child', async () => {
  writeAgent(userAgents, 'scout');
  tmux.mockImplementation(respond({ lines: [assistantLine('partial', { stopReason: 'error', errorMessage: 'rate limited' })] }));
  expect(textOf(await run({ agent: 'scout', task: 'look' }))).toContain('Agent error: Error: rate limited');
  tmux.mockImplementation(respond({ lines: [assistantLine('partial', { stopReason: 'aborted' })] }));
  const aborted = await run({ agent: 'scout', task: 'look' });
  expect(aborted.details?.results[0]?.status).toBe('aborted');
});

test('single mode never starts a child when the signal is already aborted', async () => {
  writeAgent(userAgents, 'scout');
  const result = await run({ agent: 'scout', task: 'look' }, makeCtx(), AbortSignal.abort());
  expect(textOf(result)).toContain('Subagent was aborted before starting');
  expect(tmux).not.toHaveBeenCalled();
});

test('an abort that fires while the child runs yields an aborted result', async () => {
  writeAgent(userAgents, 'scout');
  const controller = new AbortController();
  tmux.mockImplementation(async () => {
    controller.abort();
    return { code: null, signal: 'SIGTERM' };
  });
  const result = await run({ agent: 'scout', task: 'look' }, makeCtx(), controller.signal);
  expect(result.details?.results[0]?.status).toBe('aborted');
  expect(textOf(result)).toContain('Subagent was aborted');
});

test('streams partial output to onUpdate, including a final line without newline', async () => {
  writeAgent(userAgents, 'scout');
  tmux.mockImplementation(async (options) => {
    const line = assistantLine('last');
    options.onStdoutChunk('not json\n');
    options.onStdoutChunk(line.slice(0, 10));
    options.onStdoutChunk(line.slice(10));
    return OK;
  });
  const onUpdate = vi.fn();
  const result = await run({ agent: 'scout', task: 'look' }, makeCtx(), undefined, onUpdate);
  expect(textOf(result)).toBe('last');
  const texts = onUpdate.mock.calls.map(([update]) => update.content[0].text);
  expect(texts[0]).toBe('(running...)');
  expect(texts.at(-1)).toBe('last');
});

test('chain mode threads {previous} through steps', async () => {
  writeAgent(userAgents, 'a');
  writeAgent(userAgents, 'b');
  tmux.mockImplementation(replyByTask({ first: { lines: [assistantLine('one')] }, 'use one': { lines: [assistantLine('two')] } }));
  const onUpdate = vi.fn();
  const chain = [
    { agent: 'a', task: 'first' },
    { agent: 'b', task: 'use {previous}' },
  ];
  const result = await run({ chain }, makeCtx(), undefined, onUpdate);
  expect(textOf(result)).toBe('two');
  expect(result.details?.mode).toBe('chain');
  expect(result.details?.results.map((r) => r.step)).toEqual([1, 2]);
  const last = onUpdate.mock.calls.at(-1)?.[0];
  expect(last.details.results).toHaveLength(2);
});

test('chain mode stops at the first failing step', async () => {
  writeAgent(userAgents, 'a');
  tmux.mockImplementation(respond({ outcome: { code: 1, signal: null } }));
  const chain = [
    { agent: 'a', task: 'first' },
    { agent: 'a', task: 'second' },
  ];
  const result = await run({ chain });
  expect(textOf(result)).toContain('Chain stopped at step 1 (a):');
  expect(tmux).toHaveBeenCalledTimes(1);
});

test('chain mode says (no output) when the last step is silent', async () => {
  writeAgent(userAgents, 'a');
  tmux.mockImplementation(respond({ lines: [assistantLine(BLANK)] }));
  expect(textOf(await run({ chain: [{ agent: 'a', task: 'go' }] }))).toBe('(no output)');
});

test('parallel mode summarizes successes and failures with stop reasons', async () => {
  writeAgent(userAgents, 'a');
  tmux.mockImplementation(
    replyByTask({
      ok: { lines: [assistantLine('fine')] },
      bad: { lines: [assistantLine('oops', { stopReason: 'error' })] },
      dead: { outcome: { code: 1, signal: null } },
    }),
  );
  const onUpdate = vi.fn();
  const tasks = ['ok', 'bad', 'dead'].map((task) => ({ agent: 'a', task }));
  const result = await run({ tasks }, makeCtx(), undefined, onUpdate);
  const text = textOf(result);
  expect(text).toContain('Parallel: 1/3 succeeded');
  expect(text).toContain('### [a] completed');
  expect(text).toContain('### [a] failed (error)');
  expect(text).toContain('### [a] failed\n');
  expect(onUpdate.mock.calls.some(([u]) => /Parallel: \d\/3 done, \d running, \d pending\.\.\./.test(u.content[0].text))).toBe(true);
});

test('parallel mode rejects more tasks than the limit', async () => {
  writeAgent(userAgents, 'a');
  const tasks = Array.from({ length: OVER_LIMIT_TASKS }, () => ({ agent: 'a', task: 't' }));
  const result = await run({ tasks });
  expect(textOf(result)).toBe(`Too many parallel tasks (${OVER_LIMIT_TASKS}). Max is 8.`);
  expect(result.details?.isError).toBe(true);
  expect(tmux).not.toHaveBeenCalled();
});

test('parallel mode reports an unknown agent as a failed task', async () => {
  const result = await run({ tasks: [{ agent: 'ghost', task: 't' }] });
  expect(textOf(result)).toContain('Parallel: 0/1 succeeded');
  expect(textOf(result)).toContain('Unknown agent: "ghost"');
});

test('asks to approve project agents in the UI and cancels on refusal', async () => {
  writeAgent(join(project, '.pi', 'agents'), 'local');
  const confirm = vi.fn(async () => false);
  const ctx = makeCtx({ hasUI: true, isProjectTrusted: () => false, ui: { confirm } });
  const result = await run({ agent: 'local', task: 'go', agentScope: 'both' }, ctx);
  expect(textOf(result)).toBe('Canceled: project-local agents not approved.');
  expect(confirm).toHaveBeenCalledWith('Run project-local agents?', expect.stringContaining('- local:'));
  expect(tmux).not.toHaveBeenCalled();
});

test('runs project agents once approved', async () => {
  writeAgent(join(project, '.pi', 'agents'), 'local');
  const ctx = makeCtx({ hasUI: true, isProjectTrusted: () => false });
  expect(textOf(await run({ agent: 'local', task: 'go', agentScope: 'project' }, ctx))).toBe('done');
});

test('skips approval for trusted projects, disabled confirmation, or no UI', async () => {
  writeAgent(join(project, '.pi', 'agents'), 'local');
  const confirm = vi.fn(async () => false);
  const base = { agent: 'local', task: 'go', agentScope: 'both' } as const;
  await run(base, makeCtx({ hasUI: true, ui: { confirm } }));
  await run({ ...base, confirmProjectAgents: false }, makeCtx({ hasUI: true, isProjectTrusted: () => false, ui: { confirm } }));
  await run(base, makeCtx({ hasUI: false, isProjectTrusted: () => false, ui: { confirm } }));
  expect(confirm).not.toHaveBeenCalled();
  expect(tmux).toHaveBeenCalledTimes(RUNS_WITHOUT_APPROVAL);
});

test('does not ask about user agents when the scope is user', async () => {
  writeAgent(userAgents, 'scout');
  const confirm = vi.fn(async () => false);
  await run({ agent: 'scout', task: 'go', agentScope: 'user' }, makeCtx({ hasUI: true, ui: { confirm } }));
  expect(confirm).not.toHaveBeenCalled();
});

const stubProcess = (argv1: string | undefined, execPath: string): void => {
  vi.stubGlobal('process', { ...process, argv: [execPath, ...(argv1 === undefined ? [] : [argv1])], execPath });
};

test('getPiInvocation reuses the current script when it exists', () => {
  const script = join(root, 'cli.js');
  writeFileSync(script, BLANK);
  stubProcess(script, NODE_PATH);
  expect(getPiInvocation(['-p'])).toEqual({ command: NODE_PATH, args: [script, '-p'] });
});

test('getPiInvocation ignores bun virtual scripts on posix and windows', () => {
  stubProcess(BUN_POSIX_SCRIPT, BUN_PATH);
  expect(getPiInvocation(['-p'])).toEqual({ command: 'pi', args: ['-p'] });
  stubProcess(BUN_WINDOWS_SCRIPT, BUN_PATH);
  expect(getPiInvocation(['-p'])).toEqual({ command: 'pi', args: ['-p'] });
});

test('getPiInvocation falls back to pi for generic runtimes without a script', () => {
  stubProcess(undefined, NODE_PATH);
  expect(getPiInvocation(['-p'])).toEqual({ command: 'pi', args: ['-p'] });
  stubProcess(join(root, 'missing.js'), BUN_EXE_PATH);
  expect(getPiInvocation(['-p']).command).toBe('pi');
});

test('getPiInvocation runs a compiled binary directly', () => {
  stubProcess(undefined, COMPILED_PATH);
  expect(getPiInvocation(['-p'])).toEqual({ command: COMPILED_PATH, args: ['-p'] });
});
