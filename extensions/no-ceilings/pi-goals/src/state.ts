import { randomUUID } from 'node:crypto';

import { DECIMAL_PLACES_ONE, type GoalState, type GoalStatus, MS_PER_SECOND, ONE, type PersistedGoalState, SECONDS_PER_DAY, SECONDS_PER_HOUR, SECONDS_PER_MINUTE, TEN_SECONDS_MS, ZERO } from './types.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGoalActive(goal: GoalState | undefined): goal is GoalState {
  return goal?.status === 'active';
}

export function isGoalPaused(goal: GoalState | undefined): goal is GoalState {
  return goal?.status === 'paused';
}

export function isLiveGoal(goal: GoalState | undefined): goal is GoalState {
  return goal !== undefined && goal.status !== 'cleared';
}

export function getActiveDurationMs(goal: GoalState | undefined): number {
  return goal?.activeDurationMs ?? ZERO;
}

export function computeEffectiveActiveDurationMs(baseMs: number, lastAccruedAtMs: number | undefined, nowMs: number): number {
  return lastAccruedAtMs === undefined ? baseMs : baseMs + Math.max(ZERO, nowMs - lastAccruedAtMs);
}

export function accrueActiveDuration(goal: GoalState | undefined, nowMs: number): number {
  return computeEffectiveActiveDurationMs(getActiveDurationMs(goal), goal?.lastAccruedAtMs, nowMs);
}

export function freezeActiveDuration(goal: GoalState | undefined, nowMs: number): { readonly activeDurationMs: number; readonly lastAccruedAtMs: undefined } {
  return { activeDurationMs: accrueActiveDuration(goal, nowMs), lastAccruedAtMs: undefined };
}

export function createGoalState(params: { readonly conversationId: string; readonly objective: string; readonly nowMs: number; readonly goalId?: string }): GoalState {
  return {
    conversationId: params.conversationId,
    goalId: params.goalId ?? randomUUID(),
    objective: params.objective.trim(),
    status: 'active',
    idleContinuationsWithoutToolCalls: ZERO,
    activeDurationMs: ZERO,
    lastAccruedAtMs: params.nowMs,
    continuationCount: ZERO,
  };
}

export function transitionGoalStatus(goal: GoalState, nextStatus: GoalStatus, nowMs: number): GoalState {
  if (nextStatus === 'active') {
    return { ...goal, status: 'active', lastAccruedAtMs: goal.lastAccruedAtMs ?? nowMs, idleContinuationsWithoutToolCalls: ZERO };
  }
  const frozen = freezeActiveDuration(goal, nowMs);
  return { ...goal, status: nextStatus, activeDurationMs: frozen.activeDurationMs, lastAccruedAtMs: frozen.lastAccruedAtMs };
}

export function pauseActiveGoalOnInterrupt(goal: GoalState | undefined, nowMs: number): GoalState | undefined {
  return isGoalActive(goal) ? transitionGoalStatus(goal, 'paused', nowMs) : goal;
}

export function shouldAutoPauseForIdle(goal: GoalState, hadToolCalls: boolean, maxIdleWithoutToolCalls: number): boolean {
  return !hadToolCalls && goal.idleContinuationsWithoutToolCalls + ONE >= maxIdleWithoutToolCalls;
}

export function recordGoalContinuation(goal: GoalState, hadToolCalls: boolean, nowMs: number): GoalState {
  return {
    ...goal,
    activeDurationMs: accrueActiveDuration(goal, nowMs),
    lastAccruedAtMs: nowMs,
    continuationCount: goal.continuationCount + ONE,
    idleContinuationsWithoutToolCalls: hadToolCalls ? ZERO : goal.idleContinuationsWithoutToolCalls + ONE,
  };
}

export function canContinueGoal(goal: GoalState | undefined, sessionId: string, featureEnabled: boolean): goal is GoalState {
  return featureEnabled && isGoalActive(goal) && goal.conversationId === sessionId && UUID_REGEX.test(goal.goalId);
}

