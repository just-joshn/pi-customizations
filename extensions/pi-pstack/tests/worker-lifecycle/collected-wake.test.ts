// A settle the parent already collected owes it no wake: the wake would trigger a turn that repeats a result the parent holds.
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { killTmuxServer, makeParent, makeProject, makeRun, type Parent, type Project, stopProject, until, wakes, writeAssignment } from './harness.ts';

let project: Project;
let parent: Parent;

beforeEach(async () => {
  project = makeProject();
  makeRun(project, 'run1');
  parent = makeParent(project, [], { pollMs: 60_000 });
  await parent.start();
});

afterEach(async () => {
  await parent.stop();
  await stopProject(project);
});

afterAll(killTmuxServer);

const call = (action: string, workerId: string, extra: Record<string, unknown> = {}) => parent.call('pstack_worker', { action, runId: 'run1', workerId, ...extra });
const spawn = (workerId: string, brief: string) => parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: writeAssignment(project, 'run1', workerId, brief) });
const settles = async (workerId: string) => ((await call('inspect', workerId)).details.state?.settles ?? []).length;
const settled = (workerId: string, count: number) => until(() => settles(workerId), (n) => n >= count, 20_000, `${workerId} settle ${count}`);
const wokenFor = (workerId: string) => wakes(parent).filter((wake) => wake?.workerId === workerId);

test('a settle collected before the poll sees it sends no wake, and an uncollected one still does', async () => {
  await spawn('seen', '@@say DONE');
  await spawn('unseen', '@@say DONE');
  await settled('seen', 1);
  await settled('unseen', 1);
  expect((await call('collect', 'seen')).details.settled).toBe(true);

  await parent.fire('session_tree');
  await until(
    async () => wokenFor('unseen').length,
    (n) => n === 1,
    10_000,
    'the uncollected worker wakes the parent',
  );
  expect(wokenFor('seen')).toEqual([]);

  await parent.fire('session_tree');
  await parent.fire('session_tree');
  expect(wokenFor('seen')).toEqual([]);
});

test('a settle that comes after the collect wakes the parent again', async () => {
  await spawn('again', '@@say FIRST');
  await settled('again', 1);
  await call('collect', 'again');
  await call('steer', 'again', { message: '@@say SECOND' });
  await settled('again', 2);

  await parent.fire('session_tree');
  await until(
    async () => wokenFor('again').length,
    (n) => n === 1,
    10_000,
    'the second settle wakes the parent',
  );
  expect(wokenFor('again')[0]).toMatchObject({ transitionId: expect.stringMatching(/:2$/) });
});
