import type { Message } from '@earendil-works/pi-ai';
import { z } from 'zod';
import type { ProcessOutcome } from './run-in-tmux.ts';
import type { SingleResult } from './types.ts';

/** A line of Pi's JSON mode output as it was read: any JSON value, which parseMessageEnd then reads field by field. */
type JsonLine = { type?: unknown; message: { role?: unknown } };
const JsonLineSchema = z.custom<JsonLine>();
const MESSAGE_ROLES: readonly unknown[] = ['user', 'assistant', 'toolResult'];

/** A message of a user, an assistant, or a tool result, which is the only kind a message_end line carries that matters here. */
const isReadableMessage = (message: JsonLine['message']): message is Message => MESSAGE_ROLES.includes(message.role);

function safeParseLine(line: string) {
  try {
    return JsonLineSchema.safeParse(JSON.parse(line));
  } catch {
    return { success: false as const };
  }
}

/**
 * Parse one JSON-mode stdout line; anything other than a `message_end` of a user, assistant, or tool result yields
 * undefined. The message is returned untouched, with every key and its order, and its fields are read where they are used,
 * so a message without usage fails there, as it always did, and is not dropped here.
 */
export function parseMessageEnd(line: string): Message | undefined {
  if (!line.trim()) return undefined;
  const event = safeParseLine(line);
  if (!event.success || event.data.type !== 'message_end') return undefined;
  const { message } = event.data;
  return isReadableMessage(message) ? message : undefined;
}

export function applyMessage(result: SingleResult, message: Message): SingleResult {
  const withMessage = { ...result, messages: [...result.messages, message] };
  if (message.role !== 'assistant') return withMessage;
  const { usage } = message;
  return {
    ...withMessage,
    usage: {
      turns: result.usage.turns + 1,
      input: result.usage.input + usage.input,
      output: result.usage.output + usage.output,
      cacheRead: result.usage.cacheRead + usage.cacheRead,
      cacheWrite: result.usage.cacheWrite + usage.cacheWrite,
      cost: result.usage.cost + usage.cost.total,
      contextTokens: usage.totalTokens,
    },
    model: result.model || message.model,
    stopReason: message.stopReason,
    errorMessage: message.errorMessage,
  };
}

function resolveOutcome(result: SingleResult, outcome: ProcessOutcome, aborted: boolean): Pick<SingleResult, 'status' | 'errorMessage'> {
  const { errorMessage } = result;
  if (aborted || outcome.signal === 'SIGTERM') return { status: 'aborted', errorMessage: errorMessage || 'Subagent was aborted' };
  if (outcome.spawnError) return { status: 'failed', errorMessage: `Failed to spawn subagent: ${outcome.spawnError.message}` };
  if (outcome.code !== 0) return { status: 'failed', errorMessage: errorMessage || `Subagent exited with code ${outcome.code}` };
  if (result.stopReason === 'aborted') return { status: 'aborted', errorMessage };
  if (result.stopReason === 'error') return { status: 'failed', errorMessage };
  return { status: 'completed', errorMessage };
}

export function finalizeResult(result: SingleResult, outcome: ProcessOutcome, aborted: boolean): SingleResult {
  return {
    ...result,
    exitCode: outcome.code,
    terminationSignal: outcome.signal ?? undefined,
    ...resolveOutcome(result, outcome, aborted),
  };
}

export interface ResultStream {
  result: () => SingleResult;
  emit: () => void;
  onStdoutChunk: (chunk: string) => void;
  onStderrChunk: (chunk: string) => void;
  flush: () => void;
}

/** Accumulates a child's streamed output into successive immutable results, calling `emit` after every change. */
export function createResultStream(initial: SingleResult, emit: (result: SingleResult) => void): ResultStream {
  let current = initial;
  let pending = '';

  const processLine = (line: string): void => {
    const message = parseMessageEnd(line);
    if (!message) return;
    current = applyMessage(current, message);
    emit(current);
  };

  return {
    result: () => current,
    emit: () => emit(current),
    onStdoutChunk: (chunk) => {
      const lines = (pending + chunk).split('\n');
      pending = lines.at(-1) ?? '';
      for (const line of lines.slice(0, -1)) processLine(line);
    },
    onStderrChunk: (chunk) => {
      current = { ...current, stderr: current.stderr + chunk };
    },
    flush: () => processLine(pending),
  };
}
