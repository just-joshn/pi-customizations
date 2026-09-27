import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { AgentSession, DefaultResourceLoader, SessionManager } from '@earendil-works/pi-coding-agent';
import { workerFixture } from './worker-fixture.ts';
import { workerTiming } from './worker-timing.ts';

test('stopping a completed task does not abort the disposed session again', async t => {
  const f = await workerFixture();
  try {
    const completed = await f.call('Task', { prompt: 'done', run_in_background: false });
    const record = completed.details as { id: string };
    const abort = t.mock.method(AgentSession.prototype, 'abort', async () => {});
    const stopped = await f.call('TaskStop', { task_id: record.id });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(abort.mock.callCount(), 0);
    assert.equal(stopped.usage, undefined);
    assert.deepEqual(stopped.details, completed.details);
  } finally { t.mock.restoreAll(); await f.close(); }
});

test('abort rejection is observed and the child is disposed before stop returns', async t => {
  const f = await workerFixture();
  try {
    const started = await f.call('Task', { prompt: 'WAIT' });
    const record = started.details as { id: string };
    const abort = t.mock.method(AgentSession.prototype, 'abort', async () => { throw new Error('abort failure'); });
    const stopped = await f.call('TaskStop', { task_id: record.id });
    abort.mock.restore();
    assert.match(JSON.stringify(stopped.content), /abort failure/);
    assert.match(JSON.stringify(stopped.content), /interrupted|failed/);
    assert.equal((await f.call('TaskOutput', { task_id: record.id })).usage, undefined);
  } finally { t.mock.restoreAll(); await f.close(); }
});

