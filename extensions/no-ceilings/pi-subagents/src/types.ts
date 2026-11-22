import { z } from 'zod';

export const ZERO = 0;
export const ONE = 1;
export const TWO = 2;
export const TWENTY = 20;
export const TWENTY_FIVE = 25;
export const THIRTY = 30;
export const FORTY = 40;
export const MS_PER_SECOND = 1000;
export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3600;
export const SECONDS_PER_DAY = 86400;
/** Default deepest subagent level. Level 1 is a direct child, level 2 a grandchild. */
export const MAX_NESTED_TASK_DEPTH = 2;
export const HARD_MAX_NESTED_TASK_DEPTH = 5;
export const MAX_CHECKPOINTS = 50;
export const MAX_TOOL_TEXT_CHARS = 2000;
export const DEFAULT_AWAIT_TIMEOUT_MS = 30_000;
export const DEFAULT_RETRY_ATTEMPTS = ONE;
export const DEFAULT_RETRY_DELAY_MS = 250;
export const DEFAULT_WORKTREE_BRANCH_PREFIX = 'pi-subagents';
export const MAX_COLLAPSED_THINKING_LINES = 4;
export const MAX_COLLAPSED_STREAMING_LINES = 4;
export const MAX_COLLAPSED_OUTPUT_LINES = 8;
export const MAX_COLLAPSED_OUTPUT_CHARS = 600;
export const MAX_TITLE_CHARS = 80;
export const SHORT_ID_CHARS = 8;
export const MAX_DESCRIPTION_CHARS = 40;
export const WORKTREE_SLUG_CHARS = 24;
export const WORKTREE_SUFFIX_CHARS = 3;

export const SUBAGENTS_ENTRY_CUSTOM_TYPE = 'pi-subagents-state';
export const BACKGROUND_COMPLETION_CUSTOM_TYPE = 'pi-subagents-background-completion';
export const SUBAGENTS_STATUS_KEY = 'pi-subagents-status';
export const SUBAGENTS_WIDGET_KEY = 'pi-subagents-running';
export const SUBAGENTS_CONFIG_FILE_NAME = 'subagents.json';
export const SUBAGENTS_DIR_NAME = 'subagents';

export const SUBAGENT_TOOL_NAMES = {
  task: 'task',
  awaitSubagent: 'await_subagent',
} as const;

export const DEFAULT_TASK_DESCRIPTION = 'Subagent task';
export const DEFAULT_SUBAGENT_TYPE = 'general-purpose';

/**
 * Failure codes are part of the public contract: they appear in tool results, in the tasks
 * pager, and in `subagents:run_end` events. Messages live in one table so a caller can branch
 * on the code instead of matching prose.
 */
export const SUBAGENT_FAILURE_MESSAGES = {
  aborted: 'Subagent was aborted by the user',
  'await-timeout': 'Await timed out while task is still running',
  'await-not-found': 'No background subagent found for id',
  busy: 'Sub-agent is currently running. You may send the follow-up message when it has completed.',
  'empty-prompt': 'Subagent task requires a non-empty prompt.',
  failed: 'Subagent run failed',
  'invalid-id': 'Invalid subagent agent_id format',
  'model-unknown': 'Unknown model',
  'nesting-limit': 'Subagent nesting depth does not allow this run',
  'resume-unavailable': 'Cannot resume subagent: its conversation state is no longer available. Start a new subagent instead.',
  'resume-not-owned': 'Cannot resume subagent: it was not launched by this agent.',
  readonly: 'This operation is not allowed in readonly mode. The subagent was launched with readonly: true, which restricts shell, write, delete, and MCP operations.',
  'type-unknown': 'Unknown subagent_type',
  'worktree-failed': 'Could not create an isolated git worktree for the subagent',
} as const;

export type SubagentFailureCode = keyof typeof SUBAGENT_FAILURE_MESSAGES;

export const SUBAGENT_ABORTED_ERROR = SUBAGENT_FAILURE_MESSAGES.aborted;
export const READONLY_SUBAGENT_ERROR = SUBAGENT_FAILURE_MESSAGES.readonly;

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export const ThinkingLevelSchema = z.enum(THINKING_LEVELS);

export type SubagentThinkingLevel = z.infer<typeof ThinkingLevelSchema>;

export type SubagentPermissionMode = 'default' | 'readonly';

export type SubagentSource = 'builtin' | 'workspace' | 'claude-workspace' | 'codex-workspace' | 'shared-workspace' | 'user' | 'claude-user' | 'codex-user' | 'shared-user' | 'configured';

/** Per-model sampling parameters, copied onto a child model so they apply to every request. */
const SubagentSamplingSchema = z
  .object({
    temperature: z.number().min(ZERO).max(TWO).optional(),
    topP: z.number().min(ZERO).max(ONE).optional(),
    topK: z.number().int().min(ZERO).optional(),
    maxTokens: z.number().int().min(ONE).optional(),
  })
  .strict();

