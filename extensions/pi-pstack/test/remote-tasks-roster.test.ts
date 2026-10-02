import { hostname } from 'node:os';

import { expect, onTestFinished } from 'vitest';
import { RemoteTasks, sessionUrl } from '../src/subagents/remote-tasks.ts';
import { childLaunch, FakeHost, loggedCommands, permissionLog, test, type Workspace } from './child-harness.ts';

function roster(): { tasks: RemoteTasks; host: FakeHost } {
  const host = new FakeHost();
  const tasks = new RemoteTasks(host);
  onTestFinished(async () => {
    await tasks.shutdown();
  });
  return { tasks, host };
}

async function startedArgs(workspace: Workspace): Promise<unknown[]> {
  return (await loggedCommands(workspace)).filter((entry) => entry.type === 'started').map((entry) => entry.args);
}

test('a session url names this host plus the session', () => {
  expect(sessionUrl('abc')).toBe(`pi-session://${hostname()}/abc`);
});

test('an empty roster knows no task', () => {
  const { tasks } = roster();

  expect([tasks.has('x'), tasks.list(), tasks.completion('x')]).toEqual([false, [], undefined]);
});

test('launching commits a running record with its session destination', async ({ workspace }) => {
  const { tasks, host } = roster();

  const record = await tasks.launch(childLaunch(workspace, { kind: 'teammate' }), 'hang');

  expect(record).toMatchObject({ id: 'task-1', status: 'running', sessionFile: `${workspace.dir}/session.jsonl`, destination: { kind: 'teammate', sessionId: 'sess-fake', sessionUrl: sessionUrl('sess-fake'), team: 'crew' } });
  expect(host.commits).toEqual([record]);
  expect([tasks.has('task-1'), tasks.list()]).toEqual([true, [{ id: 'task-1', kind: 'teammate', alive: true }]]);
});

test('a launched remote task completes through the roster', async ({ workspace }) => {
  const { tasks, host } = roster();

  await tasks.launch(childLaunch(workspace), 'hello');
  const done = await tasks.completion('task-1');

  expect(done).toMatchObject({ status: 'settled', output: 'done: hello' });
  expect(host.settlements.map((settlement) => settlement.output)).toEqual(['done: hello']);
  expect(tasks.list()).toEqual([{ id: 'task-1', kind: 'remote', alive: false }]);
});

test('a launch whose child cannot open leaves nothing behind', async ({ workspace }) => {
  const { tasks, host } = roster();

  await expect(tasks.launch(childLaunch(workspace, { env: { FAKE_PI_STATE: 'none' } }), 'hello')).rejects.toThrow('pi did not report a persisted session');

  expect([tasks.has('task-1'), host.commits]).toEqual([false, []]);
});

test('resuming a finished remote task reopens its session', async ({ workspace }) => {
  const { tasks, host } = roster();
  const launched = await tasks.launch(childLaunch(workspace), 'first');
  await tasks.completion('task-1');

  await tasks.resume(
    'task-1',
    'second',
    async () => true,
    () => true,
  );
  const done = await tasks.completion('task-1');

  expect(host.commits.at(-1)).toMatchObject({ id: 'task-1', status: 'running', output: '', sessionFile: launched.sessionFile });
  expect(done).toMatchObject({ status: 'settled', output: 'done: second' });
  expect(await startedArgs(workspace)).toEqual([[], ['--session', launched.sessionFile]]);
});

test('resuming a stopped teammate clears its abort info', async ({ workspace }) => {
  const { tasks, host } = roster();
  await tasks.launch(childLaunch(workspace, { kind: 'teammate' }), 'hang');
  const stopped = await tasks.stop('task-1');

  await tasks.resume(
    'task-1',
    'again',
    async () => true,
    () => true,
  );

  expect(stopped.abort).toMatchObject({ reason: 'remote-cancel' });
  expect(host.commits.at(-1)).not.toHaveProperty('abort');
  expect(await tasks.completion('task-1')).toMatchObject({ status: 'settled', output: 'done: again' });
});

test('resuming a live teammate reuses the process', async ({ workspace }) => {
  const { tasks, host } = roster();
  const next = permissionLog(true);
  const answer = async (title: string, body: string) => {
    next.asks.push({ title, body });
    return next.answer;
  };
  await tasks.launch(childLaunch(workspace, { kind: 'teammate' }), 'one');
  await tasks.completion('task-1');

  await tasks.resume('task-1', 'ask:pstack-permission:bash', answer, () => false);
  const done = await tasks.completion('task-1');

  expect(done?.output).toBe('answer: confirmed=true cancelled=undefined');
  expect([next.asks, host.settlements.at(-1)?.parentIdle, await startedArgs(workspace)]).toEqual([[{ title: 'worker wants to use bash', body: 'run it' }], false, [[]]]);
});

test('resuming an unknown task is refused', async () => {
  const { tasks } = roster();

  await expect(
    tasks.resume(
      'ghost',
      'hi',
      async () => true,
      () => true,
    ),
  ).rejects.toThrow('Unknown remote task: ghost');
});

test('a message reaches the running child by mode', async ({ workspace }) => {
  const { tasks } = roster();
  await tasks.launch(childLaunch(workspace, { kind: 'teammate' }), 'hang');

  await tasks.message('task-1', 'faster', 'followUp');

  expect(await loggedCommands(workspace)).toContainEqual(expect.objectContaining({ type: 'follow_up', message: 'faster' }));
});

test.for(['message', 'stop'] as const)('%s on an unknown task is refused', async (operation) => {
  const { tasks } = roster();

  const attempt = operation === 'message' ? tasks.message('ghost', 'hi', 'steer') : tasks.stop('ghost');

  await expect(attempt).rejects.toThrow('Unknown remote task: ghost');
});

test('shutdown stops every child, then empties the roster', async ({ workspace }) => {
  const { tasks } = roster();
  await tasks.launch(childLaunch(workspace, { id: 'a', kind: 'teammate' }), 'hang');
  await tasks.launch(childLaunch(workspace, { id: 'b', kind: 'teammate' }), 'hang');
  expect(tasks.list().map((task) => task.alive)).toEqual([true, true]);

  await tasks.shutdown();

  expect([tasks.has('a'), tasks.list()]).toEqual([false, []]);
  expect((await loggedCommands(workspace)).filter((entry) => entry.type === 'stdin_closed')).toHaveLength(2);
});
