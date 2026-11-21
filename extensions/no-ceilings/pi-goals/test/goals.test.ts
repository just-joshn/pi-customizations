import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoalState } from '../src/types.ts';
import { createGoalsTestHarness, double, type GoalsTestHarness } from './harness.ts';

const GOAL_ENTRY_TYPE = 'pi-goals:state';
const GOAL_CONTINUATION_TYPE = 'pi-goals:continuation';
const GOAL_CONTEXT_TYPE = 'pi-goals:context';
const GOAL_STATUS_KEY = 'pi-goals';
const GOAL_WIDGET_KEY = 'pi-goals-status';
const GOAL_PREFIX = '/goal';
const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const SAMPLE_GOAL_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ZERO = 0;
const ONE = 1;
const TWO = 2;
const WIDGET_WIDTH = 40;
const FIVE_SECONDS_MS = 5000;
const SIXTY_FIVE_SECONDS_MS = 65_000;
const HOUR_TWO_MIN_THREE_SEC_MS = 3_723_000;
const DAY_TWO_HOUR_THREE_MIN_MS = 93_780_000;
const BASE_TIME_MS = 1_700_000_000_000;

let activeHarness: GoalsTestHarness | undefined;

afterEach(async () => {
  vi.useRealTimers();
  const current = activeHarness;
  activeHarness = undefined;
  if (current) {
    await current.cleanup();
  }
});

describe('goal command lifecycle', () => {
  it('shows usage hint when /goal is invoked with empty arguments', async () => {
    const h = createGoalsTestHarness();
    activeHarness = h;
    await h.runCommand('goal', '   ');
    expect(h.getNotifications().at(-ONE)?.message).toContain(`Usage: ${GOAL_PREFIX} <objective>`);
    expect(h.getSentUserMessages()).toHaveLength(ZERO);
  });

  it('starts an active goal via /goal <objective>, updates status line & widget, and submits user message', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME_MS);
    const h = createGoalsTestHarness({ sessionId: SESSION_ID });
    activeHarness = h;

    await h.runCommand('goal', 'Migrate test suite to Vitest');

    expect(h.getSentUserMessages()).toEqual([{ content: `${GOAL_PREFIX} Migrate test suite to Vitest`, options: { deliverAs: 'followUp' } }]);
    expect(h.getStatuses()[GOAL_STATUS_KEY]).toBe('Goal active (0s)');
    expect(h.getWidgets()[GOAL_WIDGET_KEY]?.options?.placement).toBe('aboveEditor');

    const rendered = h.renderWidget(GOAL_WIDGET_KEY, WIDGET_WIDTH);
    expect(rendered.lines).toHaveLength(ONE);
    expect(rendered.lines[ZERO]?.trim()).toBe('Goal active (0s)');
    expect(rendered.lines[ZERO]?.length).toBe(WIDGET_WIDTH);
    rendered.dispose();
  });

  it('supports /goal pause, resume, status, complete, and clear subcommands', async () => {
    const h = createGoalsTestHarness({ sessionId: SESSION_ID });
    activeHarness = h;

    await h.runCommand('goal', 'Refactor storage layer');
    await h.runCommand('goal', 'pause');
    expect(h.getStatuses()[GOAL_STATUS_KEY]).toMatch(/^Goal paused \(/);

    await h.runCommand('goal', 'status');
    expect(h.getNotifications().at(-ONE)?.message).toContain('Refactor storage layer');

    await h.runCommand('goal', 'resume');
    expect(h.getStatuses()[GOAL_STATUS_KEY]).toMatch(/^Goal active \(/);
    expect(h.getSentMessages()).toHaveLength(ONE);

    await h.runCommand('goal', 'clear');
    expect(h.getStatuses()[GOAL_STATUS_KEY]).toBeUndefined();
  });
});

