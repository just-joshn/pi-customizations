import { computeEffectiveActiveDurationMs, formatDuration, isGoalActive, isGoalPaused } from './state.ts';
import { GOAL_CONTINUATION_CUSTOM_TYPE, type GoalState } from './types.ts';

export function buildGoalContextMessage(goal: GoalState | undefined, nowMs: number): string | undefined {
  if (!isGoalActive(goal) && !isGoalPaused(goal)) {
    return undefined;
  }
  const effectiveMs = computeEffectiveActiveDurationMs(goal.activeDurationMs, isGoalActive(goal) ? goal.lastAccruedAtMs : undefined, nowMs);
  const durationLabel = formatDuration(effectiveMs, { wholeSeconds: true }) ?? '0s';
  const lines = [`[LONG-LIVED GOAL ${goal.status.toUpperCase()}]`, `Objective: ${goal.objective}`, `Status: ${goal.status} | Continuations: ${goal.continuationCount} | Active duration: ${durationLabel}`];
  if (isGoalActive(goal)) {
    return [
      ...lines,
      'You are pursuing a durable goal that continues automatically across turns while active.',
      'Keep making concrete progress, verify your work, and call update_goal with status "complete" when the objective is genuinely finished.',
      'Call update_goal with status "paused" if you are blocked on user input or a decision.',
    ].join('\n');
  }
  return [...lines, 'This goal is currently paused and will not auto-continue until resumed with update_goal({ status: "active" }) or /goal resume.'].join('\n');
}

export function buildGoalContinuationPrompt(goal: GoalState): string {
  return [
    `Continue pursuing the active goal (continuation #${goal.continuationCount}):`,
    `Objective: ${goal.objective}`,
    'Review your progress so far, take the next concrete steps toward completion, verify the result, and call update_goal({ status: "complete" }) once finished (or update_goal({ status: "paused" }) if blocked on the user).',
  ].join('\n');
}

export function buildGoalContinuationMessage(goal: GoalState) {
  return {
    customType: GOAL_CONTINUATION_CUSTOM_TYPE,
    content: buildGoalContinuationPrompt(goal),
    display: true,
    details: { goalId: goal.goalId, objective: goal.objective, continuationCount: goal.continuationCount },
  } as const;
}
