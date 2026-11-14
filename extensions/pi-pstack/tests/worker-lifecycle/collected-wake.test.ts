// A settle the parent already collected owes it no wake: the wake would trigger a turn that repeats a result the parent holds.
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { controlSocketPath } from '../../src/run-files.ts';
import { FAKE_PI, killTmuxServer, liveTmuxSessions, makeParent, makeProject, makeRun, type Parent, type Project, stopProject, until, wakes, workerDir, writeAssignment } from './harness.ts';

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
const settled = (workerId: string, count: number) =>
  until(
    () => settles(workerId),
    (n) => n >= count,
    20_000,
    `${workerId} settle ${count}`,
  );
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

test('a worker collected during the parent turn causes no late follow-up, while an uncollected worker still triggers one', async () => {
  await parent.stop();
  let idle = false;
  parent = makeParent(project, [], { pollMs: 60_000, isIdle: () => idle });
  await parent.start();
  await spawn('seen', '@@say DONE');
  await spawn('unseen', '@@say DONE');
  await settled('seen', 1);
  await settled('unseen', 1);

  await parent.fire('session_tree');
  await call('collect', 'seen');
  idle = true;
  await parent.fire('session_tree');

  expect(wokenFor('seen')).toEqual([]);
  expect(wokenFor('unseen')).toHaveLength(1);
  expect(parent.messages[0]?.options).toEqual({ triggerTurn: true, deliverAs: 'followUp' });
});

test.each(['print', 'json', 'rpc', 'tui'] as const)('%s delivers needed follow-ups before final settlement without waking for an in-turn collect', async (mode) => {
  await parent.stop();
  let tmuxGate = Promise.resolve();
  parent = makeParent(project, [], { mode, pollMs: 60_000, isIdle: () => false, beforeTmux: () => tmuxGate });
  await parent.start();
  await spawn('seen', '@@say DONE');
  await spawn('unseen', '@@say DONE');
  await settled('seen', 1);
  await settled('unseen', 1);

  let release = () => {};
  tmuxGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scanning = parent.fire('session_tree');
  await call('collect', 'seen');
  const boundary = parent.fire('agent_before_settle', { outcome: 'completed' });
  release();
  await scanning;
  await boundary;

  expect(wokenFor('seen')).toEqual([]);
  expect(wokenFor('unseen')).toHaveLength(1);
  expect(parent.messages[0]?.options).toEqual({ triggerTurn: true, deliverAs: 'followUp' });
  await parent.fire('agent_before_settle', { outcome: 'completed' });
  expect(wokenFor('unseen')).toHaveLength(1);
});

test.each(['confirmed', 'refused', 'unknown'] as const)('an independent failure still wakes after a %s abort', async (outcome) => {
  await parent.stop();
  parent = makeParent(project, [], { pollMs: 60_000, startCheckMs: 20, piCommand: [process.execPath, FAKE_PI], resolveModel: () => ({ provider: 'openai', id: 'gpt-fake', thinkingLevel: null }) });
  await parent.start();
  const spawned = await spawn('failed', '@@error-window INDEPENDENT');
  await settled('failed', 1);
  if (outcome === 'refused') {
    const state = (await call('inspect', 'failed')).details.state;
    process.kill(state.hostPid, 'SIGKILL');
    await until(liveTmuxSessions, (sessions) => !sessions.includes(spawned.details.tmuxSession), 5_000, 'host gone');
    rmSync(join(workerDir(project, 'run1', 'failed'), 'claim', 'tmux.json'));
  }
  if (outcome === 'unknown') {
    rmSync(join(workerDir(project, 'run1', 'failed'), 'claim', 'identity.json'));
    rmSync(controlSocketPath(project.runRoot('run1'), 'failed' as never));
  }
  const receipt = await call('abort', 'failed');
  expect(receipt.details.disposition).toBe(outcome === 'confirmed' ? 'stopped' : 'refused');
  if (outcome === 'unknown') expect(receipt.details.reason).toContain('no host claimed the worker');
  await parent.fire('agent_before_settle', { outcome: 'completed' });
  expect(wokenFor('failed').some((wake) => wake?.phase === 'failed')).toBe(true);
});

test('a confirmed parent abort owes no cancellation wake, including after resumption', async () => {
  await parent.stop();
  parent = makeParent(project, [], { pollMs: 1 });
  await parent.start();
  await spawn('cancelled', '@@wait NEVER');
  await spawn('independent', '@@say DONE');
  await settled('independent', 1);
  await call('abort', 'cancelled');
  await call('abort', 'independent');
  await parent.fire('agent_before_settle', { outcome: 'completed' });
  expect(wokenFor('cancelled').filter((wake) => wake?.phase === 'aborted')).toEqual([]);
  await parent.stop();
  parent = makeParent(project, [], { pollMs: 60_000 });
  await parent.start();
  await parent.fire('agent_before_settle', { outcome: 'completed' });
  expect(wokenFor('cancelled').filter((wake) => wake?.phase === 'aborted')).toEqual([]);
  expect(wokenFor('independent').some((wake) => wake?.phase === 'idle')).toBe(true);
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