describe('create_goal and update_goal tools', () => {
  it('creates and updates goals with exact visual headers', async () => {
    const h = createGoalsTestHarness({ sessionId: SESSION_ID });
    activeHarness = h;

    expect(h.renderToolCall('create_goal', { objective: 'Ship v1' }).join('\n')).toContain('**Creating goal** Ship v1');
    const createRes = await h.callTool('create_goal', { objective: 'Ship v1' });
    expect(createRes.details?.outcome).toBe('success');
    expect(h.renderToolResult('create_goal', createRes, false, false).join('\n')).toContain('**Created goal** Ship v1');

    expect(h.renderToolCall('update_goal', { status: 'paused' }).join('\n')).toContain('**Updating goal** paused');
    const pauseRes = await h.callTool('update_goal', { status: 'paused' });
    expect(pauseRes.details?.outcome).toBe('success');
    expect(h.renderToolResult('update_goal', pauseRes, false, false).join('\n')).toContain('**Updated goal** paused');
    expect(h.getStatuses()[GOAL_STATUS_KEY]).toMatch(/^Goal paused \(/);

    const completeRes = await h.callTool('update_goal', { status: 'complete' });
    expect(completeRes.details?.outcome).toBe('success');
    expect(h.getStatuses()[GOAL_STATUS_KEY]).toBeUndefined();
    expect(h.getWidgets()[GOAL_WIDGET_KEY]).toBeUndefined();
  });

  it('returns error tool results and renders dim error detail for invalid inputs', async () => {
    const h = createGoalsTestHarness();
    activeHarness = h;

    const emptyCreate = await h.callTool('create_goal', { objective: '   ' });
    expect(emptyCreate.details?.outcome).toBe('error');
    expect(h.renderToolResult('create_goal', emptyCreate, false, false).join('\n')).toContain('Goal objective must be non-empty');

    const noGoalUpdate = await h.callTool('update_goal', { status: 'complete' });
    expect(noGoalUpdate.details?.outcome).toBe('error');
    expect(h.renderToolResult('update_goal', noGoalUpdate, false, false).join('\n')).toContain('No goal exists in this session');
  });
});

describe('automatic continuation and auto-pause', () => {
  it('dispatches Continuing goal in agent_before_settle when active and renders bold marker', async () => {
    const h = createGoalsTestHarness({ sessionId: SESSION_ID });
    activeHarness = h;

    await h.callTool('create_goal', { objective: 'Finish all benchmarks' });
    await h.emit('agent_start', { type: 'agent_start' });
    await h.emit('tool_execution_start', { type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: {} });

    const settleResult = double<{ readonly continue?: boolean; readonly entries?: readonly { readonly type: string; readonly customType?: string }[] }>(await h.emit('agent_before_settle', h.buildBeforeSettleEvent()));
    expect(settleResult.continue).toBe(true);
    expect(settleResult.entries?.some((e) => e.type === 'custom_message' && e.customType === GOAL_CONTINUATION_TYPE)).toBe(true);
    expect(h.renderMessage(GOAL_CONTINUATION_TYPE, { content: 'continue' }).join('\n')).toContain('**Continuing goal**');
  });

  it('auto-pauses after max consecutive idle continuations without tool calls', async () => {
    const h = createGoalsTestHarness({ sessionId: SESSION_ID, flags: { 'goal-max-idle': String(TWO) } });
    activeHarness = h;

    await h.callTool('create_goal', { objective: 'Keep monitoring' });
    await h.emit('agent_start', { type: 'agent_start' });
    const first = double<{ readonly continue?: boolean }>(await h.emit('agent_before_settle', h.buildBeforeSettleEvent()));
    expect(first.continue).toBe(true);

    await h.emit('agent_start', { type: 'agent_start' });
    const second = double<{ readonly continue?: boolean }>(await h.emit('agent_before_settle', h.buildBeforeSettleEvent()));
    expect(second.continue).toBe(false);
    expect(h.getStatuses()[GOAL_STATUS_KEY]).toMatch(/^Goal paused \(/);
  });
});

describe('pause-on-interrupt and continuation guards', () => {
  it('pauses active goal and freezes active duration when aborted in agent_settled', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME_MS);
    const h = createGoalsTestHarness({ sessionId: SESSION_ID });
    activeHarness = h;

    await h.callTool('create_goal', { objective: 'Long refactor' });
    vi.setSystemTime(BASE_TIME_MS + SIXTY_FIVE_SECONDS_MS);

    await h.emit('agent_settled', { type: 'agent_settled', aborted: true });

    expect(h.getStatuses()[GOAL_STATUS_KEY]).toBe('Goal paused (1m 5s)');
    const lastPersisted = double<GoalState>(h.getEntries().at(-ONE)?.data);
    expect(lastPersisted.status).toBe('paused');
    expect(lastPersisted.activeDurationMs).toBe(SIXTY_FIVE_SECONDS_MS);
    expect(lastPersisted.lastAccruedAtMs).toBeUndefined();
  });

  it('does not continue when --no-goals is enabled or pending messages exist', async () => {
    const disabled = createGoalsTestHarness({ sessionId: SESSION_ID, flags: { 'no-goals': true } });
    activeHarness = disabled;
    await disabled.callTool('create_goal', { objective: 'Disabled goal' });
    expect(await disabled.emit('agent_before_settle', disabled.buildBeforeSettleEvent())).toBeUndefined();
    await disabled.cleanup();

    const pending = createGoalsTestHarness({ sessionId: SESSION_ID });
    activeHarness = pending;
    await pending.callTool('create_goal', { objective: 'Pending test' });
    const pendingCtx = { contextEntries: [], contextMessages: [], llmMessages: [], pendingMessages: [{ role: 'user' as const, content: 'next', timestamp: BASE_TIME_MS }], canContinue: true };
    expect(await pending.emit('agent_before_settle', pending.buildBeforeSettleEvent({ context: pendingCtx }))).toBeUndefined();
  });
});

