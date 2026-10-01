import { AgentSession, DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { restoreTaskRecords } from '../src/worker-records.ts';
import { workerFixture } from './worker-fixture.ts';
import { workerTiming } from './worker-timing.ts';

function pauseReload() {
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const reload = DefaultResourceLoader.prototype.reload;
  const spy = vi.spyOn(DefaultResourceLoader.prototype, 'reload').mockImplementation(async function (this: DefaultResourceLoader) {
    await reload.call(this);
    entered();
    await gate;
  });
  return { release, ready, spy };
}

async function settled(f: Awaited<ReturnType<typeof workerFixture>>, id: string) {
  await vi.waitFor(
    () => {
      expect(restoreTaskRecords(f.session.sessionManager.getBranch()).get(id)?.status).toBe('settled');
    },
    { timeout: workerTiming.settlementDeadlineMs, interval: workerTiming.pollIntervalMs },
  );
  await f.session.waitForIdle();
}

test('resume refreshes pending usage after TaskOutput claims it during startup', async () => {
  const f = await workerFixture();
  let release = () => {};
  let reloadSpy: { mockRestore: () => void } | undefined;
  try {
    const initial = await f.call('Task', { prompt: 'WAIT' });
    const { id } = initial.details as { id: string };
    await settled(f, id);
    const gate = pauseReload();
    release = gate.release;
    reloadSpy = gate.spy;
    const resumed = f.call('Task', { prompt: 'second', resume: id, run_in_background: false });
    await gate.ready;
    expect((await f.call('TaskOutput', { task_id: id })).usage?.totalTokens).toBe(5);
    gate.release();
    expect((await resumed).usage?.totalTokens).toBe(5);
    expect((await f.call('TaskOutput', { task_id: id })).usage).toBeUndefined();
  } finally {
    release();
    reloadSpy?.mockRestore();
    await f.close();
  }
});

test('overlapping shutdowns observe cleanup failures in cancelled startup', async () => {
  const f = await workerFixture();
  const failures: string[] = [];
  const unsubscribe = f.session.extensionRunner.onError((error) => failures.push(error.error));
  const gate = pauseReload();
  const dispose = AgentSession.prototype.dispose;
  const disposeSpy = vi.spyOn(AgentSession.prototype, 'dispose').mockImplementation(function (this: AgentSession) {
    dispose.call(this);
    if (this !== f.session) throw new Error('startup cleanup failed');
  });
  try {
    const starting = expect(f.call('Task', { prompt: 'cancelled' })).rejects.toThrow(/startup cleanup failed/);
    await gate.ready;
    const first = f.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    const second = f.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    gate.release();
    await Promise.all([starting, first, second]);
    expect(failures.filter((error) => error.includes('startup cleanup failed')).length).toBe(2);
  } finally {
    gate.release();
    gate.spy.mockRestore();
    disposeSpy.mockRestore();
    unsubscribe();
    await f.close();
  }
});

test('restoration reports cleanup failure but activates the requested branch after drain', async () => {
  const f = await workerFixture();
  const failures: string[] = [];
  const unsubscribe = f.session.extensionRunner.onError((error) => failures.push(error.error));
  const dispose = AgentSession.prototype.dispose;
  let failing: { mockRestore: () => void } | undefined;
  try {
    await f.call('Task', { prompt: 'WAIT_BLOCKED' });
    failing = vi.spyOn(AgentSession.prototype, 'dispose').mockImplementation(function (this: AgentSession) {
      dispose.call(this);
      if (this !== f.session) throw new Error('restore cleanup failed');
    });
    await f.session.extensionRunner.emit({ type: 'session_start', reason: 'reload' });
    failing.mockRestore();
    failing = undefined;
    expect(failures.some((error) => error.includes('restore cleanup failed'))).toBe(true);
    const next = await f.call('Task', { prompt: 'new branch task', run_in_background: false });
    expect((next.details as { status: string }).status).toBe('settled');
  } finally {
    failing?.mockRestore();
    unsubscribe();
    await f.close();
  }
});

test('a background task awaited by TaskOutput is not delivered again as a completion message', async () => {
  const f = await workerFixture();
  try {
    const completions = () => f.session.messages.filter((message) => message.role === 'custom' && message.customType === 'task_notification').length;
    const awaited = await f.call('Task', { prompt: 'WAIT' }, undefined, true);
    const awaitedId = (awaited.details as { id: string }).id;
    expect(((await f.call('TaskOutput', { task_id: awaitedId, block: true })).details as { status: string }).status).toBe('settled');
    await f.session.waitForIdle();
    expect(completions()).toBe(0);
    const unattended = await f.call('Task', { prompt: 'WAIT' });
    await settled(f, (unattended.details as { id: string }).id);
    expect(completions()).toBe(1);
  } finally {
    await f.close();
  }
});

test('a task that settles during a busy parent turn wakes the parent only if its result is still unread', async () => {
  const f = await workerFixture();
  try {
    const completions = () => f.session.messages.filter((message) => message.role === 'custom' && message.customType === 'task_notification').length;
    const read = await f.call('Task', { prompt: 'WAIT' }, undefined, true);
    const readId = (read.details as { id: string }).id;
    await settled(f, readId);
    expect(completions()).toBe(0);
    await f.call('TaskOutput', { task_id: readId });
    await f.session.extensionRunner.emit({ type: 'agent_end', messages: [] });
    await f.session.waitForIdle();
    expect(completions()).toBe(0);
    const unread = await f.call('Task', { prompt: 'WAIT' }, undefined, true);
    await settled(f, (unread.details as { id: string }).id);
    await f.session.extensionRunner.emit({ type: 'agent_end', messages: [] });
    await f.session.waitForIdle();
    expect(completions()).toBe(1);
  } finally {
    await f.close();
  }
});
