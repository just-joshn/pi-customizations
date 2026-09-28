import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { AgentSession, DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import { restoreTaskRecords } from '../src/worker-records.ts';
import { workerFixture } from './worker-fixture.ts';
import { workerTiming } from './worker-timing.ts';

function pauseReload(t: TestContext) {
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const reload = DefaultResourceLoader.prototype.reload;
  t.mock.method(DefaultResourceLoader.prototype, 'reload', async function (this: DefaultResourceLoader) {
    await reload.call(this);
    entered();
    await gate;
  });
  return { release, ready };
}

async function settled(f: Awaited<ReturnType<typeof workerFixture>>, id: string) {
  const deadline = Date.now() + workerTiming.settlementDeadlineMs;
  while (restoreTaskRecords(f.session.sessionManager.getBranch()).get(id)?.status !== 'settled') {
    assert.ok(Date.now() < deadline);
    await new Promise(resolve => setTimeout(resolve, workerTiming.pollIntervalMs));
  }
  await f.session.waitForIdle();
}

test('resume refreshes pending usage after TaskOutput claims it during startup', async t => {
  const f = await workerFixture();
  let release = () => {};
  try {
    const initial = await f.call('Task', { prompt: 'WAIT' });
    const { id } = initial.details as { id: string };
    await settled(f, id);
    const gate = pauseReload(t);
    release = gate.release;
    const resumed = f.call('Task', { prompt: 'second', resume: id, run_in_background: false });
    await gate.ready;
    assert.equal((await f.call('TaskOutput', { task_id: id })).usage?.totalTokens, 5);
    gate.release();
    assert.equal((await resumed).usage?.totalTokens, 5);
    assert.equal((await f.call('TaskOutput', { task_id: id })).usage, undefined);
  } finally { release(); t.mock.restoreAll(); await f.close(); }
});

test('overlapping shutdowns observe cleanup failures in cancelled startup', async t => {
  const f = await workerFixture();
  const failures: string[] = [];
  const unsubscribe = f.session.extensionRunner.onError(error => failures.push(error.error));
  const gate = pauseReload(t);
  const dispose = AgentSession.prototype.dispose;
  try {
    t.mock.method(AgentSession.prototype, 'dispose', function (this: AgentSession) {
      dispose.call(this);
      if (this !== f.session) throw new Error('startup cleanup failed');
    });
    const starting = assert.rejects(f.call('Task', { prompt: 'cancelled' }), /startup cleanup failed/);
    await gate.ready;
    const first = f.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    const second = f.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    await new Promise<void>(resolve => setImmediate(resolve));
    gate.release();
    await Promise.all([starting, first, second]);
    assert.equal(failures.filter(error => error.includes('startup cleanup failed')).length, 2);
  } finally { gate.release(); unsubscribe(); t.mock.restoreAll(); await f.close(); }
});

test('restoration reports cleanup failure but activates the requested branch after drain', async t => {
  const f = await workerFixture();
  const failures: string[] = [];
  const unsubscribe = f.session.extensionRunner.onError(error => failures.push(error.error));
  const dispose = AgentSession.prototype.dispose;
  try {
    await f.call('Task', { prompt: 'WAIT_BLOCKED' });
    const failing = t.mock.method(AgentSession.prototype, 'dispose', function (this: AgentSession) {
      dispose.call(this);
      if (this !== f.session) throw new Error('restore cleanup failed');
    });
    await f.session.extensionRunner.emit({ type: 'session_start', reason: 'reload' });
    failing.mock.restore();
    assert.ok(failures.some(error => error.includes('restore cleanup failed')));
    const next = await f.call('Task', { prompt: 'new branch task', run_in_background: false });
    assert.equal((next.details as { status: string }).status, 'settled');
  } finally { unsubscribe(); t.mock.restoreAll(); await f.close(); }
});

test('a background task awaited by TaskOutput is not delivered again as a completion message', async () => {
  const f = await workerFixture();
  try {
    const completions = () => f.session.messages.filter(message => message.role === 'custom' && message.customType === 'pstack-task-completion').length;
    const awaited = await f.call('Task', { prompt: 'WAIT' });
    const awaitedId = (awaited.details as { id: string }).id;
    assert.equal(((await f.call('TaskOutput', { task_id: awaitedId, block: true })).details as { status: string }).status, 'settled');
    await f.session.waitForIdle();
    assert.equal(completions(), 0);
    const unattended = await f.call('Task', { prompt: 'WAIT' });
    await settled(f, (unattended.details as { id: string }).id);
    assert.equal(completions(), 1);
  } finally { await f.close(); }
});