test('rejected aborts still drain grandchildren without delayed writes', async t => {
  const f = await workerFixture();
  try {
    const started = await f.call('Task', { prompt: 'NEST_STOP' });
    const record = started.details as { id: string };
    const deadline = Date.now() + workerTiming.settlementDeadlineMs;
    let audit = '';
    while (!audit.includes('grandchild-start')) {
      assert.ok(Date.now() < deadline, 'grandchild must start before cancellation');
      try { audit = await readFile(join(f.dir, 'audit.txt'), 'utf8'); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
      await new Promise(resolve => setTimeout(resolve, workerTiming.pollIntervalMs));
    }
    const abort = t.mock.method(AgentSession.prototype, 'abort', async () => { throw new Error('nested abort failure'); });
    const stopped = await f.call('TaskStop', { task_id: record.id });
    abort.mock.restore();
    assert.match(JSON.stringify(stopped.content), /nested abort failure/);
    const afterStop = await readFile(join(f.dir, 'audit.txt'), 'utf8');
    assert.match(afterStop, /grandchild-aborted/);
    assert.doesNotMatch(afterStop, /grandchild-finished/);
    await new Promise(resolve => setTimeout(resolve, workerTiming.descendantRunMs + workerTiming.drainMarginMs));
    assert.equal(await readFile(join(f.dir, 'audit.txt'), 'utf8'), afterStop);
  } finally { t.mock.restoreAll(); await f.close(); }
});

test('foreground usage is reported once when parent shutdown changes the generation', async () => {
  const f = await workerFixture();
  try {
    const pending = assert.rejects(f.call('Task', { prompt: 'WAIT_BLOCKED', run_in_background: false }), /interrupted/);
    const deadline = Date.now() + workerTiming.settlementDeadlineMs;
    while (true) {
      try { await readFile(join(f.dir, 'child-input.txt')); break; }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
      assert.ok(Date.now() < deadline, 'foreground child must start');
      await new Promise(resolve => setTimeout(resolve, workerTiming.pollIntervalMs));
    }
    await f.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    await pending;
    const event = { type: 'tool_result' as const, toolName: 'Task', toolCallId: 'test-Task', input: {}, content: [], details: undefined, isError: true };
    assert.equal((await f.session.extensionRunner.emitToolResult(event))?.usage?.totalTokens, 5);
    assert.equal((await f.session.extensionRunner.emitToolResult(event))?.usage, undefined);
  } finally { await f.close(); }
});

test('startup retains the original failure when closing also fails', async t => {
  const f = await workerFixture();
  const dispose = AgentSession.prototype.dispose;
  try {
    t.mock.method(AgentSession.prototype, 'bindExtensions', async () => { throw new Error('bind failure'); });
    t.mock.method(AgentSession.prototype, 'dispose', function (this: AgentSession) {
      dispose.call(this);
      throw new Error('dispose failure');
    });
    await assert.rejects(f.call('Task', { prompt: 'never started', readonly: true }), error => {
      assert.match(String(error), /bind failure/);
      assert.match(String(error), /dispose failure/);
      return true;
    });
  } finally { t.mock.restoreAll(); await f.close(); }
});

test('output write failure remains a failed result with usage and a transcript', async () => {
  const f = await workerFixture();
  try {
    const started = await f.call('Task', { prompt: 'WAIT' });
    const record = started.details as { id: string; outputFile: string; status: string };
    await mkdir(record.outputFile);
    const result = await f.call('TaskOutput', { task_id: record.id, block: true });
    assert.match(JSON.stringify(result.content), /Could not save full output/);
    assert.match(JSON.stringify(result.content), /failed/);
    assert.equal(result.usage?.totalTokens, 5);
    assert.equal((await f.call('TaskOutput', { task_id: record.id })).usage, undefined);
    assert.deepEqual(started.details, record);
    assert.equal(record.status, 'running');
  } finally { await f.close(); }
});

test('child extension shutdown failures remain visible to the caller', async () => {
  const f = await workerFixture();
  try {
    await writeFile(join(f.dir, 'extensions/failing-shutdown.ts'), `export default pi => { pi.on('session_shutdown', () => { throw new Error('extension cleanup failure'); }); };`);
    await assert.rejects(f.call('Task', { prompt: 'finish', run_in_background: false }), /extension cleanup failure/);
    const usage = await f.session.extensionRunner.emitToolResult({ type: 'tool_result', toolName: 'Task', toolCallId: 'test-Task', input: {}, content: [], details: undefined, isError: true });
    assert.equal(usage?.usage?.totalTokens, 5);
  } finally { await f.close(); }
});

test('parent shutdown reports failures after draining every child', async () => {
  const f = await workerFixture();
  const failures: string[] = [];
  const unsubscribe = f.session.extensionRunner.onError(error => failures.push(error.error));
  try {
    const audit = join(f.dir, 'shutdown-audit');
    await writeFile(join(f.dir, 'extensions/failing-shutdown.ts'), `import { appendFileSync } from 'node:fs'; export default pi => { pi.on('session_shutdown', () => { appendFileSync(${JSON.stringify(audit)}, 'closed\\n'); throw new Error('drain failure'); }); };`);
    await f.call('Task', { prompt: 'WAIT' });
    await f.call('Task', { prompt: 'WAIT' });
    await f.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    assert.equal(await readFile(audit, 'utf8'), 'closed\nclosed\n');
    assert.ok(failures.some(error => error.includes('drain failure')));
  } finally { unsubscribe(); await f.close(); }
});

test('missing durable paths and SDK construction failures never publish a task', async t => {
  const f = await workerFixture();
  try {
    const path = t.mock.method(SessionManager.prototype, 'getSessionFile', () => undefined);
    await assert.rejects(f.call('Task', { prompt: 'test', readonly: true }), /durable transcript path/);
    path.mock.restore();
    const construction = t.mock.method(SessionManager.prototype, 'buildSessionContext', () => { throw new Error('SDK construction failure'); });
    await assert.rejects(f.call('Task', { prompt: 'test', readonly: true }), /SDK construction failure/);
    construction.mock.restore();
    assert.equal(f.session.sessionManager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === 'pstack-task').length, 0);
  } finally { t.mock.restoreAll(); await f.close(); }
});

test('loader diagnostics fail task startup before publishing a record', async () => {
  const f = await workerFixture();
  try {
    await writeFile(join(f.dir, 'extensions/broken.ts'), 'throw new Error("broken extension");');
    await assert.rejects(f.call('Task', { prompt: 'test' }), /Worker extension loading failed.*broken extension/);
    assert.equal(f.session.sessionManager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === 'pstack-task').length, 0);
  } finally { await f.close(); }
});

test('invalid workspace and resource loading errors do not publish a running task', async t => {
  const f = await workerFixture();
  try {
    await assert.rejects(f.call('Task', { prompt: 'test', cwd: '/missing-pstack-workspace' }), /ENOENT/);
    t.mock.method(DefaultResourceLoader.prototype, 'reload', async () => { throw new Error('loader failure'); });
    await assert.rejects(f.call('Task', { prompt: 'test' }), /loader failure/);
    assert.equal(f.session.sessionManager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === 'pstack-task').length, 0);
  } finally { t.mock.restoreAll(); await f.close(); }
});
