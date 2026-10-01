import { createEventBus } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { reconcileOrphans } from '../src/subagents/orphan-recovery.ts';
import { SdkEvents, sdkEventChannel } from '../src/subagents/sdk-events.ts';
import type { TaskRecord } from '../src/worker-records.ts';
import { workerFixture } from './worker-fixture.ts';
import { workerTiming } from './worker-timing.ts';

type Fixture = Awaited<ReturnType<typeof workerFixture>>;
type Notice = { content: string; details: Record<string, unknown> };

function notices(fixture: Fixture, agentId: string): Notice[] {
  return fixture.session.messages.flatMap((message) =>
    message.role === 'custom' && message.customType === 'task_notification' && (message.details as { task_id?: string }).task_id === agentId ? [{ content: String(message.content), details: message.details as Record<string, unknown> }] : [],
  );
}

async function runningChild(fixture: Fixture) {
  const started = await fixture.call('Agent', { description: 'long job', prompt: 'WAIT_BLOCKED' });
  const { agentId, outputFile } = started.details as { agentId: string; outputFile: string };
  const status = async () => (await fixture.call('TaskOutput', { task_id: agentId })).details as { status: string; sessionFile: string; output: string };
  const { sessionFile } = await status();
  expect(outputFile).toBeDefined();
  return { agentId, sessionFile, status };
}

async function restart(fixture: Fixture): Promise<void> {
  await fixture.session.extensionRunner.emit({ type: 'session_start', reason: 'resume' });
}

function frames(fixture: Fixture): Record<string, unknown>[] {
  const seen: Record<string, unknown>[] = [];
  fixture.eventBus.on(sdkEventChannel, (frame) => seen.push(frame as Record<string, unknown>));
  return seen;
}

test('[B102][C111] a recent disk-resumable orphan is restarted in the background and its completion still arrives', async () => {
  const fixture = await workerFixture();
  try {
    const seen = frames(fixture);
    const { agentId } = await runningChild(fixture);
    await restart(fixture);
    await vi.waitFor(() => expect(notices(fixture, agentId).map((notice) => notice.details.summary)).toEqual(['Background agent "long job" was restarted after the previous session ended']), { timeout: workerTiming.settlementDeadlineMs });
    await vi.waitFor(() => expect(notices(fixture, agentId)).toHaveLength(2), { timeout: workerTiming.settlementDeadlineMs });
    expect(notices(fixture, agentId)[1]?.details).toMatchObject({ status: 'completed', summary: 'Agent "long job" finished' });
    const starts = seen.filter((frame) => frame.subtype === 'task_started' && frame.task_id === agentId);
    expect(starts.map((frame) => frame.is_backgrounded)).toEqual([true, true]);
  } finally {
    await fixture.close();
  }
});

test('[B101][C110] an orphan older than 48 hours is stopped with a worker_restart notification and is not announced twice', async () => {
  const fixture = await workerFixture();
  try {
    const seen = frames(fixture);
    const { agentId, sessionFile, status } = await runningChild(fixture);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3 * 24 * 3_600_000);
    await restart(fixture);
    const [notice] = notices(fixture, agentId);
    expect(notice?.details).toEqual({ task_id: agentId, status: 'stopped', summary: `Background agent "long job" didn't finish before the previous session ended`, task_type: 'local_agent', reason: 'worker_restart' });
    expect(notice?.content).toContain('either way its transcript is saved, so its progress is not lost.');
    expect(seen.find((frame) => frame.subtype === 'task_notification')).toMatchObject({ task_id: agentId, status: 'stopped', reason: 'worker_restart', output_file: sessionFile });
    expect((await status()).status).toBe('interrupted');
    await restart(fixture);
    expect(notices(fixture, agentId)).toHaveLength(1);
  } finally {
    vi.useRealTimers();
    await fixture.close();
  }
});

function stubSession() {
  const sent: Array<{ customType: string; content: string; details: Record<string, unknown> }> = [];
  const entries: TaskRecord[] = [];
  const frames: Record<string, unknown>[] = [];
  const events = createEventBus();
  const pi = { events, getFlag: () => undefined, appendEntry: (type: string, data: unknown) => (type === 'pstack-task' ? entries.push(data as TaskRecord) : frames.push(data as Record<string, unknown>)), sendMessage: (message: (typeof sent)[number]) => sent.push(message) };
  const sdk = new SdkEvents(pi as never);
  sdk.attach('owner-session');
  const lost = (id: string): TaskRecord => ({ id, persona: 'general-purpose', cwd: '/w', readonly: false, sessionFile: `/nowhere/agent-${id}.jsonl`, outputFile: '/nowhere/o.txt', status: 'running', output: '', description: `job ${id}`, requestShape: 'background' });
  const run = (ids: string[]) => reconcileOrphans({ pi: pi as never, frames: sdk, ctx: {} as never, branch: ids.map((id) => ({ type: 'custom', customType: 'pstack-task', data: lost(id) })), resume: undefined, canRead: false });
  return { sent, entries, frames, run };
}

test('[B101][C110] an orphan whose transcript is gone is failed and told its in-process state was lost', () => {
  const { sent, entries, frames, run } = stubSession();
  const { records } = run(['x']);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.details).toEqual({ task_id: 'x', status: 'failed', summary: `Background agent "job x" didn't finish before the previous session ended`, task_type: 'local_agent', reason: 'worker_restart' });
  expect(sent[0]?.content).toContain('Its in-process state was lost.');
  expect(entries).toEqual([expect.objectContaining({ id: 'x', status: 'failed', output: expect.stringContaining('Its in-process state was lost.') })]);
  expect(records.get('x')?.status).toBe('failed');
  expect(frames).toEqual([expect.objectContaining({ subtype: 'task_notification', task_id: 'x', status: 'stopped', reason: 'worker_restart', session_id: 'owner-session' })]);
});

test('[B101] more than twenty lost orphans produce one aggregate notification and a frame per task', () => {
  const { sent, entries, frames, run } = stubSession();
  run(Array.from({ length: 21 }, (_, index) => `t${index}`));
  expect(sent).toHaveLength(1);
  expect(sent[0]?.content).toContain('<status>failed</status>');
  expect(sent[0]?.content).toContain('<task-id>__orphan_summary__:agent</task-id>');
  expect(entries).toHaveLength(21);
  expect(frames.map((frame) => frame.summary)).toEqual(Array(21).fill('Orphaned by a previous Claude Code process exit and reported in an aggregate summary.'));
});

test('[C108] orphan notifications go to the session that owns the task, never to another session', () => {
  const owner = stubSession();
  const bystander = stubSession();
  owner.run(['grandchild']);
  bystander.run([]);
  expect(owner.sent.map((message) => message.details.task_id)).toEqual(['grandchild']);
  expect(bystander.sent).toEqual([]);
});
