import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { AgentSession, DefaultResourceLoader, SessionManager } from '@earendil-works/pi-coding-agent';
import { workerFixture } from './worker-fixture.ts';
import { workerTiming } from './worker-timing.ts';

test('stopping a completed task does not abort the disposed session again', async () => {
  const f = await workerFixture();
  try {
    const completed = await f.call('Task', { prompt: 'done', run_in_background: false });
    const record = completed.details as { id: string };
    const abort = vi.spyOn(AgentSession.prototype, 'abort').mockImplementation(async () => {});
    const stopped = await f.call('TaskStop', { task_id: record.id });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(abort.mock.calls.length).toBe(0);
    expect(stopped.usage).toBeUndefined();
    expect(stopped.details).toEqual(completed.details);
  } finally { await f.close(); }
});

test('abort rejection is observed and the child is disposed before stop returns', async () => {
  const f = await workerFixture();
  try {
    const started = await f.call('Task', { prompt: 'WAIT' });
    const record = started.details as { id: string };
    const abort = vi.spyOn(AgentSession.prototype, 'abort').mockRejectedValue(new Error('abort failure'));
    const stopped = await f.call('TaskStop', { task_id: record.id });
    abort.mockRestore();
    expect(JSON.stringify(stopped.content)).toMatch(/abort failure/);
    expect(JSON.stringify(stopped.content)).toMatch(/interrupted|failed/);
    expect((await f.call('TaskOutput', { task_id: record.id })).usage).toBeUndefined();
  } finally { await f.close(); }
});

