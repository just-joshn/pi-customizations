import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import { HTTP_OK } from './constants.ts';

const encoder = new TextEncoder();

export const encode = (text: string): Uint8Array => encoder.encode(text);

/** One server-sent event carrying a Code Assist chunk. */
export const frame = (chunk: object): string => `data: ${JSON.stringify(chunk)}\n\n`;

/** A chunk whose candidate holds `parts`, optionally with a finish reason. */
export const part = (parts: object[], extra: object = {}) => ({ response: { candidates: [{ content: { role: 'model', parts }, ...extra }] }, traceId: 'trace-1' });

export const stopChunk = (parts: object[] = [{ text: 'ok' }]) => part(parts, { finishReason: 'STOP' });

export const sseResponse = (text: string, init: ResponseInit = {}): Response => new Response(text, { status: HTTP_OK, headers: { 'Content-Type': 'text/event-stream' }, ...init });

export const sse = (...chunks: object[]): Response => sseResponse(chunks.map(frame).join(''));

/** A body that sends its chunks and then stays open, so only an abort can end the stream. */
export function openBody(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
    },
  });
}

/** A body that sends its chunks as separate network reads and then ends. */
export function closedBody(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/** A body that produces its one chunk only when the reader asks for it. */
export function pulledBody(onPull: () => void, chunk: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        onPull();
        controller.enqueue(chunk);
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
}

export async function collect(stream: AsyncIterable<AssistantMessageEvent>): Promise<AssistantMessageEvent[]> {
  let events: readonly AssistantMessageEvent[] = [];
  for await (const event of stream) events = [...events, event];
  return [...events];
}

/** Collects every event and aborts the request as soon as one of the given type arrives. */
export async function collectAbortingOn(stream: AsyncIterable<AssistantMessageEvent>, controller: AbortController, trigger: AssistantMessageEvent['type']): Promise<AssistantMessageEvent[]> {
  let events: readonly AssistantMessageEvent[] = [];
  try {
    for await (const event of stream) {
      events = [...events, event];
      if (event.type === trigger) controller.abort();
    }
  } finally {
    controller.abort();
  }
  return [...events];
}

export const types = (events: AssistantMessageEvent[]) => events.map((event) => event.type);

export const terminal = (events: AssistantMessageEvent[]) => events.filter((event) => event.type === 'done' || event.type === 'error');

export const message = (event: AssistantMessageEvent | undefined): AssistantMessage => {
  if (event?.type === 'done') return event.message;
  if (event?.type === 'error') return event.error;
  throw new Error('not a terminal event');
};
