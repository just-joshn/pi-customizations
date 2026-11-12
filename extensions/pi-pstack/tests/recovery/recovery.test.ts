import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type Entry, killTmuxServer, liveTmuxSessions, makeParent, makeProject, makeRun, type Parent, type Project, readState, sleep, tmux, transcript, until, wakes, writeAssignment } from '../worker-lifecycle/harness.ts';

let project: Project;
let entries: Entry[];
const parents: Parent[] = [];

const parentFor = (options: Parameters<typeof makeParent>[2] = {}) => {
  const parent = makeParent(project, entries, options);
  parents.push(parent);
  return parent;
};

beforeEach(() => {
  project = makeProject();
  makeRun(project, 'run1');
  entries = [];
});

afterEach(async () => {
  for (const parent of parents.splice(0)) await parent.stop();
  for (const session of await liveTmuxSessions()) await tmux('kill-session', '-t', session).catch(() => undefined);
  project.dispose();
});

afterAll(killTmuxServer);

const settles = (workerId: string) => {
  try {
    return readState(project, 'run1', workerId).settles.length as number;
  } catch {
    return 0;
  }
};
const wakeIds = () => entries.filter((entry) => entry.customType === 'pstack-worker').map((entry) => entry.details?.transitionId);
const spawn = (parent: Parent, workerId: string, brief: string) => parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: writeAssignment(project, 'run1', workerId, brief) });

describe('parent restart', () => {
  test('a worker that settles while no parent runs wakes the restarted parent exactly once', async () => {
    const first = parentFor();
    await first.start();
    await spawn(first, 'w1', '@@sleep 1500 WHILE-AWAY');
    await first.stop();

    await until(
      () => settles('w1'),
      (count) => count === 1,
      20_000,
      'settle with no parent',
    );
    await sleep(500);
    expect(first.messages).toHaveLength(0);

    const second = parentFor();
    await second.start();
    expect(wakes(second)).toEqual([{ transitionId: expect.stringMatching(/^w1:[0-9a-f-]{36}:1$/), runId: 'run1', workerId: 'w1', phase: 'idle' }]);
    await sleep(600);
    expect(wakes(second)).toHaveLength(1);

    const third = parentFor();
    await third.start();
    await sleep(600);
    expect(third.messages).toHaveLength(0);
    expect(wakeIds()).toHaveLength(1);
  });

  test('the restarted parent reconciles a live worker, controls it, and gets each later settle once', async () => {
    const first = parentFor();
    await first.start();
    await spawn(first, 'w2', '@@say ONE');
    await until(
      () => wakes(first),
      (list) => list.length === 1,
      20_000,
      'first wake',
    );
    await first.stop();

    const second = parentFor();
    await second.start();
    await sleep(500);
    expect(second.messages).toHaveLength(0);
    const inspected = await second.call('pstack_worker', { action: 'inspect', runId: 'run1', workerId: 'w2' });
    expect(inspected.details).toMatchObject({ available: true, state: { phase: 'idle' } });

    await second.call('pstack_worker', { action: 'steer', runId: 'run1', workerId: 'w2', message: '@@say TWO' });
    await until(
      () => wakes(second),
      (list) => list.length === 1,
      20_000,
      'second wake',
    );
    expect(wakes(second)[0]).toMatchObject({ transitionId: expect.stringMatching(/^w2:[0-9a-f-]{36}:2$/), phase: 'idle' });
    expect(transcript(project, 'run1', 'w2')).toEqual(expect.arrayContaining(['assistant:ONE', 'assistant:TWO']));
    await sleep(600);
    expect(wakeIds()).toHaveLength(2);
    expect(new Set(wakeIds()).size).toBe(2);
  });

  test('a host killed while no parent runs is reported unavailable once, never complete', async () => {
    const first = parentFor();
    await first.start();
    await spawn(first, 'w3', '@@sleep 5000 NEVER');
    await until(
      () => readState(project, 'run1', 'w3').phase,
      (phase) => phase === 'running',
      10_000,
      'running',
    );
    const { hostPid, childPid } = readState(project, 'run1', 'w3');
    await first.stop();
    process.kill(hostPid, 'SIGKILL');
    await until(
      () => liveTmuxSessions(),
      (sessions) => !sessions.includes('pstack-run1-w3'),
      5_000,
      'session gone',
    );

    const second = parentFor();
    await second.start();
    expect(wakes(second)).toEqual([{ transitionId: expect.stringMatching(/^w3:[0-9a-f-]{36}:1$/), runId: 'run1', workerId: 'w3', phase: 'unavailable' }]);
    const collected = await second.call('pstack_worker', { action: 'collect', runId: 'run1', workerId: 'w3' });
    expect(collected.details).toMatchObject({ settled: false, live: { phase: 'unavailable' } });
    await sleep(600);
    expect(wakeIds()).toHaveLength(1);
    try {
      process.kill(-childPid, 'SIGKILL');
    } catch {
      // Pi exits on its own once the host's pipe closes.
    }
  });
});

describe('wake delivery record', () => {
  test('a wake already present in the session entries is not resent', async () => {
    const first = parentFor();
    await first.start();
    await spawn(first, 'w4', '@@say DONE');
    await until(
      () => wakes(first),
      (list) => list.length === 1,
      20_000,
      'wake',
    );
    const recorded = entries.slice();
    await first.stop();

    entries = recorded;
    const second = parentFor();
    await second.start();
    await sleep(600);
    expect(second.messages).toHaveLength(0);
  });

  test('a wake handed to Pi but not yet persisted is not resent by the same parent', async () => {
    const parent = parentFor({ persist: false });
    await parent.start();
    await spawn(parent, 'w5', '@@say QUEUED');
    await until(
      () => wakes(parent),
      (list) => list.length === 1,
      20_000,
      'wake',
    );
    await sleep(800);
    expect(wakes(parent)).toHaveLength(1);
    expect(entries).toHaveLength(0);
  });

  test('a run owned by another session never wakes this one', async () => {
    const owner = parentFor();
    await owner.start();
    await spawn(owner, 'w6', '@@say MINE');
    await until(
      () => wakes(owner),
      (list) => list.length === 1,
      20_000,
      'owner wake',
    );

    entries = [];
    const stranger = parentFor({ sessionFile: `${project.home}/other.jsonl` });
    await stranger.start();
    await sleep(600);
    expect(stranger.messages).toHaveLength(0);
  });
});
