import { z } from 'zod';

export const ZERO = 0;
export const ONE = 1;
export const DEFAULT_MAX_IDLE_CONTINUATIONS = 3;
export const TICK_INTERVAL_MS = 1000;
export const MS_PER_SECOND = 1000;
export const TEN_SECONDS_MS = 10_000;
export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3600;
export const SECONDS_PER_DAY = 86_400;
export const DECIMAL_PLACES_ONE = 1;
export const DECIMAL_RADIX = 10;

export const GOAL_STATE_ENTRY_TYPE = 'pi-goals:state';
export const GOAL_CONTINUATION_CUSTOM_TYPE = 'pi-goals:continuation';
export const GOAL_CONTEXT_CUSTOM_TYPE = 'pi-goals:context';
export const GOAL_STATUS_KEY = 'pi-goals';
export const GOAL_WIDGET_KEY = 'pi-goals-status';

export const GOAL_TOOL_NAMES = {
  createGoal: 'create_goal',
  updateGoal: 'update_goal',
} as const;

export const GOAL_STATUSES = ['active', 'paused', 'complete', 'cleared'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GoalStatusSchema = z.enum(GOAL_STATUSES);

export interface GoalState {
  readonly conversationId: string;
  readonly goalId: string;
  readonly objective: string;
  readonly status: GoalStatus;
  readonly idleContinuationsWithoutToolCalls: number;
  readonly activeDurationMs: number;
  readonly lastAccruedAtMs: number | undefined;
  readonly continuationCount: number;
}

export const PersistedGoalStateSchema = z.object({
  conversationId: z.string().min(ONE),
  goalId: z.string().min(ONE),
  objective: z.string().min(ONE),
  status: GoalStatusSchema,
  idleContinuationsWithoutToolCalls: z.number().int().min(ZERO),
  activeDurationMs: z.number().min(ZERO),
  lastAccruedAtMs: z.number().min(ZERO).optional(),
  continuationCount: z.number().int().min(ZERO),
});

export type PersistedGoalState = z.infer<typeof PersistedGoalStateSchema>;

export const CreateGoalArgsSchema = z.object({
  objective: z.string().trim().min(ONE, 'Goal objective must be non-empty'),
});

export const UpdateGoalArgsSchema = z.object({
  status: GoalStatusSchema,
});

export const GoalCommandArgsSchema = z.string();

export type GoalToolKind = 'create' | 'update';
export type GoalToolOutcome = 'success' | 'error' | 'cancelled';

export interface GoalToolDetails {
  readonly kind: GoalToolKind;
  readonly outcome: GoalToolOutcome;
  readonly objective?: string;
  readonly status?: GoalStatus;
  readonly goalId?: string;
  readonly error?: string;
}
