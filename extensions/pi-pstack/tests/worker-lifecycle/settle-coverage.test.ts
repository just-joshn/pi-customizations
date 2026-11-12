import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { FAKE_PI, killTmuxServer, makeParent, makeProject, makeRun, type Parent, type Project, sleep, stopProject, tmux, until, workerDir, writeAssignment } from './harness.ts';

let project: Project;
let parent: Parent;

beforeEach(async () => {
  project = makeProject();
  makeRun(project, 'run1');
  parent = makeParent(project, [], { piCommand: [process.execPath, FAKE_PI] });
  await parent.start();
});

afterEach(async () => {
  await parent.stop();
  await stopProject(project);
});

afterAll(killTmuxServer);

const spawn = (workerId: string, brief: string) => parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: writeAssignment(project, 'run1', workerId, brief) });
const collect = async (workerId: string) => (await parent.call('pstack_worker', { action: 'collect', runId: 'run1', workerId })).details;
const state = async (workerId: string) => (await parent.call('pstack_worker', { action: 'inspect', runId: 'run1', workerId })).details.state;

test('a prompt response and its agent_settled in one stdout chunk settle the work', async () => {
  await spawn('w1', '@@chunk ONE');
  await until(
    () => state('w1'),
    (current) => current.settles.length === 1,
    10_000,
    'one settle',
  );
  expect(await collect('w1')).toMatchObject({ settled: true, finalText: 'ONE' });
});

test.for([
  ['stays queued', '@@say TWO'],
  ['has already started the next run', '@@stream TWO'],
] as const)('a steer acknowledged as a run ends never makes collect return that run (the steer %s)', async ([, steer]) => {
  await spawn('w2', '@@hold ONE');
  await until(
    () => state('w2'),
    (current) => current.phase === 'running',
    10_000,
    'held run',
  );
  await parent.call('pstack_worker', { action: 'steer', runId: 'run1', workerId: 'w2', message: steer });
  await sleep(600);
  expect(await collect('w2')).toMatchObject({ settled: false });

  writeFileSync(join(workerDir(project, 'run1', 'w2'), 'session', 'release'), '');
  const done = await until(
    () => collect('w2'),
    (result) => result.settled === true,
    10_000,
    'the steer settles',
  );
  expect(done.finalText).toBe('TWO');
});

test('a settle answered while Pi is still busy is recorded when the compaction that kept it busy ends', async () => {
  await spawn('w3', '@@settle-busy ONE');
  expect(
    await until(
      () => collect('w3'),
      (result) => result.settled === true,
      5_000,
      'the run settles after compaction_end',
    ),
  ).toMatchObject({ lastSettle: { phase: 'idle', generation: 1 }, finalText: 'ONE' });
});

test("a cancel whose run settled before Pi was quiescent records the abort when the host's cancel completes", async () => {
  await spawn('w4', '@@hold-late ONE');
  const { tmuxSession } = await until(
    () => state('w4'),
    (current) => current.phase === 'running',
    10_000,
    'held run',
  );
  await tmux('send-keys', '-t', tmuxSession, 'cancel', 'Enter');
  expect(
    await until(
      () => collect('w4'),
      (result) => result.settled === true,
      5_000,
      'the cancelled run settles',
    ),
  ).toMatchObject({ lastSettle: { phase: 'aborted', generation: 1 } });
});
