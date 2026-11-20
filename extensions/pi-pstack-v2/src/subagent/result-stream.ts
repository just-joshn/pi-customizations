import type { Message } from '@earendil-works/pi-ai';
import { z } from 'zod';
import type { ProcessOutcome } from './run-in-tmux.ts';
import type { SingleResult } from './types.ts';

/** A `message_end` line of Pi's JSON mode output whose message is of a user, an assistant, or a tool result. Other keys stay as they were read. */
const JsonLineSchema = z.looseObject({ type: z.literal('message_end'), message: z.looseObject({ role: z.enum(['user', 'assistant', 'toolResult']) }) });

type ReadableMessage = z.infer<typeof JsonLineSchema>['message'];

/** The schema has checked the role, which is all that was ever checked of a message, so the rest is read where it is used. */
const isMessage = (_message: ReadableMessage): _message is ReadableMessage & Message => true;

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
  if (!event.success) return undefined;
  const { message } = event.data;
  return isMessage(message) ? message : undefined;
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

export const MAX_TURNS_STOP_REASON = 'max_turns';

/** A child that was stopped for reaching its turn limit finished its work as far as the limit allows, so it is not a failure. */
export function finalizeResult(result: SingleResult, outcome: ProcessOutcome, aborted: boolean, hitMaxTurns = false): SingleResult {
  if (hitMaxTurns && !aborted) {
    return { ...result, exitCode: outcome.code, terminationSignal: outcome.signal ?? undefined, status: 'completed', stopReason: MAX_TURNS_STOP_REASON, errorMessage: undefined };
  }
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
  /** True once the child has taken `maxTurns` assistant turns and `onMaxTurns` has been called. */
  hitMaxTurns: () => boolean;
}

export interface TurnLimit {
  maxTurns: number | undefined;
  onMaxTurns: () => void;
}

/** A turn that ended in a tool call or with no stop reason is followed by another, so the limit cuts the child short there. */
const CONTINUING_STOP_REASONS: readonly (string | undefined)[] = [undefined, 'toolUse'];

/** Accumulates a child's streamed output into successive immutable results, calling `emit` after every change. */
export function createResultStream(initial: SingleResult, emit: (result: SingleResult) => void, limit?: TurnLimit): ResultStream {
  let current = initial;
  let pending = '';
  let hitMaxTurns = false;

  const enforceLimit = (): void => {
    if (hitMaxTurns || limit?.maxTurns === undefined) return;
    if (current.usage.turns < limit.maxTurns || !CONTINUING_STOP_REASONS.includes(current.stopReason)) return;
    hitMaxTurns = true;
    limit.onMaxTurns();
  };

  const processLine = (line: string): void => {
    const message = parseMessageEnd(line);
    if (!message) return;
    current = applyMessage(current, message);
    emit(current);
    enforceLimit();
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
    hitMaxTurns: () => hitMaxTurns,
  };
}
