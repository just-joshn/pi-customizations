import * as os from 'node:os';

import { describe, expect, test, vi } from 'vitest';
import { assistantLine, byTask, CHILD_WAIT_MS, dies, printing, type Said, says, startedChildren } from './subagent-child-output.ts';
import { type FakeChild, fakePi } from './subagent-fake-pi.ts';
import { loadSubagent, makeCtx, type ToolResult, useWorkspace } from './subagent-host.ts';

const workspace = useWorkspace();
const MANY_ITEMS = 12;
const SINGLE_PREVIEW_CHARS = 60;
const ITEM_PREVIEW_CHARS = 40;
const LONG = 100;
const FILE = '/f';
const ETC_FILE = '/etc/x';
const READ_TARGET = '/x';
const SRC_DIR = '/src';
const TOOL_ARG_PREVIEW_CHARS = 50;
const READ_OFFSET = 5;
const READ_LIMIT = 10;
const TASK_COUNT = 6;
const RUNNING_TASKS = 4;
const MIN_STEPS = 2;

const subagent = loadSubagent();
const call = (params: Record<string, unknown>, onUpdate?: (partial: ToolResult) => void) => subagent.call(params, makeCtx(workspace().project), undefined, onUpdate);
const tasksFor = (...tasks: string[]) => tasks.map((task) => ({ agent: 'scout', task }));
/** Runs one scout and shows its result the way Pi draws it. */
const showSingle = async (script: Parameters<typeof fakePi.onChild>[0], expanded: boolean, task = 'find things') => {
  fakePi.onChild(script);
  return subagent.renderResult(await call({ agent: 'scout', task }), expanded);
};
/** Collects the partial results a call streams, in order. */
const collectUpdates = () => {
  let seen: readonly ToolResult[] = [];
  return {
    add: (partial: ToolResult): void => {
      seen = [...seen, partial];
    },
    all: (): readonly ToolResult[] => seen,
  };
};
const toolCall = (name: string, args: Record<string, unknown>): Said => ({ toolCalls: [{ name, arguments: args }] });

describe('a single result', () => {
  test('collapsed, shows the tool calls, the first lines of the answer and usage', async () => {
    const out = await showSingle(printing(assistantLine('l1\nl2\nl3\nl4', { ...toolCall('bash', { command: 'ls' }), model: 'm1' })), false);
    expect(out).toContain('✓ scout (package)');
    expect(out).toContain('→ $ ls');
    expect(out).toContain('l3');
    expect(out).not.toContain('l4');
    expect(out).toContain('1 turn ↑1 ↓1 $1.0000 ctx:1 m1');
  });

  test('collapsed, keeps the last ten items and offers to expand the rest', async () => {
    const lines = Array.from({ length: MANY_ITEMS }, (_, i) => assistantLine(`item-${i}`));
    const out = await showSingle(printing(...lines), false);
    expect(out).toContain('... 2 earlier items');
    expect(out).toContain('(Ctrl+O to expand)');
    expect(out).not.toContain('item-1\n');
    expect(out).toContain('item-11');
  });

  test('collapsed with no output says so, and shows the error of a failed run', async () => {
    expect(await showSingle(says(''), false)).toContain('(no output)');
    const failed = await showSingle(says('partial', { stopReason: 'error', errorMessage: 'boom' }), false);
    expect(failed).toContain('✗ scout');
    expect(failed).toContain('[error]');
    expect(failed).toContain('Error: boom');
  });

  test('colors a successful run and a failed run with different roles', async () => {
    fakePi.onChild(says('fine'));
    const succeeded = subagent.renderResultWithRoles(await call({ agent: 'scout', task: 'a' }));
    fakePi.onChild(dies(1));
    const failed = subagent.renderResultWithRoles(await call({ agent: 'scout', task: 'b' }));
    expect(succeeded).toContain('<success:');
    expect(succeeded).not.toContain('<error:');
    expect(failed).toContain('<error:');
    expect(failed).not.toContain('<success:');
  });

  test('shows a failed run by its status when no stop reason came with it', async () => {
    const out = await showSingle(dies(1), false);
    expect(out).toContain('[failed]');
    expect(out).toContain('Error: Subagent exited with code 1');
  });
});