export type SubagentSampling = z.infer<typeof SubagentSamplingSchema>;

export interface SubagentDefinition {
  readonly name: string;
  readonly description: string;
  readonly tools: readonly string[];
  readonly model: string;
  readonly forceDefaultModel: boolean;
  readonly prompt: string;
  readonly permissionMode: SubagentPermissionMode;
  readonly isBackground: boolean | undefined;
  readonly nestedTasks: boolean;
  readonly thinking: SubagentThinkingLevel | undefined;
  readonly sampling: SubagentSampling | undefined;
  readonly contextWindow: number | undefined;
  readonly retryAttempts: number | undefined;
  readonly worktree: boolean;
  readonly mcp: boolean;
  readonly enabled: boolean;
  readonly source: SubagentSource;
  readonly fullPath: string | undefined;
}

export interface NestedScope {
  readonly depth: number;
  readonly maxDepth: number;
  readonly ownerAgentId: string;
  readonly rootSessionId: string;
  readonly agentIds: Set<string>;
}

export type SubagentStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled';

export function isActiveSubagentStatus(status: SubagentStatus): boolean {
  return status === 'pending' || status === 'running';
}

export type BackgroundReason = 'unspecified' | 'agent_request' | 'user_request';

export type TranscriptRole = 'user' | 'assistant' | 'thinking' | 'tool' | 'result';

export interface SubagentTranscriptItem {
  readonly id: string;
  readonly role: TranscriptRole;
  readonly text: string;
  readonly toolName?: string | undefined;
  readonly toolSummary?: string | undefined;
  readonly toolArgs?: string | undefined;
  readonly isError?: boolean | undefined;
  readonly completed: boolean;
  readonly timestamp: number;
}

export interface SubagentCheckpoint {
  readonly seq: number;
  readonly at: number;
  readonly status: SubagentStatus;
  readonly toolCallCount: number;
  readonly transcriptItems: number;
  readonly transcriptPath?: string | undefined;
}

export interface SubagentWorktree {
  readonly repoRoot: string;
  readonly path: string;
  readonly branch: string;
  readonly baseRef: string;
}

export interface SubagentSessionRecord {
  readonly agentId: string;
  readonly parentSessionId: string;
  readonly ownerAgentId?: string | undefined;
  readonly toolCallId: string;
  readonly subagentType: string;
  readonly description: string;
  readonly prompt: string;
  readonly model?: string | undefined;
  readonly thinking?: SubagentThinkingLevel | undefined;
  readonly readonly: boolean;
  readonly status: SubagentStatus;
  readonly isBackground: boolean | undefined;
  readonly backgroundReason: BackgroundReason;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly currentStep?: string | undefined;
  readonly activeToolVerb?: string | undefined;
  readonly activeToolDetail?: string | undefined;
  readonly streamingText?: string | undefined;
  readonly streamingThinking?: string | undefined;
  readonly lastMessage?: string | undefined;
  readonly error?: string | undefined;
  readonly errorCode?: SubagentFailureCode | undefined;
  readonly failureId?: string | undefined;
  readonly toolCallCount: number;
  readonly durationMs?: number | undefined;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly closedAt?: number | undefined;
  readonly transcriptPath?: string | undefined;
  readonly worktree?: SubagentWorktree | undefined;
  readonly worktreeSummary?: string | undefined;
  readonly checkpoints: readonly SubagentCheckpoint[];
  readonly transcriptItems: readonly SubagentTranscriptItem[];
}

export const BackgroundCompletionPayloadSchema = z.object({
  taskId: z.string().min(ONE),
  toolCallId: z.string().optional(),
  kind: z.literal('subagent'),
  status: z.enum(['success', 'error', 'aborted']),
  title: z.string(),
  detail: z.string().optional(),
  outputPath: z.string().optional(),
  failureId: z.string().optional(),
  attempts: z.number().int().min(ONE).optional(),
  worktreePath: z.string().optional(),
  branch: z.string().optional(),
});

export type BackgroundCompletionPayload = z.infer<typeof BackgroundCompletionPayloadSchema>;

export const BackgroundCompletionMessageDetailsSchema = z.object({
  completions: z.array(BackgroundCompletionPayloadSchema),
});

export type BackgroundCompletionMessageDetails = z.infer<typeof BackgroundCompletionMessageDetailsSchema>;

