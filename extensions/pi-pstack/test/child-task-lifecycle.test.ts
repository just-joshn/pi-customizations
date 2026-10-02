import { readFile } from 'node:fs/promises';

import { expect, vi } from 'vitest';
import { newTask, test } from './child-harness.ts';

test('a fresh task has its identity but no process', async ({ workspace }) => {
  const { task } = newTask(workspace, { id: 'abc', kind: 'teammate' });

  expect([task.id, task.kind, task.alive]).toEqual(['abc', 'teammate', false]);
  expect((await task.done).id).toBe('abc');
});

test('opening reports the session the child persisted', async ({ workspace }) => {
  const { task } = newTask(workspace);

  const session = await task.open();

  expect(session).toEqual({ sessionId: 'sess-fake', sessionFile: `${workspace.dir}/session.jsonl` });
  expect(task.alive).toBe(true);
});

test('opening with a session file resumes that session', async ({ workspace }) => {
  const { task } = newTask(workspace);

  const session = await task.open('/sessions/earlier.jsonl');

  expect(session.sessionFile).toBe('/sessions/earlier.jsonl');
});

test.for([
  { name: 'reports no session', state: 'none', reason: 'pi did not report a persisted session' },
  { name: 'rejects the state request', state: 'error', reason: 'no session store' },
])('opening fails with a killed process when the child $name', async ({ state, reason }, { workspace }) => {
  const { task } = newTask(workspace, { env: { FAKE_PI_STATE: state } });

  await expect(task.open()).rejects.toThrow(`Failed to create remote pi session: ${reason}`);

  await vi.waitFor(() => expect(task.alive).toBe(false));
});

test('prompting or steering before opening is refused', async ({ workspace }) => {
  const { task } = newTask(workspace);

  await expect(task.begin('hello')).rejects.toThrow('Task has no running pi process.');
  await expect(task.steer('now', 'steer')).rejects.toThrow('Task has no running pi process.');
});

test('a remote turn settles with its results, then ends the process', async ({ workspace }) => {
  const { task, host } = newTask(workspace);
  await task.open();

  const record = await task.begin('hello');

  expect(record).toMatchObject({ id: 'task-1', status: 'settled', output: 'done: hello', toolUseCount: 2, totalTokens: 10 });
  expect(record.usage).toEqual({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.5 } });
  expect(host.settlements).toEqual([{ record, output: 'done: hello', send: true, parentIdle: true }]);
  expect(task.alive).toBe(false);
  expect(await task.done).toBe(record);
});

test('assistant text is appended to the task output file as it arrives', async ({ workspace }) => {
  const { task } = newTask(workspace);
  await task.open();

  await task.begin('hello');

  await vi.waitFor(async () => expect(await readFile(workspace.outputFile, 'utf8')).toBe('done: hello\n'));
});

test('a teammate keeps its process for follow-up turns', async ({ workspace }) => {
  const { task, host } = newTask(workspace, { kind: 'teammate' });
  await task.open();

  const first = await task.begin('one');
  const second = await task.begin('two');

  expect([first.output, second.output]).toEqual(['done: one', 'done: two']);
  expect(host.settlements).toHaveLength(2);
  expect(task.alive).toBe(true);
});

test('a model error fails the task with the error message', async ({ workspace }) => {
  const { task } = newTask(workspace);
  await task.open();

  const record = await task.begin('fail');

  expect(record).toMatchObject({ status: 'failed', output: 'model exploded' });
});

test('an aborted assistant message interrupts the task', async ({ workspace }) => {
  const { task } = newTask(workspace);
  await task.open();

  const record = await task.begin('abort');

  expect(record).toMatchObject({ status: 'interrupted', output: '' });
  expect(record.abort).toBeUndefined();
});

test('a settled turn without session stats carries no usage', async ({ workspace }) => {
  const { task } = newTask(workspace, { env: { FAKE_PI_STATS: 'off' } });
  await task.open();

  const record = await task.begin('hello');

  expect(record.status).toBe('settled');
  expect(record.usage).toBeUndefined();
});

test('a process that dies mid-turn fails the task with its stderr', async ({ workspace }) => {
  const { task } = newTask(workspace);
  await task.open();

  const record = await task.begin('die');

  expect(record).toMatchObject({ status: 'failed', output: 'pi exited before the task finished: crashed hard' });
});

test('a process that exits before the prompt fails the task', async ({ workspace }) => {
  const { task } = newTask(workspace, { env: { FAKE_PI_STATE: 'exit' } });
  await task.open();

  const record = await task.begin('hello');

  expect(record.status).toBe('failed');
  expect(record.output).toMatch(/^pi (exited 5|process has exited)/);
});

test('the cleanup hook patch is merged into the settled record', async ({ workspace }) => {
  const seen: string[] = [];
  const cleanup = async (record: { status: string }) => {
    seen.push(record.status);
    return { worktreeCleanlyRemoved: true };
  };
  const { task, host } = newTask(workspace, { cleanup });
  await task.open();

  const record = await task.begin('hello');

  expect(seen).toEqual(['settled']);
  expect(record.worktreeCleanlyRemoved).toBe(true);
  expect(host.settlements[0]?.record.worktreeCleanlyRemoved).toBe(true);
});

test('a cleanup hook that throws does not change the outcome', async ({ workspace }) => {
  const { task } = newTask(workspace, { cleanup: () => Promise.reject(new Error('cleanup broke')) });
  await task.open();

  const record = await task.begin('hello');

  expect(record).toMatchObject({ status: 'settled', output: 'done: hello' });
  expect(record).not.toHaveProperty('worktreeCleanlyRemoved');
});
