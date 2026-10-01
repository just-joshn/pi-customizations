import { expect, onTestFinished, vi } from 'vitest';
import { loggedCommands, newTask, permissionLog, test } from './child-harness.ts';

test.for([
  { name: 'approved', answer: true, output: 'answer: confirmed=true cancelled=undefined' },
  { name: 'denied', answer: false, output: 'answer: confirmed=false cancelled=undefined' },
])('a permission ask the parent $name reaches the child as $answer', async ({ answer, output }, { workspace }) => {
  const log = permissionLog(answer);
  const { task } = newTask(workspace, { log });
  await task.open();

  const record = await task.begin('ask:pstack-permission:bash');

  expect(record.output).toBe(output);
  expect(log.asks).toEqual([{ title: 'worker wants to use bash', body: 'run it' }]);
});

test('a disallowed tool ask is cancelled without asking the parent', async ({ workspace }) => {
  const log = permissionLog();
  const { task } = newTask(workspace, { log });
  await task.open();

  const record = await task.begin('ask:pstack-permission:curl');

  expect(record.output).toBe('answer: confirmed=undefined cancelled=true');
  expect(log.asks).toEqual([]);
});

test('a rebound task uses the new parent ask plus idle state', async ({ workspace }) => {
  const original = permissionLog(false);
  const { task, host } = newTask(workspace, { kind: 'teammate', log: original });
  await task.open();
  const asks: string[] = [];

  task.rebind(
    async (title) => {
      asks.push(title);
      return true;
    },
    () => false,
  );
  const record = await task.begin('ask:pstack-permission:bash');

  expect(record.output).toBe('answer: confirmed=true cancelled=undefined');
  expect([asks, original.asks, host.settlements[0]?.parentIdle]).toEqual([['worker wants to use bash'], [], false]);
});

test.for([
  { mode: 'steer' as const, type: 'steer' },
  { mode: 'followUp' as const, type: 'follow_up' },
])('a $mode message is delivered to the running child as $type', async ({ mode, type }, { workspace }) => {
  const { task } = newTask(workspace, { kind: 'teammate' });
  await task.open();
  void task.begin('hang');

  await task.steer('go left', mode);

  expect(await loggedCommands(workspace)).toContainEqual(expect.objectContaining({ type, message: 'go left' }));
});

test('stopping a running turn records a remote cancel', async ({ workspace }) => {
  const closed: string[] = [];
  const closePane = async () => {
    closed.push('pane');
  };
  const { task, host } = newTask(workspace, { kind: 'teammate', closePane });
  await task.open();
  const turn = task.begin('hang');

  const stopped = await task.stop();

  expect(stopped).toMatchObject({ status: 'interrupted', output: '', abort: { reason: 'remote-cancel', telemetry: 'remote_cancel', userInitiated: true } });
  expect(await turn).toBe(stopped);
  expect(host.settlements).toEqual([{ record: stopped, output: '', send: false, parentIdle: true }]);
  expect((await loggedCommands(workspace)).map((command) => command.type)).toContain('abort');
  expect([task.alive, closed]).toEqual([false, ['pane']]);
});

test('stopping before any turn resolves the launch record', async ({ workspace }) => {
  const { task } = newTask(workspace, { kind: 'teammate' });
  await task.open();

  const record = await task.stop();

  expect(record).toMatchObject({ id: 'task-1', status: 'running' });
  expect(task.alive).toBe(false);
});

test('a child ignoring closed stdin gets SIGTERM after the grace period', async ({ workspace }) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const { task } = newTask(workspace, { kind: 'teammate', env: { FAKE_PI_STUBBORN: 'term' } });
  await task.open();

  const stopped = task.stop();
  await vi.advanceTimersByTimeAsync(3000);

  expect(await stopped).toMatchObject({ id: 'task-1' });
  expect(task.alive).toBe(false);
});

test('a child that ignores SIGTERM too is killed with SIGKILL', async ({ workspace }) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const { task } = newTask(workspace, { kind: 'teammate', env: { FAKE_PI_STUBBORN: 'kill' } });
  await task.open();

  const stopped = task.stop();
  await vi.advanceTimersByTimeAsync(3000);
  await vi.advanceTimersByTimeAsync(3000);

  expect(await stopped).toMatchObject({ id: 'task-1' });
  expect(task.alive).toBe(false);
});

test('a pane that fails to close does not fail the stop', async ({ workspace }) => {
  const { task } = newTask(workspace, { kind: 'teammate', closePane: () => Promise.reject(new Error('pane gone')) });
  await task.open();

  await expect(task.stop()).resolves.toMatchObject({ id: 'task-1' });
});
