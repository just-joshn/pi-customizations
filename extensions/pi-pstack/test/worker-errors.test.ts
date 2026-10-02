import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { AgentSession, DefaultResourceLoader, SessionManager } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { workerFixture } from './worker-fixture.ts';
import { releasePendingWork } from './worker-gates.ts';
import { workerTiming } from './worker-timing.ts';

test('native child depth blocks a nested Agent at the configured cap', async () => {
  vi.stubEnv('PI_MAX_SUBAGENT_SPAWN_DEPTH', '1');
  const fixture = await workerFixture();
  try {
    await fixture.call('Task', { prompt: 'SPAWN_AGENT', run_in_background: false });
    const results = JSON.parse(await readFile(join(fixture.dir, 'child-tool-results.json'), 'utf8')) as { toolName: string; isError: boolean; content: { text: string }[] }[];
    const nested = results.find((result) => result.toolName === 'Agent');
    expect(nested).toMatchObject({ isError: true });
    expect(nested?.content[0]?.text).toBe('Tool Agent not found');
  } finally {
    await fixture.close();
  }
});

test('[G5-02] a resumed child cannot stop its own agent and finishes normally', async () => {
  const fixture = await workerFixture();
  try {
    const initial = await fixture.call('Task', { prompt: 'first', run_in_background: false });
    const { id } = initial.details as { id: string };
    const resumed = await fixture.call('Task', { prompt: `SELF_STOP=${id}`, resume: id, run_in_background: false });
    expect(resumed.details).toMatchObject({ id, status: 'settled' });
    const results = JSON.parse(await readFile(join(fixture.dir, 'child-tool-results.json'), 'utf8')) as { toolName: string; isError: boolean; content: { text: string }[] }[];
    const stop = results.find((result) => result.toolName === 'TaskStop');
    expect(stop).toMatchObject({ isError: true });
    expect(stop?.content[0]?.text).toBe(`Agent ${id} cannot stop itself; use the task UI or a main-session TaskStop.`);
  } finally {
    await fixture.close();
  }
});

