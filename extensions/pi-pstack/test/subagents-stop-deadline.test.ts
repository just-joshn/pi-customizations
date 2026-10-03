import { AgentSession } from '@earendil-works/pi-coding-agent';
import { afterEach, expect, test, vi } from 'vitest';
import { settleWithin, stillStoppingMessage, stopPendingDetails } from '../src/subagents/stop-deadline.ts';
import type { TaskRecord } from '../src/worker-records.ts';
import { workerFixture } from './worker-fixture.ts';
import { releasePendingWork } from './worker-gates.ts';

type Launched = { id: string };

function wedgeAbort() {
  return [vi.spyOn(AgentSession.prototype, 'abort').mockResolvedValue(undefined), vi.spyOn(AgentSession.prototype, 'dispose').mockImplementation(() => {})];
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('settleWithin reports a value or a missed deadline', async () => {
  vi.useFakeTimers();
  expect(await settleWithin(Promise.resolve(4), 10)).toEqual({ settled: true, value: 4 });
  const late = settleWithin(new Promise(() => {}), 10);
  await vi.advanceTimersByTimeAsync(10);
  expect(await late).toEqual({ settled: false });
});

test('stillStoppingMessage names the task, the retained record, and the recovery order', () => {
  const message = stillStoppingMessage('agent-7');
  expect(message).toContain('Task agent-7 is still stopping');
  expect(message).toContain('The record is retained as its stop handle');
  expect(message).toContain('TaskStop re-fires, session restart is the final recovery');
});

test('stopPendingDetails maps a retained record to a stop-pending handle addressed by its description', () => {
  const record: TaskRecord = { id: 'agent-7', persona: 'worker', description: 'fix the flaky login test', cwd: '/tmp/repo', readonly: false, sessionFile: 'agent-7.jsonl', outputFile: 'agent-7.out', status: 'interrupted', output: '' };
  expect(stopPendingDetails(record)).toEqual({ status: 'stop_pending', task_id: 'agent-7', task_type: 'local_agent', command: 'fix the flaky login test', message: stillStoppingMessage('agent-7') });
});

test('stopPendingDetails falls back to the persona when the record has no description', () => {
  const record: TaskRecord = { id: 'agent-8', persona: 'reviewer', cwd: '/tmp/repo', readonly: false, sessionFile: 'agent-8.jsonl', outputFile: 'agent-8.out', status: 'interrupted', output: '' };
  expect(stopPendingDetails(record).command).toBe('reviewer');
});

test('a wedged stop is unblocked at 10s by SIGKILLing the child bash process group', async () => {
  const fixture = await workerFixture();
  try {
    const spawned = new Promise<unknown>((resolve) => fixture.eventBus.on('pstack:process-group', resolve));
    const { id: agentId } = (await fixture.call('Task', { prompt: 'BASH_SLEEP' })).details as Launched;
    expect(await spawned).toEqual({ pid: expect.any(Number), agentId });
    const spies = wedgeAbort();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stopping = fixture.call('TaskStop', { task_id: agentId });
    await vi.advanceTimersByTimeAsync(10000);
    vi.useRealTimers();
    for (const spy of spies) spy.mockRestore();
    expect((await stopping).details).toMatchObject({ task_id: agentId, status: 'interrupted', message: `Stopped task ${agentId}` });
    expect(fixture.subagentLogs).toContain(`killEscalation: task ${agentId} still unsettled 10000ms after kill; killed process groups of 1 agent(s)`);
  } finally {
    await fixture.close();
  }
});

test('a stop still unsettled at 30s returns a stop-pending handle that TaskStop can re-fire', async () => {
  const fixture = await workerFixture();
  try {
    const { id: agentId } = (await fixture.call('Task', { prompt: 'WAIT GRANDCHILD' })).details as Launched;
    const spies = wedgeAbort();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stopping = fixture.call('TaskStop', { task_id: agentId });
    await vi.advanceTimersByTimeAsync(30000);
    const pending = await stopping;
    vi.useRealTimers();
    for (const spy of spies) spy.mockRestore();
    expect(pending.isError).toBe(false);
    expect(pending.details).toEqual({
      status: 'stop_pending',
      task_id: agentId,
      task_type: 'local_agent',
      command: 'generalPurpose',
      message: `Task ${agentId} is still stopping: its loop never settled after kill. The record is retained as its stop handle; TaskStop re-fires, session restart is the final recovery.`,
    });
    expect((await fixture.call('TaskStop', { task_id: agentId })).details).toMatchObject({ status: 'interrupted' });
  } finally {
    await fixture.close();
  }
});

test('session shutdown gives up on a wedged worker after 30s instead of blocking forever', async () => {
  const fixture = await workerFixture();
  const errors: string[] = [];
  const off = fixture.session.extensionRunner.onError((error) => errors.push(String(error.error)));
  try {
    const { id: agentId } = (await fixture.call('Task', { prompt: 'WAIT GRANDCHILD' })).details as Launched;
    const spies = wedgeAbort();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const shutdown = fixture.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    await vi.advanceTimersByTimeAsync(30000);
    await shutdown;
    vi.useRealTimers();
    for (const spy of spies) spy.mockRestore();
    expect(errors.join('\n')).toContain(`Task ${agentId} is still stopping: its loop never settled after kill.`);
  } finally {
    off();
    releasePendingWork();
    await fixture.close();
  }
});
