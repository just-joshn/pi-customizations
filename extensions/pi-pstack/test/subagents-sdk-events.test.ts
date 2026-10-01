import { createEventBus } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { sdkEntryType, sdkEventChannel } from '../src/subagents/sdk-events.ts';
import { WorkerRuntime } from '../src/worker-runtime.ts';
import { workerFixture } from './worker-fixture.ts';
import { workerTiming } from './worker-timing.ts';

type Frame = Record<string, unknown> & { subtype?: string; type: string };
type Fixture = Awaited<ReturnType<typeof workerFixture>>;

function collect(fixture: Fixture): Frame[] {
  const frames: Frame[] = [];
  fixture.eventBus.on(sdkEventChannel, (frame) => frames.push(frame as Frame));
  return frames;
}

function persisted(fixture: Fixture): Frame[] {
  return fixture.session.sessionManager.getBranch().flatMap((entry) => (entry.type === 'custom' && entry.customType === sdkEntryType ? [entry.data as Frame] : []));
}

const subtypes = (frames: Frame[]) => frames.filter((frame) => frame.type === 'system').map((frame) => frame.subtype);
const settled = (frames: Frame[], subtype: string) => vi.waitFor(() => expect(subtypes(frames)).toContain(subtype), { timeout: workerTiming.settlementDeadlineMs, interval: workerTiming.pollIntervalMs });

test('[B103][C105] a foreground launch emits task_started with the full SDK field set, then a terminal task_updated patch', async () => {
  const fixture = await workerFixture();
  try {
    const frames = collect(fixture);
    const done = await fixture.call('Agent', { description: 'frame probe', prompt: 'hello', run_in_background: false });
    const agentId = (done.details as { agentId: string }).agentId;
    const started = frames.find((frame) => frame.subtype === 'task_started');
    expect(started).toEqual({
      type: 'system',
      subtype: 'task_started',
      task_id: agentId,
      tool_use_id: 'test-Agent',
      description: 'frame probe',
      subagent_type: 'general-purpose',
      is_backgrounded: false,
      spawn_depth: 1,
      task_type: 'local_agent',
      prompt: 'hello',
      skip_transcript: false,
      ambient: false,
      uuid: expect.any(String),
      session_id: fixture.session.sessionManager.getSessionId(),
    });
    const updated = frames.find((frame) => frame.subtype === 'task_updated');
    expect(updated).toMatchObject({ task_id: agentId, patch: { status: 'completed', end_time: expect.any(Number) } });
    expect(persisted(fixture).map((frame) => frame.subtype)).toEqual(subtypes(frames));
  } finally {
    await fixture.close();
  }
});

test('[B103][B104] a background launch is backgrounded, and a resume registers as backgrounded with its own tool_use_id', async () => {
  const fixture = await workerFixture();
  try {
    const frames = collect(fixture);
    const first = await fixture.call('Agent', { description: 'bg probe', prompt: 'hello' });
    const agentId = (first.details as { agentId: string }).agentId;
    await settled(frames, 'task_notification');
    await fixture.call('SendMessage', { to: agentId, message: 'again' });
    await vi.waitFor(() => expect(frames.filter((frame) => frame.subtype === 'task_started')).toHaveLength(2), { timeout: workerTiming.settlementDeadlineMs });
    const starts = frames.filter((frame) => frame.subtype === 'task_started');
    expect(starts.map((frame) => frame.is_backgrounded)).toEqual([true, true]);
    expect(starts.map((frame) => frame.task_id)).toEqual([agentId, agentId]);
    expect(starts[1]?.prompt).toBe('again');
    const notice = frames.find((frame) => frame.subtype === 'task_notification');
    expect(notice).toMatchObject({ task_id: agentId, tool_use_id: 'test-Agent', status: 'completed', summary: 'Agent "bg probe" finished' });
  } finally {
    await fixture.close();
  }
});