export interface TaskToolDetails {
  readonly agentId: string;
  readonly description: string;
  readonly subagentType: string;
  readonly model?: string;
  readonly thinking?: SubagentThinkingLevel;
  readonly readonly: boolean;
  readonly status: SubagentStatus;
  readonly isBackground: boolean | undefined;
  readonly backgroundReason: BackgroundReason;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly toolCallCount: number;
  readonly checkpoints: number;
  readonly durationMs?: number;
  readonly currentStep?: string;
  readonly activeToolVerb?: string;
  readonly activeToolDetail?: string;
  readonly streamingText?: string;
  readonly streamingThinking?: string;
  readonly transcriptText?: string;
  readonly finalMessage?: string;
  readonly error?: string;
  readonly errorCode?: SubagentFailureCode;
  readonly failureId?: string;
  readonly transcriptPath?: string;
  readonly worktreePath?: string;
  readonly branch?: string;
  readonly worktreeSummary?: string;
}

export interface AwaitSubagentDetails {
  readonly agentId: string;
  readonly outcome: 'complete' | 'still_running' | 'not_found' | 'error';
  readonly toolCallCount?: number;
  readonly status?: SubagentStatus;
  readonly finalMessage?: string;
  readonly transcriptPath?: string;
  readonly error?: string;
  readonly errorCode?: SubagentFailureCode;
  readonly failureId?: string;
}

export const FailureCodeSchema = z.enum(Object.keys(SUBAGENT_FAILURE_MESSAGES) as [SubagentFailureCode, ...SubagentFailureCode[]]);

export const TaskToolInputSchema = z.object({
  description: z.string().min(ONE),
  prompt: z.string().optional().default(''),
  subagent_type: z.string().optional(),
  model: z.string().optional(),
  thinking: ThinkingLevelSchema.optional(),
  readonly: z.boolean().optional(),
  resume: z.string().optional(),
  run_in_background: z.boolean().optional(),
  max_attempts: z.number().int().min(ONE).optional(),
  worktree: z.boolean().optional(),
});

export type TaskToolInput = z.infer<typeof TaskToolInputSchema>;

export const AwaitSubagentInputSchema = z.object({
  agent_id: z.string().min(ONE),
  timeout_ms: z.number().int().min(ZERO).optional(),
});

export const CommandArgsSchema = z.string();

export const PersistedCheckpointSchema = z.object({
  seq: z.number().int().min(ZERO),
  at: z.number(),
  status: z.enum(['pending', 'running', 'success', 'error', 'cancelled']),
  toolCallCount: z.number().int().min(ZERO),
  transcriptItems: z.number().int().min(ZERO),
  transcriptPath: z.string().optional(),
});

export const PersistedWorktreeSchema = z.object({
  repoRoot: z.string().min(ONE),
  path: z.string().min(ONE),
  branch: z.string().min(ONE),
  baseRef: z.string().min(ONE),
});

export const PersistedTranscriptItemSchema = z.object({
  id: z.string().min(ONE),
  role: z.enum(['user', 'assistant', 'thinking', 'tool', 'result']),
  text: z.string(),
  toolName: z.string().optional(),
  toolSummary: z.string().optional(),
  toolArgs: z.string().optional(),
  isError: z.boolean().optional(),
  completed: z.boolean(),
  timestamp: z.number(),
});

export const PersistedSubagentRecordSchema = z.object({
  agentId: z.string().min(ONE),
  parentSessionId: z.string().min(ONE),
  ownerAgentId: z.string().optional(),
  toolCallId: z.string(),
  subagentType: z.string().min(ONE),
  description: z.string(),
  prompt: z.string(),
  model: z.string().optional(),
  thinking: ThinkingLevelSchema.optional(),
  readonly: z.boolean(),
  status: z.enum(['pending', 'running', 'success', 'error', 'cancelled']),
  isBackground: z.boolean(),
  backgroundReason: z.enum(['unspecified', 'agent_request', 'user_request']),
  attempts: z.number().int().min(ONE).optional(),
  maxAttempts: z.number().int().min(ONE).optional(),
  lastMessage: z.string().optional(),
  error: z.string().optional(),
  errorCode: FailureCodeSchema.optional(),
  failureId: z.string().optional(),
  toolCallCount: z.number().int().min(ZERO),
  durationMs: z.number().min(ZERO).optional(),
  startedAt: z.number(),
  updatedAt: z.number(),
  closedAt: z.number().optional(),
  transcriptPath: z.string().optional(),
  worktree: PersistedWorktreeSchema.optional(),
  worktreeSummary: z.string().optional(),
  checkpoints: z.array(PersistedCheckpointSchema).optional(),
  transcriptItems: z.array(PersistedTranscriptItemSchema).optional(),
});

export const PersistedSubagentsStateSchema = z.object({
  sessions: z.array(PersistedSubagentRecordSchema),
});

export type PersistedSubagentRecord = z.infer<typeof PersistedSubagentRecordSchema>;
export type PersistedSubagentsState = z.infer<typeof PersistedSubagentsStateSchema>;
