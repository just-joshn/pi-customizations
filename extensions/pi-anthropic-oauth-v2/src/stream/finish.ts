import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';

type DoneEvent = Extract<AssistantMessageEvent, { type: 'done' }>;
type ErrorEvent = Extract<AssistantMessageEvent, { type: 'error' }>;

export function toDoneEvent(output: AssistantMessage, signal: AbortSignal | undefined): DoneEvent {
  if (signal?.aborted) throw new Error('Request was aborted');
  const reason = output.stopReason;
  if (reason === 'pending') throw new Error('Anthropic stream ended without a stop reason');
  if (reason === 'error' || reason === 'aborted') throw new Error(output.errorMessage || 'An unknown error occurred');
  return { type: 'done', reason, message: output };
}

export function toErrorEvent(output: AssistantMessage, error: unknown, signal: AbortSignal | undefined): ErrorEvent {
  const reason = signal?.aborted ? 'aborted' : 'error';
  const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
  return { type: 'error', reason, error: { ...output, stopReason: reason, errorMessage } };
}
