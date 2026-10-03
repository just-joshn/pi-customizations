import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ShellResult } from '../src/subagents/shell-command.ts';
import { StatusLinePoller, type StatusLineSources } from '../src/subagents/status-line.ts';
import type { TaskSnapshot } from '../src/subagents/task-snapshots.ts';

const task = (id: string, tokenCount = 0): TaskSnapshot => ({
  id,
  name: `name-${id}`,
  type: 'local_agent',
  agentType: 'Explore',
  status: 'running',
  description: `describe ${id}`,
  startTime: 1000,
  model: 'p/m',
  effort: 'high',
  contextWindowSize: 200000,
  tokenCount,
  cwd: '/work',
});

function harness(overrides: Partial<StatusLineSources> = {}, output: ShellResult = { code: 0, stdout: '', stderr: '' }) {
  const logs: string[] = [];
  const applied: Record<string, string>[] = [];
  const runs: { command: string; input: { tasks: { tokenSamples: number[] }[] }; cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }[] = [];
  let tasks: TaskSnapshot[] = [task('a', 5)];
  const sources: StatusLineSources = {
    tasks: () => tasks,
    command: async () => 'status-cmd',
    trusted: () => true,
    enabled: () => true,
    columns: () => 120,
    base: () => ({ session_id: 's1', transcript_path: '/t/s1.jsonl', cwd: '/work' }),
    run: async (command, options) => {
      runs.push({ command, input: JSON.parse(options.input), cwd: options.cwd, env: options.env, timeoutMs: options.timeoutMs });
      return output;
    },
    log: (message) => logs.push(message),
    apply: (decorations) => applied.push({ ...decorations }),
    ...overrides,
  };
  const poller = new StatusLinePoller(sources);
  return { poller, logs, applied, runs, setTasks: (next: TaskSnapshot[]) => (tasks = next) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('[C102] polling starts after 300 ms and repeats every 5 s until stopped', async () => {
  const { poller, runs } = harness();
  poller.start();
  await vi.advanceTimersByTimeAsync(299);
  expect(runs).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(runs).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(4700);
  expect(runs).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(5000);
  expect(runs).toHaveLength(3);
  poller.stop();
  await vi.advanceTimersByTimeAsync(20000);
  expect(runs).toHaveLength(3);
});

test('[C99] an untrusted workspace never runs the command and logs the skip', async () => {
  const { poller, runs, logs } = harness({ trusted: () => false });
  await poller.tick();
  expect(runs).toEqual([]);
  expect(logs).toEqual(['Skipping subagentStatusLine execution - workspace trust not accepted']);
});

test.for([
  { name: 'no configured command', overrides: { command: async () => undefined } },
  { name: 'disabled status line', overrides: { enabled: () => false } },
])('[C99] $name never runs the command', async ({ overrides }) => {
  const { poller, runs, logs } = harness(overrides);
  await poller.tick();
  expect(runs).toEqual([]);
  expect(logs).toEqual([]);
  const control = harness();
  await control.poller.tick();
  expect(control.runs.map((run) => run.command)).toEqual(['status-cmd']);
});

test('[C100] the command receives project, terminal and per-task data as JSON stdin', async () => {
  const { poller, runs } = harness();
  await poller.tick();
  await poller.tick();
  expect(runs[1]).toEqual({
    command: 'status-cmd',
    cwd: '/work',
    timeoutMs: 5000,
    env: expect.objectContaining({ CLAUDE_PROJECT_DIR: '/work' }),
    input: {
      session_id: 's1',
      transcript_path: '/t/s1.jsonl',
      cwd: '/work',
      columns: 120,
      tasks: [
        {
          id: 'a',
          name: 'name-a',
          type: 'local_agent',
          status: 'running',
          description: 'describe a',
          label: 'describe a',
          startTime: 1000,
          model: 'p/m',
          effort: 'high',
          contextWindowSize: 200000,
          tokenCount: 5,
          tokenSamples: [5, 5],
          cwd: '/work',
        },
      ],
    },
  });
});

test('[C100] token samples keep the 16 most recent counts per task and drop finished tasks', async () => {
  const state = harness();
  for (let count = 1; count <= 18; count += 1) {
    state.setTasks([task('a', count)]);
    await state.poller.tick();
  }
  expect(state.runs.at(-1)?.input.tasks[0]?.tokenSamples).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  state.setTasks([task('b', 1)]);
  await state.poller.tick();
  state.setTasks([task('a', 50)]);
  await state.poller.tick();
  expect(state.runs.at(-1)?.input.tasks[0]?.tokenSamples).toEqual([50]);
});

test('[C101] valid JSON lines map to task ids while invalid lines and unknown ids are logged or dropped', async () => {
  const stdout = ['{"id":"a","content":"42% ctx"}', 'not json', '{"id":"a"}', '{"id":"gone","content":"x"}', ''].join('\n');
  const { poller, applied, logs } = harness({}, { code: 0, stdout, stderr: '' });
  await poller.tick();
  expect(applied).toEqual([{ a: '42% ctx' }]);
  expect(logs).toHaveLength(2);
  expect(logs[0]).toBe('subagentStatusLine emitted non-JSON line: not json');
  expect(logs[1]).toMatch(/^subagentStatusLine emitted invalid schema: /);
});

test('[C101] a failing command is logged and clears decorations', async () => {
  const { poller, applied, logs } = harness({}, { code: 2, stdout: '{"id":"a","content":"x"}', stderr: 'bad things' });
  await poller.tick();
  expect(logs).toEqual(['subagentStatusLine exited 2: bad things']);
  expect(applied).toEqual([{}]);
});

test('[C101] a tick that throws is logged', async () => {
  const { poller, logs } = harness({ run: async () => Promise.reject(new Error('spawn exploded')) });
  await poller.tick();
  expect(logs).toEqual(['subagentStatusLine tick failed: Error: spawn exploded']);
});

test('[C101] with no visible tasks stale decorations are cleared without running the command', async () => {
  const { poller, applied, runs, setTasks } = harness();
  setTasks([]);
  await poller.tick();
  expect(runs).toEqual([]);
  expect(applied).toEqual([{}]);
});

test('[C101] a tick in flight ignores a second tick until the first settles', async () => {
  let finish: (result: ShellResult) => void = () => {};
  const pending = new Promise<ShellResult>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  const { poller, applied } = harness({
    run: async () => {
      calls += 1;
      return pending;
    },
  });
  const first = poller.tick();
  await poller.tick();
  finish({ code: 0, stdout: '{"id":"a","content":"ready"}', stderr: '' });
  await first;
  expect(calls).toBe(1);
  expect(applied.at(-1)).toEqual({ a: 'ready' });
  await poller.tick();
  expect(calls).toBe(2);
});

test('[C101] a tick that fails still releases the lock for the next attempt', async () => {
  let calls = 0;
  const { poller, applied, logs } = harness({
    run: async () => {
      calls += 1;
      if (calls === 1) throw new Error('spawn exploded');
      return { code: 0, stdout: '{"id":"a","content":"back"}', stderr: '' };
    },
  });
  await poller.tick();
  expect(logs).toEqual(['subagentStatusLine tick failed: Error: spawn exploded']);
  expect(applied).toEqual([]);
  await poller.tick();
  expect(applied).toEqual([{ a: 'back' }]);
});