test('[B105] task_progress reports usage and the last tool after each tool call', async () => {
  const fixture = await workerFixture();
  try {
    const frames = collect(fixture);
    await fixture.call('Agent', { description: 'progress probe', prompt: 'PROGRESS_READ', run_in_background: false });
    const progress = frames.find((frame) => frame.subtype === 'task_progress');
    expect(progress).toMatchObject({
      description: 'progress probe',
      subagent_type: 'general-purpose',
      last_tool_name: 'read',
      tool_use_id: 'test-Agent',
      usage: { tool_uses: 1, total_tokens: expect.any(Number), duration_ms: expect.any(Number) },
    });
  } finally {
    await fixture.close();
  }
});

test('[C103] --forward-subagent-text forwards child text with parent_tool_use_id, and nothing without the flag', async () => {
  const forwarding = await workerFixture({ flags: { 'forward-subagent-text': 'true' } });
  try {
    const frames = collect(forwarding);
    await forwarding.call('Agent', { description: 'forward probe', prompt: 'hello', run_in_background: false });
    const assistant = frames.find((frame) => frame.type === 'assistant');
    expect(assistant).toMatchObject({ type: 'assistant', parent_tool_use_id: 'test-Agent', message: { role: 'assistant', content: [{ type: 'text', text: 'users=1' }] } });
    expect(frames.find((frame) => frame.type === 'user')).toMatchObject({ parent_tool_use_id: 'test-Agent', message: { role: 'user', content: [{ type: 'text' }] } });
  } finally {
    await forwarding.close();
  }
  const silent = await workerFixture();
  try {
    const frames = collect(silent);
    await silent.call('Agent', { description: 'silent probe', prompt: 'hello', run_in_background: false });
    expect(frames.filter((frame) => frame.type !== 'system')).toEqual([]);
  } finally {
    await silent.close();
  }
});

test('[C48] hook events on pstack:hook-event become frames only with --include-hook-events', async () => {
  const exposed = await workerFixture({ flags: { 'include-hook-events': 'true' } });
  try {
    const frames = collect(exposed);
    exposed.eventBus.emit('pstack:hook-event', { hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'probe' });
    expect(frames).toEqual([{ type: 'system', subtype: 'hook_event', hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'probe', uuid: expect.any(String), session_id: exposed.session.sessionManager.getSessionId() }]);
  } finally {
    await exposed.close();
  }
  const hidden = await workerFixture();
  try {
    const frames = collect(hidden);
    hidden.eventBus.emit('pstack:hook-event', { hook_event_name: 'SubagentStop' });
    expect(frames).toEqual([]);
  } finally {
    await hidden.close();
  }
});

test('cumulative subagent stats are republished as subagent_stats frames', async () => {
  const fixture = await workerFixture();
  try {
    const frames = collect(fixture);
    await fixture.call('Agent', { description: 'stats probe', prompt: 'hello', run_in_background: false });
    const stats = frames.filter((frame) => frame.subtype === 'subagent_stats').at(-1);
    expect(stats).toMatchObject({ stats: { spawned: 1, completed: 1, failed: 0, killed: 0, max_depth: 1 } });
  } finally {
    await fixture.close();
  }
});

test('[B104] markBackgrounded reports the foreground-to-background transition as a task_updated patch', () => {
  const events = createEventBus();
  const entries: unknown[] = [];
  const pi = { events, appendEntry: (_type: string, data: unknown) => entries.push(data), getFlag: () => undefined, sendMessage: () => {}, on: () => {} };
  const frames: unknown[] = [];
  events.on(sdkEventChannel, (frame) => frames.push(frame));
  new WorkerRuntime(pi as never).markBackgrounded('agent-1');
  expect(frames).toEqual([{ type: 'system', subtype: 'task_updated', task_id: 'agent-1', patch: { is_backgrounded: true }, uuid: expect.any(String), session_id: '' }]);
  expect(entries).toEqual(frames);
});
