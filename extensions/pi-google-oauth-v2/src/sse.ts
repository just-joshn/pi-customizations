import type { ReadableStream } from 'node:stream/web';

import { CODE_ASSIST_CHUNK, type CodeAssistChunk } from './stream-reducer.ts';

const SSE_DATA_PREFIX = 'data:';
const SSE_LINE_BREAK = /\r\n|\n|\r/;

interface SseState {
  readonly buffered: string;
  readonly endedWithCR: boolean;
  readonly dataLines: readonly string[];
}

interface SseLines {
  readonly dataLines: readonly string[];
  readonly events: readonly string[];
}

const INITIAL_SSE_STATE: SseState = { buffered: '', endedWithCR: false, dataLines: [] };

function parseEvent(data: string): CodeAssistChunk {
  try {
    return CODE_ASSIST_CHUNK.parse(JSON.parse(data));
  } catch {
    throw new Error('Google Code Assist sent a malformed event');
  }
}

const readSseLine = (acc: SseLines, line: string): SseLines => {
  if (line === '') return acc.dataLines.length > 0 ? { dataLines: [], events: [...acc.events, acc.dataLines.join('\n')] } : acc;
  if (line.startsWith(SSE_DATA_PREFIX)) return { ...acc, dataLines: [...acc.dataLines, line.slice(SSE_DATA_PREFIX.length).replace(/^ /, '')] };
  return acc;
};

/** Splits decoded text into complete SSE lines. The tail stays buffered until its line break arrives. */
function feedSse(state: SseState, decoded: string, done: boolean): { state: SseState; events: readonly string[] } {
  const received = decoded.length > 0;
  const text = received ? state.buffered + (state.endedWithCR && decoded.startsWith('\n') ? decoded.slice(1) : decoded) : state.buffered;
  const lines = text.split(SSE_LINE_BREAK);
  const complete = done ? lines : lines.slice(0, -1);
  const read = complete.reduce<SseLines>(readSseLine, { dataLines: state.dataLines, events: [] });
  const next: SseState = { buffered: done ? '' : (lines.at(-1) ?? ''), endedWithCR: received ? decoded.endsWith('\r') : state.endedWithCR, dataLines: read.dataLines };
  return { state: next, events: read.events };
}

/** Yields each Code Assist chunk as its event completes. Aborting `signal` cancels the read. */
export async function* parseSse(body: ReadableStream<Uint8Array> | null, signal: AbortSignal | undefined): AsyncGenerator<CodeAssistChunk> {
  if (!body) throw new Error('Google Code Assist returned an empty response');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const onAbort = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', onAbort, { once: true });
  let state = INITIAL_SSE_STATE;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      const fed = feedSse(state, decoder.decode(value, { stream: !done }), done);
      state = fed.state;
      for (const data of fed.events) yield parseEvent(data);
      if (done) break;
    }
    if (state.dataLines.length > 0) yield parseEvent(state.dataLines.join('\n'));
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}