test('pre-aborted launch creates no child session or task record', async () => {
  const fixture = await workerFixture();
  const create = vi.spyOn(SessionManager, 'create');
  try {
    const controller = new AbortController();
    controller.abort('permission-stop');
    await expect(fixture.call('Task', { prompt: 'never runs' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(create.mock.calls).toEqual([]);
    const listed = await fixture.call('list_agents', { scope: 'all' });
    expect(listed.details).toEqual({ agents: [] });
  } finally {
    create.mockRestore();
    await fixture.close();
  }
});

test('a background Task may launch after an interrupt signal', async () => {
  const fixture = await workerFixture();
  try {
    const controller = new AbortController();
    controller.abort('interrupt');
    const started = await fixture.call('Task', { description: 'interrupt probe', prompt: 'after interrupt' }, controller.signal);
    const done = await fixture.call('TaskOutput', { task_id: (started.details as { id: string }).id, block: true });
    expect(done.details).toMatchObject({ status: 'settled', output: 'users=1' });
  } finally {
    await fixture.close();
  }
});

test('a background task may launch after an interrupt signal', async () => {
  const fixture = await workerFixture();
  try {
    const controller = new AbortController();
    controller.abort('interrupt');
    const started = await fixture.call('task', { agent_type: 'general-purpose', name: 'late', description: 'interrupt probe', prompt: 'after interrupt', mode: 'background' }, controller.signal);
    const read = await fixture.call('read_agent', { agent_id: (started.details as { agent_id: string }).agent_id, wait: true });
    expect(read.content[0]).toMatchObject({ text: expect.stringContaining('[Turn 0]\nusers=1') });
  } finally {
    await fixture.close();
  }
});

test('a pre-aborted sync task starts no agent', async () => {
  const fixture = await workerFixture();
  try {
    const controller = new AbortController();
    controller.abort('permission-stop');
    await expect(fixture.call('task', { agent_type: 'general-purpose', name: 'never', description: 'never runs', prompt: 'never runs' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect((await fixture.call('list_agents', { scope: 'all' })).details).toEqual({ agents: [] });
  } finally {
    await fixture.close();
  }
});

test('stopping a completed task does not abort the disposed session again', async () => {
  const f = await workerFixture();
  try {
    const completed = await f.call('Task', { prompt: 'done', run_in_background: false });
    const record = completed.details as { id: string };
    const abort = vi.spyOn(AgentSession.prototype, 'abort').mockImplementation(async () => {});
    const stopped = await f.call('TaskStop', { task_id: record.id });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(abort.mock.calls.length).toBe(0);
    expect(stopped.usage).toBeUndefined();
    expect(stopped.details).toMatchObject(completed.details as Record<string, unknown>);
    expect(stopped.details).toMatchObject({ message: `Task ${record.id} already finished with status settled`, task_id: record.id, task_type: 'local_agent' });
  } finally {
    await f.close();
  }
});

test('abort rejection is observed and the child is disposed before stop returns', async () => {
  const f = await workerFixture();
  try {
    const started = await f.call('Task', { prompt: 'WAIT' });
    const record = started.details as { id: string };
    const abort = vi.spyOn(AgentSession.prototype, 'abort').mockRejectedValue(new Error('abort failure'));
    const dispose = AgentSession.prototype.dispose;
    let childDisposals = 0;
    const disposeSpy = vi.spyOn(AgentSession.prototype, 'dispose').mockImplementation(function (this: AgentSession) {
      if (this !== f.session) childDisposals += 1;
      dispose.call(this);
    });
    const beforeStop = childDisposals;
    const stopped = await f.call('TaskStop', { task_id: record.id });
    abort.mockRestore();
    disposeSpy.mockRestore();
    expect(childDisposals).toBeGreaterThan(beforeStop);
    expect(JSON.stringify(stopped.content)).toMatch(/abort failure/);
    expect(JSON.stringify(stopped.content)).toMatch(/interrupted|failed/);
    expect((await f.call('TaskOutput', { task_id: record.id })).usage).toBeUndefined();
  } finally {
    await f.close();
  }
});

test('rejected aborts still drain grandchildren without delayed writes', async () => {
  const f = await workerFixture();
  try {
    const started = await f.call('Task', { prompt: 'NEST_STOP' });
    const record = started.details as { id: string };
    await vi.waitFor(
      async () => {
        expect(await readFile(join(f.dir, 'audit.txt'), 'utf8')).toMatch(/grandchild-start/);
      },
      { timeout: workerTiming.settlementDeadlineMs, interval: workerTiming.pollIntervalMs },
    );
    const abort = vi.spyOn(AgentSession.prototype, 'abort').mockRejectedValue(new Error('nested abort failure'));
    const stopped = await f.call('TaskStop', { task_id: record.id });
    abort.mockRestore();
    expect(JSON.stringify(stopped.content)).toMatch(/nested abort failure/);
    const afterStop = await readFile(join(f.dir, 'audit.txt'), 'utf8');
    expect(afterStop).toMatch(/grandchild-aborted/);
    expect(afterStop).not.toMatch(/grandchild-finished/);
    expect(releasePendingWork()).toEqual([]);
    expect(await readFile(join(f.dir, 'audit.txt'), 'utf8')).toBe(afterStop);
  } finally {
    await f.close();
  }
});

test('foreground usage is reported once when parent shutdown changes the generation', async () => {
  const f = await workerFixture();
  try {
    const pending = expect(f.call('Task', { prompt: 'WAIT_BLOCKED', run_in_background: false })).rejects.toThrow(/interrupted/);
    await vi.waitFor(
      async () => {
        await readFile(join(f.dir, 'child-input.txt'));
      },
      { timeout: workerTiming.settlementDeadlineMs, interval: workerTiming.pollIntervalMs },
    );
    await f.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    await pending;
    const event = { type: 'tool_result' as const, toolName: 'Task', toolCallId: 'test-Task', input: {}, content: [], details: undefined, isError: true };
    expect((await f.session.extensionRunner.emitToolResult(event))?.usage?.totalTokens).toBe(5);
    expect((await f.session.extensionRunner.emitToolResult(event))?.usage).toBeUndefined();
  } finally {
    await f.close();
  }
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
    const record = started.details as { id: string; outputFile: string; sessionFile: string };
    await mkdir(record.outputFile);
    const result = await f.call('TaskOutput', { task_id: record.id, block: true });
    const summary = JSON.parse(result.content.find((block) => block.type === 'text')?.text ?? '{}');
    expect(summary.status).toBe('failed');
    expect(summary.output).toMatch(/Could not save full output/);
    expect(summary.transcript).toBe(record.sessionFile);
    expect(result.usage?.totalTokens).toBe(5);
    expect((await f.call('TaskOutput', { task_id: record.id })).usage).toBeUndefined();
  } finally {
    await f.close();
  }
});

test('child extension shutdown failures remain visible to the caller', async () => {
  const f = await workerFixture();
  try {
    await writeFile(join(f.dir, 'extensions/failing-shutdown.ts'), `export default pi => { pi.on('session_shutdown', () => { throw new Error('extension cleanup failure'); }); };`);
    await expect(f.call('Task', { prompt: 'finish', run_in_background: false })).rejects.toThrow(/extension cleanup failure/);
    const usage = await f.session.extensionRunner.emitToolResult({ type: 'tool_result', toolName: 'Task', toolCallId: 'test-Task', input: {}, content: [], details: undefined, isError: true });
    expect(usage?.usage?.totalTokens).toBe(5);
  } finally {
    await f.close();
  }
});

test('parent shutdown reports failures after draining every child', async () => {
  const f = await workerFixture();
  const failures: string[] = [];
  const unsubscribe = f.session.extensionRunner.onError((error) => failures.push(error.error));
  try {
    const audit = join(f.dir, 'shutdown-audit');
    await writeFile(
      join(f.dir, 'extensions/failing-shutdown.ts'),
      `import { appendFileSync } from 'node:fs'; export default pi => { pi.on('session_shutdown', () => { appendFileSync(${JSON.stringify(audit)}, 'closed\\n'); throw new Error('drain failure'); }); };`,
    );
    await f.call('Task', { prompt: 'WAIT' });
    await f.call('Task', { prompt: 'WAIT' });
    await f.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    expect(await readFile(audit, 'utf8')).toBe('closed\nclosed\n');
    expect(failures.some((error) => error.includes('drain failure'))).toBe(true);
  } finally {
    unsubscribe();
    await f.close();
  }
});

test('missing durable paths and SDK construction failures never publish a task', async () => {
  const f = await workerFixture();
  try {
    const path = vi.spyOn(SessionManager.prototype, 'getSessionFile').mockReturnValue(undefined);
    await expect(f.call('Task', { prompt: 'test', readonly: true })).rejects.toThrow(/durable transcript path/);
    path.mockRestore();
    const construction = vi.spyOn(SessionManager.prototype, 'buildSessionContext').mockImplementation(() => {
      throw new Error('SDK construction failure');
    });
    await expect(f.call('Task', { prompt: 'test', readonly: true })).rejects.toThrow(/SDK construction failure/);
    construction.mockRestore();
    expect(f.session.sessionManager.getBranch().filter((entry) => entry.type === 'custom' && entry.customType === 'pstack-task').length).toBe(0);
  } finally {
    await f.close();
  }
});

test('loader diagnostics fail task startup before publishing a record', async () => {
  const f = await workerFixture();
  try {
    await writeFile(join(f.dir, 'extensions/broken.ts'), 'throw new Error("broken extension");');
    await expect(f.call('Task', { prompt: 'test' })).rejects.toThrow(/Worker extension loading failed.*broken extension/);
    expect(f.session.sessionManager.getBranch().filter((entry) => entry.type === 'custom' && entry.customType === 'pstack-task').length).toBe(0);
  } finally {
    await f.close();
  }
});

test('invalid workspace and resource loading errors do not publish a running task', async () => {
  const f = await workerFixture();
  try {
    await expect(f.call('Task', { prompt: 'test', cwd: '/missing-pstack-workspace' })).rejects.toThrow(/ENOENT/);
    const reload = vi.spyOn(DefaultResourceLoader.prototype, 'reload').mockRejectedValue(new Error('loader failure'));
    await expect(f.call('Task', { prompt: 'test' })).rejects.toThrow(/loader failure/);
    reload.mockRestore();
    expect(f.session.sessionManager.getBranch().filter((entry) => entry.type === 'custom' && entry.customType === 'pstack-task').length).toBe(0);
  } finally {
    await f.close();
  }
});