test('rejected aborts still drain grandchildren without delayed writes', async () => {
  const f = await workerFixture();
  try {
    const started = await f.call('Task', { prompt: 'NEST_STOP' });
    const record = started.details as { id: string };
    const deadline = Date.now() + workerTiming.settlementDeadlineMs;
    let audit = '';
    while (!audit.includes('grandchild-start')) {
      expect(Date.now() < deadline).toBe(true);
      try { audit = await readFile(join(f.dir, 'audit.txt'), 'utf8'); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
      await new Promise(resolve => setTimeout(resolve, workerTiming.pollIntervalMs));
    }
    const abort = vi.spyOn(AgentSession.prototype, 'abort').mockRejectedValue(new Error('nested abort failure'));
    const stopped = await f.call('TaskStop', { task_id: record.id });
    abort.mockRestore();
    expect(JSON.stringify(stopped.content)).toMatch(/nested abort failure/);
    const afterStop = await readFile(join(f.dir, 'audit.txt'), 'utf8');
    expect(afterStop).toMatch(/grandchild-aborted/);
    expect(afterStop).not.toMatch(/grandchild-finished/);
    await new Promise(resolve => setTimeout(resolve, workerTiming.descendantRunMs + workerTiming.drainMarginMs));
    expect(await readFile(join(f.dir, 'audit.txt'), 'utf8')).toBe(afterStop);
  } finally { await f.close(); }
});

test('foreground usage is reported once when parent shutdown changes the generation', async () => {
  const f = await workerFixture();
  try {
    const pending = expect(f.call('Task', { prompt: 'WAIT_BLOCKED', run_in_background: false })).rejects.toThrow(/interrupted/);
    const deadline = Date.now() + workerTiming.settlementDeadlineMs;
    while (true) {
      try { await readFile(join(f.dir, 'child-input.txt')); break; }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
      expect(Date.now() < deadline).toBe(true);
      await new Promise(resolve => setTimeout(resolve, workerTiming.pollIntervalMs));
    }
    await f.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    await pending;
    const event = { type: 'tool_result' as const, toolName: 'Task', toolCallId: 'test-Task', input: {}, content: [], details: undefined, isError: true };
    expect((await f.session.extensionRunner.emitToolResult(event))?.usage?.totalTokens).toBe(5);
    expect((await f.session.extensionRunner.emitToolResult(event))?.usage).toBeUndefined();
  } finally { await f.close(); }
});

test('startup retains the original failure when closing also fails', async () => {
  const f = await workerFixture();
  const dispose = AgentSession.prototype.dispose;
  const bindSpy = vi.spyOn(AgentSession.prototype, 'bindExtensions').mockRejectedValue(new Error('bind failure'));
  const disposeSpy = vi.spyOn(AgentSession.prototype, 'dispose').mockImplementation(function (this: AgentSession) {
    dispose.call(this);
    throw new Error('dispose failure');
  });
  try {
    await expect(f.call('Task', { prompt: 'never started', readonly: true })).rejects.toThrow(/bind failure/);
  } finally {
    bindSpy.mockRestore();
    disposeSpy.mockRestore();
    await f.close();
  }
});

test('output write failure remains a failed result with usage and a transcript', async () => {
  const f = await workerFixture();
  try {
    const started = await f.call('Task', { prompt: 'WAIT' });
    const record = started.details as { id: string; outputFile: string; status: string };
    await mkdir(record.outputFile);
    const result = await f.call('TaskOutput', { task_id: record.id, block: true });
    expect(JSON.stringify(result.content)).toMatch(/Could not save full output/);
    expect(JSON.stringify(result.content)).toMatch(/failed/);
    expect(result.usage?.totalTokens).toBe(5);
    expect((await f.call('TaskOutput', { task_id: record.id })).usage).toBeUndefined();
    expect(started.details).toEqual(record);
    expect(record.status).toBe('running');
  } finally { await f.close(); }
});

test('child extension shutdown failures remain visible to the caller', async () => {
  const f = await workerFixture();
  try {
    await writeFile(join(f.dir, 'extensions/failing-shutdown.ts'), `export default pi => { pi.on('session_shutdown', () => { throw new Error('extension cleanup failure'); }); };`);
    await expect(f.call('Task', { prompt: 'finish', run_in_background: false })).rejects.toThrow(/extension cleanup failure/);
    const usage = await f.session.extensionRunner.emitToolResult({ type: 'tool_result', toolName: 'Task', toolCallId: 'test-Task', input: {}, content: [], details: undefined, isError: true });
    expect(usage?.usage?.totalTokens).toBe(5);
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
    expect(await readFile(audit, 'utf8')).toBe('closed\nclosed\n');
    expect(failures.some(error => error.includes('drain failure'))).toBe(true);
  } finally { unsubscribe(); await f.close(); }
});

test('missing durable paths and SDK construction failures never publish a task', async () => {
  const f = await workerFixture();
  try {
    const path = vi.spyOn(SessionManager.prototype, 'getSessionFile').mockReturnValue(undefined);
    await expect(f.call('Task', { prompt: 'test', readonly: true })).rejects.toThrow(/durable transcript path/);
    path.mockRestore();
    const construction = vi.spyOn(SessionManager.prototype, 'buildSessionContext').mockImplementation(() => { throw new Error('SDK construction failure'); });
    await expect(f.call('Task', { prompt: 'test', readonly: true })).rejects.toThrow(/SDK construction failure/);
    construction.mockRestore();
    expect(f.session.sessionManager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === 'pstack-task').length).toBe(0);
  } finally { await f.close(); }
});

test('loader diagnostics fail task startup before publishing a record', async () => {
  const f = await workerFixture();
  try {
    await writeFile(join(f.dir, 'extensions/broken.ts'), 'throw new Error("broken extension");');
    await expect(f.call('Task', { prompt: 'test' })).rejects.toThrow(/Worker extension loading failed.*broken extension/);
    expect(f.session.sessionManager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === 'pstack-task').length).toBe(0);
  } finally { await f.close(); }
});

test('invalid workspace and resource loading errors do not publish a running task', async () => {
  const f = await workerFixture();
  try {
    await expect(f.call('Task', { prompt: 'test', cwd: '/missing-pstack-workspace' })).rejects.toThrow(/ENOENT/);
    const reload = vi.spyOn(DefaultResourceLoader.prototype, 'reload').mockRejectedValue(new Error('loader failure'));
    await expect(f.call('Task', { prompt: 'test' })).rejects.toThrow(/loader failure/);
    reload.mockRestore();
    expect(f.session.sessionManager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === 'pstack-task').length).toBe(0);
  } finally { await f.close(); }
});