describe('a single result, while it runs or after an abort', () => {
  test('shows a run that is still going with its status', async () => {
    fakePi.onChild(() => undefined);
    const updates = collectUpdates();
    const running = call({ agent: 'scout', task: 'look' }, updates.add);
    const [child] = await startedChildren(1);
    expect(subagent.renderResult(updates.all()[0], false)).toContain('[running]');
    expect(subagent.renderResult(updates.all()[0], false)).toContain('⏳');
    child?.exit(0);
    await running;
  });

  test('shows an aborted run as aborted', async () => {
    fakePi.onChild(() => undefined);
    const controller = new AbortController();
    const running = subagent.call({ agent: 'scout', task: 'look' }, makeCtx(workspace().project), controller.signal);
    await startedChildren(1);
    controller.abort();
    expect(subagent.renderResult(await running, false)).toContain('[aborted]');
  });

  test('expanded, shows the task, diagnostics, tool calls, the markdown answer and usage', async () => {
    const script = (child: FakeChild) => {
      child.stderr(' bad \n');
      printing(assistantLine('final answer', { ...toolCall('read', { path: READ_TARGET }), stopReason: 'error', errorMessage: 'boom' }))(child);
    };
    const out = await showSingle(script, true);
    for (const piece of ['Error: boom', 'stderr: bad', '─── Task ───', 'find things', '─── Output ───', 'read /x', 'final answer', '1 turn']) expect(out).toContain(piece);
  });

  test('expanded, shows a termination signal for an aborted run', async () => {
    fakePi.onChild(() => undefined);
    const controller = new AbortController();
    const running = subagent.call({ agent: 'scout', task: 'look' }, makeCtx(workspace().project), controller.signal);
    await startedChildren(1);
    controller.abort();
    expect(subagent.renderResult(await running, true)).toContain('Signal: SIGTERM');
  });

  test('expanded with no output and no usage shows a placeholder', async () => {
    const out = await showSingle(printing(), true);
    expect(out).toContain('(no output)');
    expect(out).not.toContain('turn');
  });
});

describe('a chain result', () => {
  test('collapsed, shows each step with its output or failure, the total and the expand hint', async () => {
    fakePi.onChild(byTask({ one: says('step one done'), two: dies(1, 'nope') }));
    const out = subagent.renderResult(await call({ chain: tasksFor('one', 'two', 'three') }), false);
    expect(out).toContain('✗ chain 1/2 steps');
    expect(out).toContain('─── Step 1: scout');
    expect(out).toContain('─── Step 2: scout');
    expect(out).toContain('step one done');
    expect(out).toContain('Subagent exited with code 1');
    expect(out).toContain('Total: 1 turn ↑1 ↓1 $1.0000');
    expect(out).toContain('(Ctrl+O to expand)');
  });

  test('collapsed, shows a step with no output as such', async () => {
    fakePi.onChild(says(''));
    expect(subagent.renderResult(await call({ chain: tasksFor('one') }), false)).toContain('(no output)');
  });

  test('shows a completed chain with a check mark and a running step with an hourglass', async () => {
    fakePi.onChild(byTask({ one: says('a') }, () => undefined));
    const updates = collectUpdates();
    const running = call({ chain: tasksFor('one', 'two') }, updates.add);
    const [, second] = await startedChildren(2);
    await vi.waitFor(() => expect(updates.all().at(-1)?.details?.results).toHaveLength(MIN_STEPS), CHILD_WAIT_MS);
    expect(subagent.renderResult(updates.all().at(-1), false)).toContain('⏳ chain 1/2 steps');
    second?.stdout(`${assistantLine('b')}\n`);
    second?.exit(0);
    expect(subagent.renderResult(await running, false)).toContain('✓ chain 2/2 steps');
  });

  test('expanded, lists each step with its task, tool calls, answer, error and the total', async () => {
    fakePi.onChild(byTask({ one: printing(assistantLine('done', toolCall('ls', {}))), two: dies(1, 'bad') }));
    const out = subagent.renderResult(await call({ chain: tasksFor('one', 'two') }), true);
    for (const piece of ['Task: ', 'one', 'ls .', 'done', 'Error: Subagent exited with code 1', 'stderr: bad', 'Total: 1 turn']) expect(out).toContain(piece);
  });
});

/** Ends every child still running, again and again, until the call that started them returns. */
const drain = async (running: Promise<unknown>): Promise<void> => {
  let settled = false;
  void running.then(() => {
    settled = true;
  });
  await vi.waitFor(() => {
    for (const child of fakePi.children()) if (child.state === 'running') child.exit(0);
    expect(settled).toBe(true);
  }, CHILD_WAIT_MS);
};

