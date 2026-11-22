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
/** Deepest child depth that may hold task tools (top-level child = 1, so grandchildren never get them). */
export const MAX_NESTED_TASK_DEPTH = 1;
export const DEFAULT_AWAIT_TIMEOUT_MS = 30_000;
export const MAX_COLLAPSED_THINKING_LINES = 4;
export const MAX_COLLAPSED_STREAMING_LINES = 4;
export const MAX_COLLAPSED_OUTPUT_LINES = 8;
export const MAX_COLLAPSED_OUTPUT_CHARS = 600;
export const MAX_TITLE_CHARS = 80;
export const SHORT_ID_CHARS = 8;
export const MAX_DESCRIPTION_CHARS = 40;

export const SUBAGENTS_ENTRY_CUSTOM_TYPE = 'pi-subagents-state';
export const SUBAGENTS_CONTEXT_CUSTOM_TYPE = 'pi-subagents-context';
export const BACKGROUND_COMPLETION_CUSTOM_TYPE = 'pi-subagents-background-completion';
export const SUBAGENTS_STATUS_KEY = 'pi-subagents-status';
export const SUBAGENTS_WIDGET_KEY = 'pi-subagents-running';

export const SUBAGENT_TOOL_NAMES = {
  task: 'task',
  awaitSubagent: 'await_subagent',
} as const;

export const DEFAULT_TASK_DESCRIPTION = 'Subagent task';
export const DEFAULT_SUBAGENT_TYPE = 'general-purpose';
export const SUBAGENT_BUSY_ERROR = 'Sub-agent is currently running. You may send the follow-up message when it has completed.';
export const SUBAGENT_ABORTED_ERROR = 'Subagent was aborted by the user';
export const AWAIT_TIMEOUT_ERROR = 'Await timed out while task is still running';
export const READONLY_SUBAGENT_ERROR = 'This operation is not allowed in readonly mode. The subagent was launched with readonly: true, which restricts shell, write, delete, and MCP operations.';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SubagentPermissionMode = 'default' | 'readonly';

export type SubagentSource = 'builtin' | 'workspace' | 'shared-workspace' | 'user' | 'shared-user';

export interface SubagentDefinition {
  readonly name: string;
  readonly description: string;
  readonly tools: readonly string[];
  readonly model: string;
  readonly forceDefaultModel: boolean;
  readonly prompt: string;
  readonly permissionMode: SubagentPermissionMode;
  readonly isBackground: boolean;
  /** Opt-in (frontmatter `nested-tasks: true`): non-readonly child may launch task/await_subagent one level deeper. */
  readonly nestedTasks: boolean;
  readonly source: SubagentSource;
  readonly fullPath?: string;
}

/** Tracks the runs one nested-capable child launched, so await and cancellation stay inside that child. */
export interface NestedScope {
  readonly depth: number;
  readonly ownerAgentId: string;
  readonly rootSessionId: string;
  readonly agentIds: Set<string>;
}

export type SubagentStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled';

export function isActiveSubagentStatus(status: SubagentStatus): boolean {
  return status === 'pending' || status === 'running';
}

export type BackgroundReason = 'unspecified' | 'agent_request' | 'user_request';

export interface SubagentTranscriptItem {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'thinking' | 'tool';
  readonly text: string;
  readonly toolName?: string;
  readonly toolSummary?: string;
  readonly completed: boolean;
  readonly timestamp: number;
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
  readonly readonly: boolean;
  readonly status: SubagentStatus;
  readonly isBackground: boolean;
  readonly backgroundReason: BackgroundReason;
  readonly currentStep?: string | undefined;
  readonly activeToolVerb?: string | undefined;
  readonly activeToolDetail?: string | undefined;
  readonly streamingText?: string | undefined;
  readonly streamingThinking?: string | undefined;
  readonly lastMessage?: string | undefined;
  readonly error?: string | undefined;
  readonly toolCallCount: number;
  readonly durationMs?: number | undefined;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly closedAt?: number | undefined;
  readonly transcriptPath?: string | undefined;
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
  readonly readonly: boolean;
  readonly status: SubagentStatus;
  readonly isBackground: boolean;
  readonly backgroundReason: BackgroundReason;
  readonly toolCallCount: number;
  readonly durationMs?: number;
  readonly currentStep?: string;
  readonly activeToolVerb?: string;
  readonly activeToolDetail?: string;
  readonly streamingText?: string;
  readonly streamingThinking?: string;
  readonly transcriptText?: string;
  readonly finalMessage?: string;
  readonly error?: string;
  readonly transcriptPath?: string;
}

export interface AwaitSubagentDetails {
  readonly agentId: string;
  readonly outcome: 'complete' | 'still_running' | 'not_found' | 'error';
  readonly toolCallCount?: number;
  readonly finalMessage?: string;
  readonly transcriptPath?: string;
  readonly error?: string;
}

export const TaskToolInputSchema = z.object({
  description: z.string().min(ONE),
  prompt: z.string().optional().default(''),
  subagent_type: z.string().optional(),
  model: z.string().optional(),
  readonly: z.boolean().optional(),
  resume: z.string().optional(),
  run_in_background: z.boolean().optional(),
});

export type TaskToolInput = z.infer<typeof TaskToolInputSchema>;

export const AwaitSubagentInputSchema = z.object({
  agent_id: z.string().min(ONE),
  timeout_ms: z.number().int().min(ZERO).optional(),
});

export type AwaitSubagentInput = z.infer<typeof AwaitSubagentInputSchema>;

export const CommandArgsSchema = z.string();

export const PersistedSubagentRecordSchema = z.object({
  agentId: z.string().min(ONE),
  parentSessionId: z.string().min(ONE),
  ownerAgentId: z.string().optional(),
  toolCallId: z.string(),
  subagentType: z.string().min(ONE),
  description: z.string(),
  prompt: z.string(),
  model: z.string().optional(),
  readonly: z.boolean(),
  status: z.enum(['pending', 'running', 'success', 'error', 'cancelled']),
  isBackground: z.boolean(),
  backgroundReason: z.enum(['unspecified', 'agent_request', 'user_request']),
  lastMessage: z.string().optional(),
  error: z.string().optional(),
  toolCallCount: z.number().int().min(ZERO),
  durationMs: z.number().min(ZERO).optional(),
  startedAt: z.number(),
  updatedAt: z.number(),
  closedAt: z.number().optional(),
  transcriptPath: z.string().optional(),
});

export const PersistedSubagentsStateSchema = z.object({
  sessions: z.array(PersistedSubagentRecordSchema),
});

export type PersistedSubagentRecord = z.infer<typeof PersistedSubagentRecordSchema>;
export type PersistedSubagentsState = z.infer<typeof PersistedSubagentsStateSchema>;
