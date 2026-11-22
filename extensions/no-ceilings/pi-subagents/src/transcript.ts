import { randomUUID } from 'node:crypto';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { formatToolActivity } from './formatters.ts';
import { MAX_TOOL_TEXT_CHARS, ONE, type SubagentSessionRecord, type SubagentTranscriptItem, ZERO } from './types.ts';

const THINKING_STEP = 'Thinking…';
const RESPONDING_STEP = 'Responding…';
const WORKING_STEP = 'Working…';
const TOOL_JSON_INDENT = ZERO;

export interface RunProgress {
  readonly toolCallCount: number;
  readonly finalMessage: string | undefined;
}

export interface ReduceResult {
  readonly record: SubagentSessionRecord;
  readonly progress: RunProgress;
  /** True when the event closes a step, which is a natural checkpoint boundary. */
  readonly checkpoint: boolean;
}

function truncateToolText(text: string): string {
  return text.length <= MAX_TOOL_TEXT_CHARS ? text : `${text.slice(ZERO, MAX_TOOL_TEXT_CHARS)}…`;
}

function stringifyArgs(args: unknown): string {
  try {
    return truncateToolText(JSON.stringify(args, undefined, TOOL_JSON_INDENT) ?? '');
  } catch {
    return '';
  }
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((block) => (typeof block === 'object' && block !== null && 'type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string' ? block.text : ''))
    .filter((text) => text.length > ZERO)
    .join('');
}

function messageText(message: AgentMessage): string {
  return 'content' in message ? contentToText(message.content) : '';
}

function toolResultText(result: unknown): string {
  if (typeof result === 'object' && result !== null && 'content' in result) {
    return truncateToolText(contentToText(result.content));
  }
  return '';
}

/** Moves a streamed reasoning block into the transcript once, so history keeps it. */
function flushThinking(record: SubagentSessionRecord, now: number): SubagentSessionRecord {
  const thinking = record.streamingThinking?.trim() ?? '';
  const cleared = { ...record, streamingThinking: undefined };
  return thinking.length > ZERO ? appendItem(cleared, { role: 'thinking', text: thinking, completed: true, timestamp: now }) : cleared;
}

function appendItem(record: SubagentSessionRecord, item: Omit<SubagentTranscriptItem, 'id'> & { readonly id?: string }): SubagentSessionRecord {
  const next: SubagentTranscriptItem = {
    id: item.id ?? randomUUID(),
    role: item.role,
    text: item.text,
    completed: item.completed,
    timestamp: item.timestamp,
    ...(item.toolName !== undefined ? { toolName: item.toolName } : {}),
    ...(item.toolSummary !== undefined ? { toolSummary: item.toolSummary } : {}),
    ...(item.toolArgs !== undefined ? { toolArgs: item.toolArgs } : {}),
    ...(item.isError !== undefined ? { isError: item.isError } : {}),
  };
  return { ...record, transcriptItems: [...record.transcriptItems, next], updatedAt: item.timestamp };
}

/**
 * Projects one child session event onto the run record. Every field the pager and the tool result
 * render comes from here, so a new event only needs one branch.
 */
export function reduceSubagentEvent(record: SubagentSessionRecord, event: AgentSessionEvent, progress: RunProgress, now: number): ReduceResult {
  if (event.type === 'turn_start') {
    return {
      record: { ...record, streamingText: undefined, streamingThinking: undefined, currentStep: RESPONDING_STEP, updatedAt: now },
      progress,
      checkpoint: false,
    };
  }
  if (event.type === 'message_update') {
    const sub = event.assistantMessageEvent;
    if (sub.type === 'text_delta') {
      const streamingText = `${record.streamingText ?? ''}${sub.delta}`;
      return { record: { ...record, status: 'running', streamingText, currentStep: RESPONDING_STEP, updatedAt: now }, progress, checkpoint: false };
    }
    if (sub.type === 'thinking_delta') {
      const streamingThinking = `${record.streamingThinking ?? ''}${sub.delta}`;
      return { record: { ...record, status: 'running', streamingThinking, currentStep: THINKING_STEP, updatedAt: now }, progress, checkpoint: false };
    }
    return { record, progress, checkpoint: false };
  }
  if (event.type === 'message_end') {
    const flushed = flushThinking(record, now);
    const text = messageText(event.message);
    if (event.message.role !== 'assistant' || text.trim().length === ZERO) {
      return { record: flushed, progress, checkpoint: false };
    }
    const withItem = appendItem({ ...flushed, streamingText: undefined }, { role: 'assistant', text, completed: true, timestamp: now });
    return { record: { ...withItem, lastMessage: text }, progress: { ...progress, finalMessage: text }, checkpoint: false };
  }
  if (event.type === 'tool_execution_start') {
    const activity = formatToolActivity(event.toolName, typeof event.args === 'object' && event.args !== null ? event.args : {});
    const withItem = appendItem(
      { ...record, status: 'running', activeToolVerb: activity.verb, activeToolDetail: activity.detail, currentStep: activity.stepLabel, streamingText: undefined, streamingThinking: undefined },
      { id: event.toolCallId, role: 'tool', text: activity.stepLabel, toolName: event.toolName, toolSummary: activity.stepLabel, toolArgs: stringifyArgs(event.args), completed: false, timestamp: now },
    );
    return { record: withItem, progress, checkpoint: false };
  }
  if (event.type === 'tool_execution_end') {
    const toolCallCount = progress.toolCallCount + ONE;
    const resultText = toolResultText(event.result);
    const withEndedTool = {
      ...record,
      toolCallCount,
      activeToolVerb: undefined,
      activeToolDetail: undefined,
      currentStep: WORKING_STEP,
      updatedAt: now,
      transcriptItems: record.transcriptItems.map((item) => (item.id === event.toolCallId ? { ...item, completed: true, ...(event.isError ? { isError: true } : {}) } : item)),
    };
    const withResult = resultText.length > ZERO ? appendItem(withEndedTool, { role: 'result', text: resultText, toolName: event.toolName, isError: event.isError, completed: true, timestamp: now }) : { ...withEndedTool, updatedAt: now };
    return { record: withResult, progress: { ...progress, toolCallCount }, checkpoint: true };
  }
  if (event.type === 'turn_end') {
    return { record: { ...flushThinking(record, now), streamingText: undefined, status: 'running', updatedAt: now }, progress, checkpoint: true };
  }
  return { record, progress, checkpoint: false };
}