describe('a parallel result', () => {
  const startTasks = async (script: Parameters<typeof fakePi.onChild>[0]) => {
    fakePi.onChild(script);
    const updates = collectUpdates();
    const running = call({ tasks: tasksFor(...Array.from({ length: TASK_COUNT }, (_, i) => `t${i}`)) }, updates.add);
    await startedChildren(RUNNING_TASKS);
    return { updates, running };
  };

  test('while tasks run, shows progress with running and pending placeholders and no total', async () => {
    const { updates, running } = await startTasks(() => undefined);
    const out = subagent.renderResult(updates.all().at(-1), false);
    expect(out).toContain('0/6 done, 4 running, 2 pending');
    expect(out).toContain('(running...)');
    expect(out).toContain('(pending...)');
    expect(out).toContain('⏳ parallel');
    expect(out).toContain('(Ctrl+O to expand)');
    expect(out).not.toContain('Total:');
    await drain(running);
  });

  test('while tasks run, stays compact even when expanded', async () => {
    const { updates, running } = await startTasks((child) => child.stdout(`${assistantLine('a\nb\nc\nd')}\n`));
    const out = subagent.renderResult(updates.all().at(-1), true);
    expect(out).not.toContain('Task: ');
    expect(out).not.toContain('(Ctrl+O');
    expect(out).toContain('d');
    await drain(running);
  });

  test('when all tasks succeed, shows a check mark, the count and the total', async () => {
    fakePi.onChild(says('hi'));
    const out = subagent.renderResult(await call({ tasks: tasksFor('a', 'b') }), false);
    expect(out).toContain('✓ parallel 2/2 tasks');
    expect(out).toContain('Total: 2 turns');
    expect(out).toContain('hi');
  });

  test('when some tasks fail, shows a half mark and the failure', async () => {
    fakePi.onChild(byTask({ a: says('fine'), b: dies(1, 'bad') }));
    const out = subagent.renderResult(await call({ tasks: tasksFor('a', 'b') }), false);
    expect(out).toContain('◐');
    expect(out).toContain('Subagent exited with code 1');
  });

  test('a task whose agent does not exist shows its error', async () => {
    const out = subagent.renderResult(await call({ tasks: [{ agent: 'ghost', task: 't' }] }), false);
    expect(out).toContain('Unknown agent: "ghost"');
  });

  test('expanded after finishing, renders the full group', async () => {
    fakePi.onChild(says('full text\nline2\nline3\nline4', { model: 'm' }));
    const out = subagent.renderResult(await call({ tasks: tasksFor('a') }), true);
    for (const piece of ['Task: ', 'full text', 'line4', 'Total: 1 turn']) expect(out).toContain(piece);
  });
});

describe('usage in a result', () => {
  test.for([
    [{ input: 0, output: 999 }, '↓999'],
    [{ input: 1500 }, '↑1.5k'],
    [{ input: 12_500 }, '↑13k'],
    [{ input: 2_500_000 }, '↑2.5M'],
    [{ cacheRead: 12_500, cacheWrite: 2_500_000 }, 'R13k W2.5M'],
    [{ cost: { total: 0.12345 } }, '$0.1235'],
    [{ totalTokens: 1500 }, 'ctx:1.5k'],
  ])('shows %j as %s', async ([usage, shown]) => {
    const out = await showSingle(says('x', { usage: usage as never }), false);
    expect(out).toContain(shown as string);
  });

  test('leaves out what is zero, and the whole line when everything is', async () => {
    const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } };
    const out = await showSingle(says('x', { usage: zero, model: '' }), false);
    expect(out).not.toMatch(/↑|↓|\$|ctx:/);
  });
});

