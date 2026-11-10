import { decodeFrame, encodeContextFrame, encodeRunFrame, type RunInput } from './wire.ts';

export type NativeSession = {
  write(frame: Buffer): void;
  frames(): AsyncIterable<Buffer>;
  close(): void;
};

const FIRST_BYTE_MS = 120_000;

function wait(ms: number, signal: AbortSignal | undefined): { readonly promise: Promise<'timeout' | 'aborted'>; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const promise = new Promise<'timeout' | 'aborted'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
    timer.unref?.();
    onAbort = () => {
      if (timer) clearTimeout(timer);
      resolve('aborted');
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
  return {
    promise,
    cancel() {
      if (timer) clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
    },
  };
}

export async function readAssistantText(session: NativeSession, input: RunInput, signal?: AbortSignal, deadlineMs = FIRST_BYTE_MS): Promise<string> {
  session.write(encodeRunFrame(input));
  let contextSent = false;
  let text = '';
  const started = Date.now();
  const iterator = session.frames()[Symbol.asyncIterator]();
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Request was aborted', 'AbortError');
      const remaining = deadlineMs - (Date.now() - started);
      if (remaining <= 0) throw new Error('Cursor ask timed out.');
      const incoming = iterator.next().then(
        (value) => ({ kind: 'frame' as const, value }),
        (error: unknown) => ({ kind: 'failed' as const, error }),
      );
      const gate = wait(remaining, signal);
      const winner = await Promise.race([incoming, gate.promise.then((kind) => (kind === 'aborted' ? { kind: 'aborted' as const } : { kind: 'timeout' as const }))]);
      gate.cancel();
      if (winner.kind === 'aborted') throw new DOMException('Request was aborted', 'AbortError');
      if (winner.kind === 'timeout') throw new Error('Cursor ask timed out.');
      if (winner.kind === 'failed') throw winner.error;
      if (winner.value.done) break;
      for (const notice of decodeFrame(winner.value.value)) {
        if (notice.type === 'context' && !contextSent) {
          contextSent = true;
          session.write(encodeContextFrame(notice.execField));
        } else if (notice.type === 'text') text += notice.text;
        else if (notice.type === 'error') throw new Error(notice.message);
        else if (notice.type === 'turn_end') {
          if (text.trim().length === 0) throw new Error('Cursor returned an empty reply.');
          return text;
        }
      }
    }
  } finally {
    session.close();
  }
  if (text.trim().length === 0) throw new Error('Cursor returned an empty reply.');
  return text;
}
