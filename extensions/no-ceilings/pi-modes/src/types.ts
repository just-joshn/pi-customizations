import { z } from 'zod';

export const MODE_IDS = ['agent', 'plan', 'debug', 'ask'] as const;

export type ModeId = (typeof MODE_IDS)[number];

export const ModeIdSchema = z.enum(MODE_IDS);

export interface ModeSpec {
  readonly label: string;
  readonly description: string;
  readonly readOnly: boolean;
  readonly includeCreatePlan: boolean;
  readonly badgeColor: 'warning' | 'error' | 'success' | undefined;
}

export const MODE_SPECS: Record<ModeId, ModeSpec> = {
  agent: {
    label: 'Agent',
    description: 'Full agent execution with all active tools enabled',
    readOnly: false,
    includeCreatePlan: false,
    badgeColor: undefined,
  },
  plan: {
    label: 'Plan',
    description: 'Read-only exploration and structured planning (no edits)',
    readOnly: true,
    includeCreatePlan: true,
    badgeColor: 'warning',
  },
  debug: {
    label: 'Debug',
    description: 'Hypothesis-driven debugging with live NDJSON runtime ingest server',
    readOnly: false,
    includeCreatePlan: false,
    badgeColor: 'error',
  },
  ask: {
    label: 'Ask',
    description: 'Read-only Q&A for explanations and code exploration (no edits)',
    readOnly: true,
    includeCreatePlan: false,
    badgeColor: 'success',
  },
};

export const STATUS_KEY = 'pi-modes';
export const PLAN_WIDGET_KEY = 'pi-modes-plan';
export const DEBUG_LOGS_WIDGET_KEY = 'pi-modes-debug-logs';
export const ENTRY_CUSTOM_TYPE = 'pi-modes-state';
export const MODE_CONTEXT_CUSTOM_TYPE = 'pi-modes-context';
export const PLAN_EXECUTE_CUSTOM_TYPE = 'pi-modes-plan-execute';
export const PLAN_COMPLETE_CUSTOM_TYPE = 'pi-modes-plan-complete';

export const DEFAULT_MODE: ModeId = 'agent';
export const READ_ONLY_DISABLED_TOOLS = new Set<string>(['edit', 'write']);
export const MODE_TOOL_NAMES = {
  switchMode: 'switch_mode',
  askQuestion: 'ask_question',
  createPlan: 'create_plan',
} as const;

export const ZERO = 0;
export const ONE = 1;
export const TWO = 2;
export const SIX = 6;
export const EIGHT = 8;
export const MAX_PREVIEW_LINES = 5;
export const MAX_TODO_DISPLAY_LEN = 60;
export const TRUNCATE_ELLIPSIS_LEN = 3;

export const PlanTodoSchema = z.object({
  id: z.string().min(ONE),
  content: z.string().min(ONE),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  dependencies: z.array(z.string()).optional(),
});

export type PlanTodo = z.infer<typeof PlanTodoSchema>;

export const PlanPhaseSchema = z.object({
  name: z.string(),
  todos: z.array(PlanTodoSchema),
});

export type PlanPhase = z.infer<typeof PlanPhaseSchema>;

export const CreatePlanInputSchema = z.object({
  plan: z.string().min(ONE),
  name: z.string().optional(),
  overview: z.string().optional(),
  todos: z.array(PlanTodoSchema).optional(),
  is_project: z.boolean().optional(),
  phases: z.array(PlanPhaseSchema).optional(),
});

export type CreatePlanInput = z.infer<typeof CreatePlanInputSchema>;

export const AskQuestionOptionSchema = z.object({
  id: z.string().min(ONE),
  label: z.string().min(ONE),
});

export const AskQuestionItemSchema = z.object({
  id: z.string().min(ONE),
  prompt: z.string().min(ONE),
  options: z.array(AskQuestionOptionSchema).min(ONE),
  allow_multiple: z.boolean().optional(),
});

export const AskQuestionInputSchema = z.object({
  title: z.string().optional(),
  questions: z.array(AskQuestionItemSchema).min(ONE),
});

export type AskQuestionInput = z.infer<typeof AskQuestionInputSchema>;

export const SwitchModeInputSchema = z.object({
  target_mode_id: ModeIdSchema,
  explanation: z.string().optional(),
});

export type SwitchModeInput = z.infer<typeof SwitchModeInputSchema>;

export const CommandArgsSchema = z.string().optional().default('');

export const TrackedPlanStepSchema = z.object({
  step: z.number().int().positive(),
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
});

export type TrackedPlanStep = z.infer<typeof TrackedPlanStepSchema>;

export const PersistedModeStateSchema = z.object({
  mode: ModeIdSchema,
  toolsBeforeRestricted: z.array(z.string()).optional(),
  currentPlanUri: z.string().optional(),
  planExecuting: z.boolean().optional(),
  planSteps: z.array(TrackedPlanStepSchema).optional(),
  lastDebugServerPort: z.number().int().positive().optional(),
});

export type PersistedModeState = z.infer<typeof PersistedModeStateSchema>;

export interface DebugServerConfig {
  readonly serverEndpoint: string;
  readonly logPath: string;
  readonly sessionId: string;
  readonly port: number;
}

export interface ModesRuntimeState {
  readonly mode: ModeId;
  readonly toolsBeforeRestricted: readonly string[] | undefined;
  readonly currentPlanUri: string | undefined;
  readonly pendingPlanSuggestion: boolean;
  readonly planExecuting: boolean;
  readonly planSteps: readonly TrackedPlanStep[];
  readonly lastDebugServerPort: number | undefined;
  readonly debugConfig: DebugServerConfig | undefined;
}
