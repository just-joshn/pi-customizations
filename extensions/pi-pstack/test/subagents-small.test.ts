import { createEventBus } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { AgentSelection } from '../src/subagents/agent-selection.ts';
import { builtInAgents } from '../src/subagents/builtin-agents.ts';
import { EventBridge } from '../src/subagents/child-events.ts';
import { noticeFor } from '../src/subagents/completion-wake.ts';
import { EventLog } from '../src/subagents/events.ts';
import { featureEnabled, rubberDuckRollout, subconsciousEnabled } from '../src/subagents/feature-flags.ts';
import { SubagentLimiter } from '../src/subagents/limiter.ts';
import { isLinkAcquire, LimiterProvider, limiterConfig, linkChannel, parentLimiter } from '../src/subagents/limiter-provider.ts';
import { SubagentScheduler } from '../src/subagents/scheduler.ts';
import { parseCopilotSettings } from '../src/subagents/settings.ts';
import { SettingsStore } from '../src/subagents/settings-store.ts';
import { TaskRegistry } from '../src/subagents/task-registry.ts';
import { waitSeconds } from '../src/subagents.ts';
import { workerFixture } from './worker-fixture.ts';

const log = () => {
  const seen: string[] = [];
  return { events: new EventLog({ emit: (envelope) => seen.push(envelope.type), persist: () => {} }), seen };
};
const agent = (name: string) => {
  const found = builtInAgents.find((candidate) => candidate.name === name);
  if (!found) throw new Error(name);
  return found;
};

test('feature flags read both override variables case-insensitively', () => {
  expect(featureEnabled({ COPILOT_CLI_ENABLED_FEATURE_FLAGS: ' A, b ' }, 'B')).toBe(true);
  expect(featureEnabled({ COPILOT_EXPERIMENTS: 'only' }, 'a')).toBe(false);
  expect(rubberDuckRollout({ COPILOT_EXPERIMENTS: 'copilot_cli_rubber_duck_gpt_claude' })).toBe(true);
  expect(rubberDuckRollout({ COPILOT_CLI_ENABLED_FEATURE_FLAGS: 'RUBBER_DUCK_AGENT' })).toBe(true);
  expect(subconsciousEnabled({ COPILOT_SUBCONSCIOUS: 'yes' })).toBe(true);
  expect(subconsciousEnabled({ COPILOT_CLI_ENABLED_FEATURE_FLAGS: 'copilot_subconscious' })).toBe(true);
  expect(subconsciousEnabled({})).toBe(false);
});

test('selecting an agent emits selected, deselecting emits deselected once, and a vanished agent is cleared', () => {
  const { events, seen } = log();
  const selection = new AgentSelection(events);
  selection.select(agent('explore'));
  expect(selection.getCurrent()?.definition.name).toBe('explore');
  expect(selection.refresh([agent('task')])).toBe(true);
  expect(selection.getCurrent()).toBe(undefined);
  selection.deselect();
  expect(seen).toEqual(['subagent.selected', 'subagent.deselected']);
});

test('a user-invisible agent cannot be selected and setPrompt targets only the selected agent', () => {
  const { events } = log();
  const selection = new AgentSelection(events);
  expect(() => selection.select({ ...agent('explore'), userInvocable: false })).toThrow("Agent 'explore' cannot be selected by the user.");
  selection.select(agent('explore'));
  expect(() => selection.setPrompt('task', 'x')).toThrow("Agent 'task' is not the selected agent.");
  expect(selection.setPrompt('explore', 'new').prompt).toBe('new');
});

test('the idle and terminal notices carry the documented sentence and kind', () => {
  const node = { id: 'a1', agentType: 'explore', agentDisplayName: 'alpha', mode: 'background', status: 'idle' } as Parameters<typeof noticeFor>[0];
  expect(noticeFor(node)?.data).toEqual({ kind: 'agent_idle', agentId: 'a1', summary: 'Agent "alpha" (explore) has finished processing and is now idle.' });
  expect(noticeFor({ ...node, status: 'failed', error: 'boom' })?.data).toMatchObject({ kind: 'agent_completed', summary: 'Agent "alpha" (explore) failed: boom.' });
  expect(noticeFor({ ...node, status: 'completed' })?.data).toMatchObject({ kind: 'agent_completed' });
  expect(noticeFor({ ...node, mode: 'sync' })).toBe(undefined);
  expect(noticeFor({ ...node, status: 'cancelled', cancelled: true })).toBe(undefined);
});

