import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { SessionManager } from '@earendil-works/pi-coding-agent';
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type RunId, tmuxSessionName, type WorkerId } from '../../src/run-files.ts';
import { type Entry, killTmuxServer, liveTmuxSessions, makeParent, makeProject, makeRun, type Parent, type Project, readState, sleep, stopProject, transcript, until, wakes, writeAssignment } from '../worker-lifecycle/harness.ts';

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
  await stopProject(project);
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
      (sessions) => !sessions.includes(tmuxSessionName(project.dir, 'run1' as RunId, 'w3' as WorkerId)),
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

  test('more than 64 settles while no parent runs each wake the restarted parent once', async () => {
    const first = parentFor();
    await first.start();
    await spawn(first, 'w7', '@@say 1');
    await first.stop();
    const lastSequence = () => {
      try {
        return (readState(project, 'run1', 'w7').settles.at(-1)?.sequence ?? 0) as number;
      } catch {
        return 0;
      }
    };
    for (let count = 1; count <= 70; count += 1) {
      await until(lastSequence, (sequence) => sequence === count, 20_000, `settle ${count}`);
      if (count < 70) await first.call('pstack_worker', { action: 'steer', runId: 'run1', workerId: 'w7', message: `@@say ${count + 1}` });
    }
    expect(first.messages).toHaveLength(0);

    const second = parentFor();
    await second.start();
    expect(wakes(second).map((wake) => Number(wake?.transitionId.split(':')[2]))).toEqual(Array.from({ length: 70 }, (_, index) => index + 1));
    await sleep(600);
    expect(wakeIds()).toHaveLength(70);
  }, 180_000);

  test('a wake whose sendMessage threw is sent on the next poll', async () => {
    const parent = parentFor({ failSends: 1 });
    await parent.start();
    await spawn(parent, 'w8', '@@say DONE');
    await until(
      () => wakes(parent),
      (list) => list.length === 1,
      20_000,
      'wake after a failed send',
    );
    await sleep(600);
    expect(wakeIds()).toHaveLength(1);
  });
});

describe('wake delivery on a real session tree', () => {
  const realSession = () => {
    const sessionDir = join(project.home, 'real-sessions');
    mkdirSync(sessionDir, { recursive: true });
    const session = SessionManager.create(project.dir, sessionDir);
    const root = session.appendMessage({ role: 'user', content: 'start the run', timestamp: Date.now() });
    makeRun(project, 'run2', session.getSessionFile() as string);
    return { session, root };
  };
  const spawnIn = (parent: Parent, workerId: string, brief: string) => parent.call('pstack_worker', { action: 'spawn', runId: 'run2', assignmentPath: writeAssignment(project, 'run2', workerId, brief, { runId: 'run2' }) });
  const branchWakes = (session: SessionManager) => session.getBranch().filter((entry) => entry.type === 'custom_message' && entry.customType === 'pstack-worker');

  test('navigating the tree to before a wake makes the parent deliver it again on the new branch', async () => {
    const { session, root } = realSession();
    const parent = parentFor({ sessionManager: session });
    await parent.start();
    await spawnIn(parent, 'w1', '@@say DONE');
    await until(
      () => parent.messages.length,
      (count) => count === 1,
      20_000,
      'first wake',
    );
    expect(branchWakes(session)).toHaveLength(1);

    session.branch(root);
    expect(branchWakes(session)).toHaveLength(0);
    await parent.fire('session_tree', { newLeafId: root, oldLeafId: null, fromExtension: false });
    await until(
      () => branchWakes(session).length,
      (count) => count === 1,
      5_000,
      'wake on the new branch',
    );
    await sleep(600);
    expect(parent.messages).toHaveLength(2);
    expect(new Set(parent.messages.map((entry) => entry.message.details?.transitionId)).size).toBe(1);
  });

  test('a poll in flight when the parent switches session sends nothing into the new session, and the owner gets its wake once', async () => {
    const { session: owner } = realSession();
    const spawner = parentFor({ sessionManager: owner });
    await spawner.start();
    // The run outlasts the spawner, so no poll of the spawner's can deliver the wake first.
    await spawnIn(spawner, 'w3', '@@sleep 1500 DONE');
    await spawner.stop();
    expect(spawner.messages).toHaveLength(0);
    await until(
      () => readState(project, 'run2', 'w3').settles.length,
      (count) => count === 1,
      20_000,
      'settle with no parent',
    );

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const parent = parentFor({ sessionManager: SessionManager.open(owner.getSessionFile() as string), beforeTmux: () => gate });
    const starting = parent.start();
    await sleep(200);
    const other = SessionManager.create(project.dir, join(project.home, 'other-sessions'));
    const switching = parent.switchSession(other);
    release();
    await Promise.all([starting, switching]);
    await sleep(600);
    expect(branchWakes(other)).toHaveLength(0);
    expect(parent.messages).toHaveLength(0);

    const reopened = SessionManager.open(owner.getSessionFile() as string);
    await parent.switchSession(reopened);
    await sleep(600);
    expect(branchWakes(reopened).map((entry) => (entry as { details: { transitionId: string } }).details.transitionId)).toEqual([expect.stringMatching(/^w3:[0-9a-f-]{36}:1$/)]);
    expect(parent.messages).toHaveLength(1);
  });

  test('a wake summarized by compaction still counts as delivered and is not resent', async () => {
    const { session } = realSession();
    const first = parentFor({ sessionManager: session });
    await first.start();
    await spawnIn(first, 'w4', '@@say DONE');
    await until(
      () => first.messages.length,
      (count) => count === 1,
      20_000,
      'first wake',
    );
    await first.stop();
    const wakeInContext = () => session.buildSessionContext().messages.some((message) => (message as { customType?: string }).customType === 'pstack-worker');
    expect(wakeInContext()).toBe(true);
    const kept = session.appendMessage({ role: 'user', content: 'later work', timestamp: Date.now() });
    session.appendCompaction('Worker w4 finished; its wake was handled.', kept, 1_000);
    expect(wakeInContext()).toBe(false);
    expect(branchWakes(session)).toHaveLength(1);

    const reopened = SessionManager.open(session.getSessionFile() as string);
    const second = parentFor({ sessionManager: reopened });
    await second.start();
    await second.fire('session_compact', { compactionEntry: reopened.getLeafEntry(), fromExtension: false });
    await sleep(600);
    expect(second.messages).toHaveLength(0);
  });

  test('a parent reopened from the session file finds the wake on its branch and does not resend it', async () => {
    const { session } = realSession();
    const first = parentFor({ sessionManager: session });
    await first.start();
    await spawnIn(first, 'w2', '@@say DONE');
    await until(
      () => first.messages.length,
      (count) => count === 1,
      20_000,
      'first wake',
    );
    await first.stop();

    const reopened = SessionManager.open(session.getSessionFile() as string);
    const second = parentFor({ sessionManager: reopened });
    await second.start();
    await sleep(600);
    expect(second.messages).toHaveLength(0);
  });
});