describe('context injection, session persistence, and duration formatting', () => {
  it('injects goal context in before_agent_start and strips stale context in context event', async () => {
    const h = createGoalsTestHarness({ sessionId: SESSION_ID });
    activeHarness = h;

    await h.callTool('create_goal', { objective: 'Optimize bundle size' });
    const injected = double<{ readonly message?: { readonly customType: string; readonly content: string; readonly display: boolean } }>(await h.emit('before_agent_start', { type: 'before_agent_start', messageType: 'user', prompt: 'hi' }));
    expect(injected.message?.customType).toBe(GOAL_CONTEXT_TYPE);
    expect(injected.message?.display).toBe(false);
    expect(injected.message?.content).toContain('Optimize bundle size');

    const messages = [
      { role: 'custom', customType: GOAL_CONTEXT_TYPE, content: 'stale', display: false, timestamp: BASE_TIME_MS },
      { role: 'user', content: 'keep me', timestamp: BASE_TIME_MS },
    ];
    const filtered = double<{ readonly messages: readonly { readonly role: string }[] }>(await h.emit('context', { type: 'context', messages }));
    expect(filtered.messages).toHaveLength(ONE);
    expect(filtered.messages[ZERO]?.role).toBe('user');
  });

  it('restores persisted goal state on session_start and formats hours/days durations accurately', async () => {
    const hourGoal: GoalState = {
      conversationId: SESSION_ID,
      goalId: SAMPLE_GOAL_ID,
      objective: 'Run soak suite',
      status: 'paused',
      idleContinuationsWithoutToolCalls: ZERO,
      activeDurationMs: HOUR_TWO_MIN_THREE_SEC_MS,
      lastAccruedAtMs: undefined,
      continuationCount: TWO,
    };
    const h = createGoalsTestHarness({ sessionId: SESSION_ID, initialEntries: [{ type: 'custom', customType: GOAL_ENTRY_TYPE, data: hourGoal }] });
    activeHarness = h;

    await h.emit('session_start', { type: 'session_start' });
    expect(h.getStatuses()[GOAL_STATUS_KEY]).toBe('Goal paused (1h 2m 3s)');
    await h.cleanup();

    const dayGoal: GoalState = { ...hourGoal, activeDurationMs: DAY_TWO_HOUR_THREE_MIN_MS };
    const h2 = createGoalsTestHarness({ sessionId: SESSION_ID, initialEntries: [{ type: 'custom', customType: GOAL_ENTRY_TYPE, data: dayGoal }] });
    activeHarness = h2;

    await h2.emit('session_start', { type: 'session_start' });
    expect(h2.getStatuses()[GOAL_STATUS_KEY]).toBe('Goal paused (1d 2h 3m)');
  });
});

