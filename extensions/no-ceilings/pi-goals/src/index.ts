import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AgentBeforeSettleEvent, AgentBeforeSettleEventResult, ExtensionAPI, ExtensionContext, SessionEntry } from '@earendil-works/pi-coding-agent';
import { registerGoalCommands } from './commands.ts';
import { buildGoalContextMessage, buildGoalContinuationMessage } from './prompts.ts';
import { canContinueGoal, freezeActiveDuration, isGoalActive, pauseActiveGoalOnInterrupt, recordGoalContinuation, restoreGoalState, shouldAutoPauseForIdle, toPersistedGoalState, transitionGoalStatus } from './state.ts';
import { registerGoalTools } from './tools.ts';
import { DECIMAL_RADIX, DEFAULT_MAX_IDLE_CONTINUATIONS, GOAL_CONTEXT_CUSTOM_TYPE, GOAL_CONTINUATION_CUSTOM_TYPE, GOAL_STATE_ENTRY_TYPE, type GoalState, ONE, PersistedGoalStateSchema, ZERO } from './types.ts';
import { renderGoalContinuationMessage, syncGoalUi } from './ui-renderers.ts';

function isGoalContextMessage(message: AgentMessage): boolean {
  return 'customType' in message && message.customType === GOAL_CONTEXT_CUSTOM_TYPE;
}

function restoreGoalFromEntries(entries: readonly SessionEntry[], sessionId: string): GoalState | undefined {
  const lastEntry = entries.filter((entry) => entry.type === 'custom' && 'customType' in entry && entry.customType === GOAL_STATE_ENTRY_TYPE).at(-ONE);
  if (!lastEntry || !('data' in lastEntry)) {
    return undefined;
  }
  const parsed = PersistedGoalStateSchema.safeParse(lastEntry.data);
  if (!parsed.success || parsed.data.conversationId !== sessionId) {
    return undefined;
  }
  return restoreGoalState(parsed.data);
}

function readMaxIdleFromFlag(pi: ExtensionAPI): number {
  const raw = pi.getFlag('goal-max-idle');
  if (typeof raw !== 'string') {
    return DEFAULT_MAX_IDLE_CONTINUATIONS;
  }
  const parsed = Number.parseInt(raw, DECIMAL_RADIX);
  return Number.isFinite(parsed) && parsed >= ONE ? parsed : DEFAULT_MAX_IDLE_CONTINUATIONS;
}

interface GoalRuntimeController {
  readonly getGoal: () => GoalState | undefined;
  readonly setGoal: (next: GoalState | undefined, ctx: ExtensionContext) => void;
  readonly setGoalWithoutPersist: (next: GoalState | undefined, ctx: ExtensionContext) => void;
  readonly getHadToolCalls: () => boolean;
  readonly setHadToolCalls: (value: boolean) => void;
  readonly restoreFromSession: (ctx: ExtensionContext) => void;
  readonly handleShutdown: () => void;
}

function createGoalRuntimeController(pi: ExtensionAPI): GoalRuntimeController {
  let goal: GoalState | undefined;
  let hadToolCalls = false;

  const setGoalWithoutPersist = (next: GoalState | undefined, ctx: ExtensionContext): void => {
    goal = next;
    syncGoalUi(ctx, () => goal);
  };

  const setGoal = (next: GoalState | undefined, ctx: ExtensionContext): void => {
    setGoalWithoutPersist(next, ctx);
    if (next !== undefined) {
      pi.appendEntry(GOAL_STATE_ENTRY_TYPE, toPersistedGoalState(next));
    }
  };

  const restoreFromSession = (ctx: ExtensionContext): void => {
    setGoalWithoutPersist(restoreGoalFromEntries(ctx.sessionManager.getEntries(), ctx.sessionManager.getSessionId()), ctx);
  };

  const handleShutdown = (): void => {
    if (!isGoalActive(goal)) {
      return;
    }
    const frozen = freezeActiveDuration(goal, Date.now());
    const next: GoalState = { ...goal, activeDurationMs: frozen.activeDurationMs, lastAccruedAtMs: frozen.lastAccruedAtMs };
    goal = next;
    pi.appendEntry(GOAL_STATE_ENTRY_TYPE, toPersistedGoalState(next));
  };

  return {
    getGoal: () => goal,
    setGoal,
    setGoalWithoutPersist,
    getHadToolCalls: () => hadToolCalls,
    setHadToolCalls: (value) => {
      hadToolCalls = value;
    },
    restoreFromSession,
    handleShutdown,
  };
}