describe('a tool call in a result', () => {
  const callLine = async (name: string, args: Record<string, unknown>) => showSingle(says('', toolCall(name, args)), false);

  test('bash shows the command, cut at 60 characters', async () => {
    expect(await callLine('bash', { command: 'ls' })).toContain('$ ls');
    expect(await callLine('bash', {})).toContain('$ ...');
    expect(await callLine('bash', { command: 'x'.repeat(LONG) })).toContain(`${'x'.repeat(SINGLE_PREVIEW_CHARS)}...`);
  });

  test('read shortens home paths and shows the line range', async () => {
    const out = await callLine('read', { path: `${os.homedir()}/a.ts`, offset: READ_OFFSET, limit: READ_LIMIT });
    expect(out).toContain('read ~/a.ts:5-14');
  });

  test('read prefers file_path and falls back to ... for an empty or non-string path', async () => {
    expect(await callLine('read', { file_path: ETC_FILE })).toContain(`read ${ETC_FILE}`);
    expect(await callLine('read', { file_path: '' })).toContain('read ...');
    expect(await callLine('read', { file_path: 3 })).toContain('read ...');
  });

  test('write shows the line count only for several lines', async () => {
    expect(await callLine('write', { path: FILE, content: 'a\nb\nc' })).toContain(`write ${FILE} (3 lines)`);
    expect(await callLine('write', { path: FILE, content: 'a' })).not.toContain('lines)');
    expect(await callLine('write', {})).toContain('write ...');
  });

  test('edit, ls, find and grep show their arguments with defaults', async () => {
    expect(await callLine('edit', { path: FILE })).toContain(`edit ${FILE}`);
    expect(await callLine('ls', {})).toContain('ls .');
    expect(await callLine('find', {})).toContain('find * in .');
    expect(await callLine('find', { pattern: '*.ts', path: SRC_DIR })).toContain(`find *.ts in ${SRC_DIR}`);
    expect(await callLine('grep', {})).toContain('grep // in .');
    expect(await callLine('grep', { pattern: 'foo', path: SRC_DIR })).toContain(`grep /foo/ in ${SRC_DIR}`);
  });

  test('another tool shows a JSON preview of its arguments, cut at 50 characters', async () => {
    expect(await callLine('custom', { a: 1 })).toContain('custom {"a":1}');
    const preview = JSON.stringify({ v: 'y'.repeat(LONG) }).slice(0, TOOL_ARG_PREVIEW_CHARS);
    expect(await callLine('custom', { v: 'y'.repeat(LONG) })).toContain(`custom ${preview}...`);
  });
});

describe('a result Pi has no details for', () => {
  const text = (value: string) => ({ content: [{ type: 'text', text: value }] });

  test('shows the first text content when details are missing or empty', () => {
    expect(subagent.renderResult(text('plain'))).toBe('plain');
    expect(subagent.renderResult({ ...text('plain'), details: { mode: 'single', results: [], isError: false } })).toBe('plain');
  });

  test('shows (no output) when the first content is not text or there is none', () => {
    expect(subagent.renderResult({ content: [{ type: 'image', data: '', mimeType: 'image/png' }] })).toBe('(no output)');
    expect(subagent.renderResult({ content: [] })).toBe('(no output)');
  });

  test('shows the text when a single-mode result holds several results', () => {
    const entry = { agent: 'a', agentSource: 'user', task: 't', status: 'completed', exitCode: 0, messages: [], stderr: '', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 } };
    expect(subagent.renderResult({ ...text('fallback'), details: { mode: 'single', results: [entry, entry], isError: false } })).toBe('fallback');
  });
});

describe('a call as it is drawn', () => {
  const item = (agent: string, task: string) => ({ agent, task });

  test('single call shows the agent, its scope and the task cut at 60 characters', () => {
    const out = subagent.renderCall({ agent: 'scout', task: 'z'.repeat(SINGLE_PREVIEW_CHARS + 1), agentScope: 'project' });
    expect(out).toContain('subagent scout [project]');
    expect(out).toContain(`${'z'.repeat(SINGLE_PREVIEW_CHARS)}...`);
  });

  test('a call still being typed shows placeholders and the user scope', () => {
    const out = subagent.renderCall({});
    expect(out).toContain('subagent ...');
    expect(out).toContain('[user]');
  });

  test('chain call drops {previous}, cuts long tasks and counts the steps it does not list', () => {
    const chain = [item('a', 'x {previous}'), item('b', 'y'.repeat(ITEM_PREVIEW_CHARS + 1)), item('c', 'c'), item('d', 'd')];
    const out = subagent.renderCall({ chain, agentScope: 'both' });
    expect(out).toContain('chain (4 steps)');
    expect(out).toContain('1. a x');
    expect(out).not.toContain('{previous}');
    expect(out).toContain(`${'y'.repeat(ITEM_PREVIEW_CHARS)}...`);
    expect(out).toContain('... +1 more');
    expect(out).not.toContain('4. d');
  });

  test('parallel call lists its tasks with no overflow line when there are few', () => {
    const out = subagent.renderCall({ tasks: [item('a', 'one'), item('b', 'two')] });
    expect(out).toContain('parallel (2 tasks)');
    expect(out).toContain('a one');
    expect(out).not.toContain('more');
  });

  test('empty chain and tasks lists fall back to the single form', () => {
    expect(subagent.renderCall({ chain: [], tasks: [], agent: 'solo', task: 'go' })).toContain('solo');
  });
});
