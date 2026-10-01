import type { AgentSessionEvent, AgentSessionEventListener } from '@earendil-works/pi-coding-agent';
import type { TaskRecord } from '../worker-records.ts';
import { lastMeteredTokens } from './completion-notice.ts';
import { forwardTextFlag, type FrameBody, type SdkEvents } from './sdk-events.ts';

export type FrameStatus = 'completed' | 'failed' | 'stopped';

export function frameStatus(status: Exclude<TaskRecord['status'], 'running'>): FrameStatus {
  switch (status) {
    case 'settled':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'interrupted':
      return 'stopped';
  }
}

export function updatedBody(taskId: string, patch: Readonly<Record<string, unknown>>): FrameBody {
  return { type: 'system', subtype: 'task_updated', task_id: taskId, patch };
}

export function notificationBody(details: unknown): FrameBody {
  return { ...(typeof details === 'object' && details !== null ? details : {}), type: 'system', subtype: 'task_notification' };
}

export function startedBody(record: TaskRecord, prompt: string, background: boolean): FrameBody {
  return {
    type: 'system',
    subtype: 'task_started',
    task_id: record.id,
    ...(record.toolUseId ? { tool_use_id: record.toolUseId } : {}),
    description: record.description ?? record.persona,
    subagent_type: record.persona,
    is_backgrounded: background,
    spawn_depth: record.depth ?? 1,
    task_type: 'local_agent',
    prompt,
    skip_transcript: false,
    ambient: false,
  };
}

type Progress = Readonly<{ tokens: number; toolUses: number; lastTool: string | undefined }>;

function advance(progress: Progress, event: AgentSessionEvent): Progress {
  if (event.type === 'tool_execution_end' && event.parentToolCallId === undefined) return { ...progress, toolUses: progress.toolUses + 1, lastTool: event.toolName };
  if (event.type === 'message_end' && event.message.role === 'assistant') return { ...progress, tokens: lastMeteredTokens([event.message]) ?? progress.tokens };
  return progress;
}

function progressBody(record: TaskRecord, progress: Progress, startedAt: number): FrameBody {
  return {
    type: 'system',
    subtype: 'task_progress',
    task_id: record.id,
    ...(record.toolUseId ? { tool_use_id: record.toolUseId } : {}),
    description: record.description ?? record.persona,
    subagent_type: record.persona,
    usage: { total_tokens: progress.tokens, tool_uses: progress.toolUses, duration_ms: Date.now() - startedAt },
    ...(progress.lastTool ? { last_tool_name: progress.lastTool } : {}),
  };
}

function forwardedBody(parentToolUseId: string | undefined, event: AgentSessionEvent): FrameBody | undefined {
  if (event.type !== 'message_end') return undefined;
  const { message } = event;
  if (message.role !== 'assistant' && message.role !== 'user') return undefined;
  const blocks = typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content;
  const content = blocks.flatMap((block) => (block.type === 'text' || block.type === 'thinking' ? [block] : []));
  if (!content.length) return undefined;
  return { type: message.role, parent_tool_use_id: parentToolUseId ?? null, message: { role: message.role, content } };
}

/** One listener per child run: emits task_progress after each tool and, when enabled, the child's text and thinking. */
export function taskFeed(frames: SdkEvents, record: TaskRecord, live: () => boolean): AgentSessionEventListener {
  const startedAt = Date.now();
  let progress: Progress = { tokens: 0, toolUses: 0, lastTool: undefined };
  return (event) => {
    if (!live()) return;
    const next = advance(progress, event);
    if (event.type === 'tool_execution_end' && next !== progress) frames.emit(progressBody(record, next, startedAt));
    progress = next;
    const forwarded = frames.flag(forwardTextFlag) ? forwardedBody(record.toolUseId, event) : undefined;
    if (forwarded) frames.emit(forwarded);
  };
}
