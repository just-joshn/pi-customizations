import type { Message } from '@earendil-works/pi-ai';
import { z } from 'zod';
import type { ProcessOutcome } from './run-in-tmux.ts';
import type { SingleResult } from './types.ts';

const AssistantUsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  totalTokens: z.number(),
  cost: z.object({ total: z.number() }),
});

const MessageEndEventSchema = z.object({
  type: z.literal('message_end'),
  message: z.discriminatedUnion('role', [
    z.looseObject({ role: z.literal('user') }),
    z.looseObject({ role: z.literal('toolResult') }),
    z.looseObject({
      role: z.literal('assistant'),
      usage: AssistantUsageSchema,
      model: z.string().optional(),
      stopReason: z.string().optional(),
      errorMessage: z.string().optional(),
    }),
  ]),
});

function safeParseLine(line: string) {
  try {
    return MessageEndEventSchema.safeParse(JSON.parse(line));
  } catch {
    return { success: false as const };
  }
}

/** Parse one JSON-mode stdout line; anything other than a well-formed `message_end` yields undefined. */
export function parseMessageEnd(line: string): Message | undefined {
  if (!line.trim()) return undefined;
  const event = safeParseLine(line);
  // The schema pins the fields this module reads; the rest of the message is passed through to the UI untouched.
  return event.success ? (event.data.message as unknown as Message) : undefined;
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
  if (outcome.signal) return { status: 'failed', errorMessage: errorMessage || `Subagent terminated by signal ${outcome.signal}` };
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
  result(): SingleResult;
  emit(): void;
  onStdoutChunk(chunk: string): void;
  onStderrChunk(chunk: string): void;
  flush(): void;
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