function handleBeforeSettle(pi: ExtensionAPI, ctrl: GoalRuntimeController, event: AgentBeforeSettleEvent, ctx: ExtensionContext): AgentBeforeSettleEventResult | undefined {
  if (event.outcome !== 'completed' || !event.context.canContinue || event.context.pendingMessages.length > ZERO) {
    return undefined;
  }
  const current = ctrl.getGoal();
  if (!canContinueGoal(current, ctx.sessionManager.getSessionId(), pi.getFlag('no-goals') !== true)) {
    return undefined;
  }
  const nowMs = Date.now();
  const hadTools = ctrl.getHadToolCalls();
  if (shouldAutoPauseForIdle(current, hadTools, readMaxIdleFromFlag(pi))) {
    const paused = transitionGoalStatus(current, 'paused', nowMs);
    ctrl.setGoalWithoutPersist(paused, ctx);
    return {
      entries: [...event.entries, { type: 'custom', customType: GOAL_STATE_ENTRY_TYPE, data: toPersistedGoalState(paused) }],
      continue: false,
    };
  }
  const next = recordGoalContinuation(current, hadTools, nowMs);
  ctrl.setGoalWithoutPersist(next, ctx);
  return {
    entries: [...event.entries, { type: 'custom', customType: GOAL_STATE_ENTRY_TYPE, data: toPersistedGoalState(next) }, { type: 'custom_message', ...buildGoalContinuationMessage(next) }],
    continue: true,
  };
}

function registerGoalLifecycleEvents(pi: ExtensionAPI, ctrl: GoalRuntimeController): void {
  pi.on('session_start', async (_event, ctx) => {
    ctrl.restoreFromSession(ctx);
  });

  pi.on('session_tree', async (_event, ctx) => {
    ctrl.restoreFromSession(ctx);
  });

  pi.on('session_shutdown', async () => {
    ctrl.handleShutdown();
  });

  pi.on('context', async (event) => ({
    messages: event.messages.filter((msg) => !isGoalContextMessage(msg)),
  }));

  pi.on('before_agent_start', async (_event, ctx) => {
    const current = ctrl.getGoal();
    if (current === undefined) {
      return undefined;
    }
    const nowMs = Date.now();
    const activeReady = isGoalActive(current) && current.lastAccruedAtMs === undefined ? { ...current, lastAccruedAtMs: nowMs } : current;
    if (activeReady !== current) {
      ctrl.setGoalWithoutPersist(activeReady, ctx);
    }
    const content = buildGoalContextMessage(activeReady, nowMs);
    return content ? { message: { customType: GOAL_CONTEXT_CUSTOM_TYPE, content, display: false } } : undefined;
  });

  pi.on('agent_start', async () => {
    ctrl.setHadToolCalls(false);
  });

  pi.on('tool_execution_start', async () => {
    ctrl.setHadToolCalls(true);
  });

  pi.on('turn_end', async (event) => {
    if (event.toolResults.length > ZERO) {
      ctrl.setHadToolCalls(true);
    }
  });

  pi.on('agent_before_settle', async (event, ctx) => handleBeforeSettle(pi, ctrl, event, ctx));

  pi.on('agent_settled', async (event, ctx) => {
    if (!event.aborted) {
      return;
    }
    const paused = pauseActiveGoalOnInterrupt(ctrl.getGoal(), Date.now());
    if (paused !== undefined && paused !== ctrl.getGoal()) {
      ctrl.setGoal(paused, ctx);
    }
  });
}

export default function piGoalsExtension(pi: ExtensionAPI): void {
  const ctrl = createGoalRuntimeController(pi);

  pi.registerFlag('no-goals', { description: 'Disable automatic long-lived goal continuation', type: 'boolean', default: false });
  pi.registerFlag('goal-max-idle', {
    description: 'Maximum consecutive continuations without tool calls before auto-pausing',
    type: 'string',
    default: String(DEFAULT_MAX_IDLE_CONTINUATIONS),
  });

  pi.registerMessageRenderer(GOAL_CONTINUATION_CUSTOM_TYPE, (_message, _options, theme) => renderGoalContinuationMessage(theme));

  registerGoalTools(pi, { getGoal: ctrl.getGoal, setGoal: ctrl.setGoal });
  registerGoalCommands(pi, { getGoal: ctrl.getGoal, setGoal: ctrl.setGoal });
  registerGoalLifecycleEvents(pi, ctrl);
}