describe('interrogate regression tests', () => {
  it('increments continuationCount consistently in prompt, details, and persisted state on /goal resume', async () => {
    const h = createGoalsTestHarness({ sessionId: SESSION_ID });
    activeHarness = h;

    await h.runCommand('goal', 'Ship feature X');
    await h.runCommand('goal', 'pause');
    await h.runCommand('goal', 'resume');

    const sent = double<{ readonly content: string; readonly details: { readonly continuationCount: number } }>(h.getSentMessages().at(-ONE)?.message);
    expect(sent.content).toContain('(continuation #1):');
    expect(sent.details.continuationCount).toBe(ONE);
    expect(double<GoalState>(h.getEntries().at(-ONE)?.data).continuationCount).toBe(ONE);
  });

  it('keeps footer status in sync with live above-editor widget as active time ticks', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME_MS);
    const h = createGoalsTestHarness({ sessionId: SESSION_ID });
    activeHarness = h;

    await h.runCommand('goal', 'Long task');
    const renderedInitial = h.renderWidget(GOAL_WIDGET_KEY, WIDGET_WIDTH);
    vi.advanceTimersByTime(FIVE_SECONDS_MS);

    expect(h.getStatuses()[GOAL_STATUS_KEY]).toBe('Goal active (5s)');
    renderedInitial.dispose();
  });

  it('treats cleared goals as absent in /goal status and blocks resurrecting them via update_goal', async () => {
    const h = createGoalsTestHarness({ sessionId: SESSION_ID });
    activeHarness = h;

    await h.runCommand('goal', 'Old goal');
    await h.runCommand('goal', 'clear');
    await h.runCommand('goal', 'status');
    expect(h.getNotifications().at(-ONE)?.message).toContain(`No active goal. Usage: ${GOAL_PREFIX} <objective>`);

    const resurrected = await h.callTool('update_goal', { status: 'active' });
    expect(resurrected.details?.outcome).toBe('error');
  });

  it('renders fallback text from result.content when renderGoalToolResult receives undefined details', () => {
    const h = createGoalsTestHarness({ sessionId: SESSION_ID });
    activeHarness = h;

    const lines = h.renderToolResult('create_goal', { content: [{ type: 'text', text: 'Tool crashed: timeout' }], details: undefined }, false, false);
    expect(lines.join('\n')).toContain('Tool crashed: timeout');
  });
});

describe('interrogate round 2 regression tests', () => {
  it('ignores persisted goal entries from another session when restoring a forked session', async () => {
    const parentGoal: GoalState = {
      conversationId: 'parent-session-id',
      goalId: SAMPLE_GOAL_ID,
      objective: 'Parent goal',
      status: 'active',
      idleContinuationsWithoutToolCalls: ZERO,
      activeDurationMs: SIXTY_FIVE_SECONDS_MS,
      lastAccruedAtMs: undefined,
      continuationCount: ONE,
    };
    const h = createGoalsTestHarness({ sessionId: 'forked-session-id', initialEntries: [{ type: 'custom', customType: GOAL_ENTRY_TYPE, data: parentGoal }] });
    activeHarness = h;

    await h.emit('session_start', { type: 'session_start' });
    expect(h.getStatuses()[GOAL_STATUS_KEY]).toBeUndefined();
    expect(await h.emit('before_agent_start', { type: 'before_agent_start', messageType: 'user', prompt: 'hi' })).toBeUndefined();
  });

  it('queues /goal <objective> with deliverAs followUp so it succeeds even while streaming', async () => {
    const h = createGoalsTestHarness({ sessionId: SESSION_ID });
    activeHarness = h;

    await h.runCommand('goal', 'Queue safely while busy');
    expect(h.getSentUserMessages().at(-ONE)).toEqual({
      content: `${GOAL_PREFIX} Queue safely while busy`,
      options: { deliverAs: 'followUp' },
    });
  });

  it('warns No goal to update when /goal complete or /goal clear is called after clearing a goal', async () => {
    const h = createGoalsTestHarness({ sessionId: SESSION_ID });
    activeHarness = h;

    await h.runCommand('goal', 'Temporary goal');
    await h.runCommand('goal', 'clear');
    await h.runCommand('goal', 'complete');

    expect(h.getNotifications().at(-ONE)).toEqual({ message: 'No goal to update.', level: 'warning' });
  });

  it('treats Object.prototype property names like constructor and __proto__ as goal objectives, not subcommands', async () => {
    const h = createGoalsTestHarness({ sessionId: SESSION_ID });
    activeHarness = h;

    await h.runCommand('goal', 'constructor');
    await h.runCommand('goal', '__proto__');

    expect(h.getSentUserMessages()).toEqual([
      { content: `${GOAL_PREFIX} constructor`, options: { deliverAs: 'followUp' } },
      { content: `${GOAL_PREFIX} __proto__`, options: { deliverAs: 'followUp' } },
    ]);
  });
});
