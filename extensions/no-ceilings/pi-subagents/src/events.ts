import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { BackgroundReason, SubagentFailureCode, SubagentSessionRecord, SubagentStatus } from './types.ts';

/** Hook channels an extension or script can subscribe to with `pi.events.on(channel, handler)`. */
export const SUBAGENT_EVENT_CHANNELS = {
  runStart: 'subagents:run_start',
  status: 'subagents:status',
  toolCall: 'subagents:tool_call',
  checkpoint: 'subagents:checkpoint',
  runEnd: 'subagents:run_end',
  cancelled: 'subagents:cancelled',
  worktree: 'subagents:worktree',
} as const;

export type SubagentEventName = keyof typeof SUBAGENT_EVENT_CHANNELS;

export interface SubagentEventPayload {
  readonly event: SubagentEventName;
  readonly agentId: string;
  readonly parentSessionId: string;
  readonly subagentType: string;
  readonly description: string;
  readonly status: SubagentStatus;
  readonly isBackground: boolean;
  readonly backgroundReason: BackgroundReason;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly toolCallCount: number;
  readonly durationMs?: number;
  readonly error?: string;
  readonly errorCode?: SubagentFailureCode;
  readonly failureId?: string;
  readonly transcriptPath?: string;
  readonly worktreePath?: string;
  readonly branch?: string;
  readonly checkpointSeq?: number;
  readonly toolName?: string;
}

export function buildEventPayload(event: SubagentEventName, record: SubagentSessionRecord, extra?: Partial<SubagentEventPayload>): SubagentEventPayload {
  return {
    event,
    agentId: record.agentId,
    parentSessionId: record.parentSessionId,
    subagentType: record.subagentType,
    description: record.description,
    status: record.status,
    isBackground: record.isBackground ?? false,
    backgroundReason: record.backgroundReason,
    attempt: record.attempts,
    maxAttempts: record.maxAttempts,
    toolCallCount: record.toolCallCount,
    ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
    ...(record.error !== undefined ? { error: record.error } : {}),
    ...(record.errorCode !== undefined ? { errorCode: record.errorCode } : {}),
    ...(record.failureId !== undefined ? { failureId: record.failureId } : {}),
    ...(record.transcriptPath !== undefined ? { transcriptPath: record.transcriptPath } : {}),
    ...(record.worktree !== undefined ? { worktreePath: record.worktree.path, branch: record.worktree.branch } : {}),
    ...extra,
  };
}

export function emitSubagentEvent(pi: ExtensionAPI, event: SubagentEventName, record: SubagentSessionRecord, extra?: Partial<SubagentEventPayload>): void {
  pi.events.emit(SUBAGENT_EVENT_CHANNELS[event], buildEventPayload(event, record, extra));
}