export interface FormatDurationOptions {
  readonly alwaysShowSeconds?: boolean;
  readonly wholeSeconds?: boolean;
}

function joinDurationParts(parts: readonly (readonly [number, string])[]): string {
  return parts
    .filter(([value], idx) => idx === ZERO || value > ZERO)
    .map(([value, unit]) => `${value}${unit}`)
    .join(' ');
}

export function formatDuration(ms: number | undefined, options: FormatDurationOptions = {}): string | undefined {
  const alwaysShowSeconds = options.alwaysShowSeconds ?? true;
  const wholeSeconds = options.wholeSeconds ?? false;
  if (ms === undefined || !Number.isFinite(ms) || ms < ZERO) {
    return undefined;
  }
  const seconds = wholeSeconds ? Math.ceil(ms / MS_PER_SECOND) : Math.round(ms / MS_PER_SECOND);
  if (ms < MS_PER_SECOND) {
    return wholeSeconds ? `${seconds}s` : `${Math.round(ms)}ms`;
  }
  if (seconds < SECONDS_PER_MINUTE) {
    return wholeSeconds || ms >= TEN_SECONDS_MS ? `${seconds}s` : `${(ms / MS_PER_SECOND).toFixed(DECIMAL_PLACES_ONE)}s`;
  }
  if (seconds < SECONDS_PER_HOUR) {
    return joinDurationParts([
      [Math.floor(seconds / SECONDS_PER_MINUTE), 'm'],
      [seconds % SECONDS_PER_MINUTE, 's'],
    ]);
  }
  if (seconds < SECONDS_PER_DAY) {
    const parts: readonly (readonly [number, string])[] = [
      [Math.floor(seconds / SECONDS_PER_HOUR), 'h'],
      [Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE), 'm'],
      ...(alwaysShowSeconds ? ([[seconds % SECONDS_PER_MINUTE, 's']] as const) : []),
    ];
    return joinDurationParts(parts);
  }
  const parts: readonly (readonly [number, string])[] = [
    [Math.floor(seconds / SECONDS_PER_DAY), 'd'],
    [Math.floor((seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR), 'h'],
    ...(alwaysShowSeconds ? ([[Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE), 'm']] as const) : []),
  ];
  return joinDurationParts(parts);
}

export function formatGoalStatusText(goal: GoalState | undefined, nowMs: number): string | undefined {
  const active = isGoalActive(goal);
  if (!active && !isGoalPaused(goal)) {
    return undefined;
  }
  const effectiveMs = computeEffectiveActiveDurationMs(getActiveDurationMs(goal), active ? goal?.lastAccruedAtMs : undefined, nowMs);
  const formatted = formatDuration(effectiveMs, { wholeSeconds: true }) ?? '0s';
  return `${active ? 'Goal active' : 'Goal paused'} (${formatted})`;
}

export function toPersistedGoalState(goal: GoalState): PersistedGoalState {
  return {
    conversationId: goal.conversationId,
    goalId: goal.goalId,
    objective: goal.objective,
    status: goal.status,
    idleContinuationsWithoutToolCalls: goal.idleContinuationsWithoutToolCalls,
    activeDurationMs: goal.activeDurationMs,
    continuationCount: goal.continuationCount,
    ...(goal.lastAccruedAtMs !== undefined ? { lastAccruedAtMs: goal.lastAccruedAtMs } : {}),
  };
}

export function restoreGoalState(persisted: PersistedGoalState): GoalState {
  return {
    conversationId: persisted.conversationId,
    goalId: persisted.goalId,
    objective: persisted.objective,
    status: persisted.status,
    idleContinuationsWithoutToolCalls: persisted.idleContinuationsWithoutToolCalls,
    activeDurationMs: persisted.activeDurationMs,
    lastAccruedAtMs: persisted.lastAccruedAtMs,
    continuationCount: persisted.continuationCount,
  };
}
