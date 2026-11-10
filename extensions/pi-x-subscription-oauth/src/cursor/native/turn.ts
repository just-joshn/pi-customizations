import { decodeFrame, encodeContextFrame, encodeRunFrame, type RunInput } from './wire.ts';

export type NativeSession = {
  write(frame: Buffer): void;
  frames(): AsyncIterable<Buffer>;
  close(): void;
};

const QUIET_MS = 1500;
const FIRST_BYTE_MS = 120_000;

function wait(ms: number, signal: AbortSignal | undefined): { readonly promise: Promise<'quiet' | 'aborted'>; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const promise = new Promise<'quiet' | 'aborted'>((resolve) => {
    timer = setTimeout(() => resolve('quiet'), ms);
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

export async function readAssistantText(session: NativeSession, input: RunInput, signal?: AbortSignal): Promise<string> {
  session.write(encodeRunFrame(input));
  let contextSent = false;
  let text = '';
  const iterator = session.frames()[Symbol.asyncIterator]();
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Request was aborted', 'AbortError');
      const next = iterator.next();
      const gate = wait(text.length > 0 ? QUIET_MS : FIRST_BYTE_MS, signal);
      const winner = await Promise.race([next.then((value) => ({ kind: 'frame' as const, value })), gate.promise.then((kind) => ({ kind }))]);
      gate.cancel();
      if (winner.kind === 'aborted') throw new DOMException('Request was aborted', 'AbortError');
      if (winner.kind === 'quiet') break;
      if (winner.kind !== 'frame' || winner.value.done) break;
      for (const notice of decodeFrame(winner.value.value)) {
        if (notice.type === 'context' && !contextSent) {
          contextSent = true;
          session.write(encodeContextFrame());
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