test('the bridge numbers turns and maps child session events to Copilot events', () => {
  const bridge = new EventBridge();
  expect(bridge.translate({ type: 'turn_start', turnIndex: 4, timestamp: 1 } as never)).toEqual({ type: 'assistant.turn_start', data: { turnId: '0' } });
  expect(bridge.translate({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } } as never)).toEqual({ type: 'assistant.message', data: { content: 'hi' } });
  expect(bridge.translate({ type: 'message_end', message: { role: 'user', content: 'hello' } } as never)).toEqual({ type: 'user.message', data: { content: 'hello' } });
  expect(bridge.translate({ type: 'message_end', message: { role: 'toolResult', content: [] } } as never)).toBe(undefined);
  expect(bridge.translate({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', delta: 'h' } } as never)).toEqual({ type: 'assistant.message_delta', data: { delta: 'h' }, ephemeral: true });
  expect(bridge.translate({ type: 'tool_execution_start', toolCallId: 't', toolName: 'read', args: { path: 'a' } } as never)).toEqual({ type: 'tool.execution_start', data: { toolCallId: 't', toolName: 'read', arguments: { path: 'a' } } });
  expect(bridge.translate({ type: 'tool_execution_end', toolCallId: 't', toolName: 'read', isError: true } as never)).toEqual({ type: 'tool.execution_complete', data: { toolCallId: 't', toolName: 'read', success: false } });
  expect(bridge.translate({ type: 'tool_execution_start', toolCallId: 'n', toolName: 'x', args: {}, parentToolCallId: 'p' } as never)).toBe(undefined);
  expect(bridge.translate({ type: 'turn_end', toolResults: [] } as never)).toEqual({ type: 'assistant.turn_end', data: { turnId: '0' } });
  expect(bridge.translate({ type: 'agent_settled' } as never)).toBe(undefined);
});

test('settings overrides layer over the files per agent and per field', () => {
  const store = new SettingsStore(() => ({ subagents: { agents: { explore: { model: 'm', effortLevel: 'low' } }, disabledSubagents: ['a'] } }));
  store.update({ agents: { explore: { effortLevel: 'high' }, task: { model: 't' } }, disabledSubagents: ['b'], contextManagementTools: true });
  const { settings, warnings } = store.read('/repo');
  expect(warnings).toEqual([]);
  expect(settings.subagents).toEqual({ agents: { explore: { model: 'm', effortLevel: 'high' }, task: { model: 't' } }, disabledSubagents: ['b'], contextManagementTools: true });
  store.update({ agents: { explore: { contextTier: 'default' } } });
  expect(store.read('/repo').settings.subagents.agents.explore).toEqual({ model: 'm', effortLevel: 'high', contextTier: 'default' });
});

test('the limiter provider builds one root limiter from the first settings and a child uses its parent', () => {
  const settings = new SettingsStore(() => ({ subagents: { maxConcurrency: 2, maxDepth: 3 } }));
  const provider = new LimiterProvider(
    settings,
    () => undefined,
    () => 8,
  );
  const first = provider.get('/repo');
  expect(provider.get('/other')).toBe(first);
  provider.reset();
  expect(provider.get('/repo')).not.toBe(first);
  const parent = new SubagentLimiter({ maxConcurrent: 1, maxDepth: 1 });
  expect(new LimiterProvider(settings, () => parent).get('/repo')).toBe(parent);
  expect(limiterConfig(parseCopilotSettings({}).settings, 8)).toEqual({ maxConcurrent: 8, maxDepth: 4 });
});

test('a child asks the parent for slots over its bus and an unanswered bus refuses', () => {
  const bus = createEventBus();
  const root = new SubagentLimiter({ maxConcurrent: 1, maxDepth: 4 });
  bus.on(linkChannel, (payload) => {
    if (isLinkAcquire(payload)) payload.reply(root.tryAcquire(payload.request));
  });
  const child = parentLimiter(bus);
  expect(child.tryAcquire({ kind: 'spawn', depth: 1 }).ok).toBe(true);
  expect(child.tryAcquire({ kind: 'spawn', depth: 1 })).toMatchObject({ ok: false, limit: 'concurrent' });
  expect(parentLimiter(createEventBus()).tryAcquire({ kind: 'resume' })).toEqual({ ok: false, limit: 'concurrent', message: 'The parent session is not accepting subagents.' });
  expect(isLinkAcquire({ kind: 'acquire', request: { kind: 'spawn', depth: -1 }, reply: () => {} })).toBe(false);
  expect(isLinkAcquire({ kind: 'acquire', request: { kind: 'resume' } })).toBe(false);
});

test('a persisted running agent is closed as cancelled when the session restarts', async () => {
  const fixture = await workerFixture();
  try {
    const node = {
      id: 'ghost',
      registryId: 'r',
      toolCallId: 'c',
      agentType: 'explore',
      agentDisplayName: 'ghost',
      agentDescription: 'Explore',
      description: 'd',
      prompt: 'p',
      mode: 'background',
      status: 'running',
      depth: 1,
      turns: [],
      startedAt: 1,
      model: 'p/m',
      modelSource: 'session_inheritance',
      taskModelSource: 'unset',
      contextTier: 'inherit',
      firstDispatchedModel: 'p/m',
      totalToolCalls: 0,
      totalTokens: 0,
      sessionFile: '/s.jsonl',
      cwd: '/repo',
    };
    fixture.session.sessionManager.appendCustomEntry('copilot-agent', node);
    await fixture.session.extensionRunner.emit({ type: 'session_start', reason: 'reload' });
    expect(fixture.subagentLogs).toContain('Closed interrupted sub-agent records on resume: closed 1, dangling 0');
    expect(String(((await fixture.call('read_agent', { agent_id: 'ghost' })) as { content: { text: string }[] }).content[0]?.text)).toContain('Agent was cancelled.');
  } finally {
    await fixture.close();
  }
});

function node(id: string, status: 'running' | 'idle') {
  return {
    id,
    registryId: `r-${id}`,
    toolCallId: id,
    agentType: 'explore',
    agentDisplayName: id,
    agentDescription: 'd',
    description: 'd',
    prompt: 'p',
    mode: 'background',
    status,
    depth: 1,
    turns: status === 'idle' ? ['t'] : [],
    startedAt: 1,
    model: 'p/m',
    modelSource: 'session_inheritance',
    taskModelSource: 'unset',
    contextTier: 'inherit',
    firstDispatchedModel: 'p/m',
    totalToolCalls: 0,
    totalTokens: 0,
    sessionFile: '/s',
    cwd: '/r',
  } as const;
}

function schedulerHarness(running: readonly string[] = []) {
  const registry = new TaskRegistry({ persist: () => {} });
  const pi = { on: () => () => {}, events: { emit: () => {}, on: () => () => {} }, appendEntry: () => {}, sendMessage: () => {} };
  const scheduler = new SubagentScheduler({ pi: pi as never, events: new EventLog({ emit: () => {}, persist: () => {} }), registry, limiter: () => new SubagentLimiter({ maxConcurrent: 2, maxDepth: 4 }), log: () => {} });
  for (const id of running) registry.register(node(id, 'running'));
  return { registry, scheduler, node };
}

test('rewind is refused while agents run and blocks starts once begun', async () => {
  const { registry, scheduler } = schedulerHarness(['a']);
  expect(scheduler.beginRewind()).toEqual({ cancel: true });
  expect(scheduler.blocksStart()).toBe(false);
  registry.transition('a', 'idle');
  expect(scheduler.beginRewind()).toEqual({ cancel: false });
  expect(scheduler.blocksStart()).toBe(true);
});

test('cancelAll can include idle agents and leaves finished ones alone', async () => {
  const { registry, scheduler, node } = schedulerHarness([]);
  registry.register(node('idle-1', 'running'));
  registry.transition('idle-1', 'idle', { turns: ['t'] });
  const cancelled = await scheduler.cancelAll(true);
  expect(cancelled.map((node) => node.id)).toEqual(['idle-1']);
  expect(registry.get('idle-1')?.status).toBe('cancelled');
});

test('waiting for background work drains or times out', async () => {
  const running = schedulerHarness(['a']);
  expect(await running.scheduler.waitForWork(50)).toBe(false);
  const idle = schedulerHarness([]);
  expect(await idle.scheduler.waitForWork(50)).toBe(true);
});

test.for([
  { value: undefined, expected: 300 },
  { value: '45', expected: 45 },
  { value: '0', expected: 300 },
  { value: 'later', expected: 300 },
])('COPILOT_TASK_WAIT_TIMEOUT_SECONDS=$value gives $expected seconds', ({ value, expected }) => {
  expect(waitSeconds(value === undefined ? {} : { COPILOT_TASK_WAIT_TIMEOUT_SECONDS: value })).toBe(expected);
});
