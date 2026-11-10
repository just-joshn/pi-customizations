import { randomUUID } from 'node:crypto';
import http2 from 'node:http2';

import { CURSOR_BASE_URL } from '../catalog.ts';
import type { NativeSession } from './turn.ts';
import { CURSOR_CLIENT_VERSION, FrameBuffer } from './wire.ts';

export class CursorStatusError extends Error {
  readonly status: number;

  constructor(status: number) {
    const message =
      status === 401 || status === 403
        ? `Cursor rejected the session (HTTP ${status}). Run /login and choose Cursor.`
        : status === 429
          ? 'Cursor rejected the ask because usage or credits are exhausted.'
          : `Cursor request failed (HTTP ${status}).`;
    super(message);
    this.name = 'CursorStatusError';
    this.status = status;
  }
}

export class NativeTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NativeTransportError';
  }
}

export type NativeOpenInput = {
  readonly token: string;
  readonly signal: AbortSignal | undefined;
  readonly baseUrl?: string;
};

export type NativeOpener = (input: NativeOpenInput) => Promise<NativeSession>;

export function openCursorRun(input: NativeOpenInput): Promise<NativeSession> {
  const baseUrl = input.baseUrl ?? CURSOR_BASE_URL;
  const client = http2.connect(baseUrl);
  const requestId = randomUUID();
  const req = client.request({
    ':method': 'POST',
    ':path': '/agent.v1.AgentService/Run',
    'content-type': 'application/connect+proto',
    'connect-protocol-version': '1',
    'connect-accept-encoding': 'gzip',
    authorization: `Bearer ${input.token}`,
    'user-agent': 'connect-es/1.6.1',
    'x-cursor-client-type': 'cli',
    'x-cursor-client-version': CURSOR_CLIENT_VERSION,
    'x-cursor-timezone': 'America/Los_Angeles',
    'x-ghost-mode': 'true',
    'x-request-id': requestId,
  });
  const pending: Array<Buffer | null> = [];
  let waiting: ((frame: Buffer | null) => void) | undefined;
  let failed: Error | undefined;
  let closed = false;
  const push = (frame: Buffer | null) => {
    if (waiting) {
      const resolve = waiting;
      waiting = undefined;
      resolve(frame);
      return;
    }
    pending.push(frame);
  };
  const fail = (error: Error) => {
    if (failed) return;
    failed = error;
    push(null);
  };
  const buffer = new FrameBuffer();
  client.on('error', (error) => fail(new NativeTransportError(error.message)));
  req.on('error', (error) => fail(new NativeTransportError(error.message)));
  req.on('response', (headers) => {
    const status = Number(headers[':status'] ?? 0);
    if (status >= 400) fail(new CursorStatusError(status));
  });
  req.on('data', (chunk: Buffer) => {
    for (const frame of buffer.push(chunk)) push(frame);
  });
  req.on('end', () => push(null));
  const onAbort = () => fail(new DOMException('Request was aborted', 'AbortError'));
  if (input.signal?.aborted) onAbort();
  else input.signal?.addEventListener('abort', onAbort, { once: true });

  const session: NativeSession = {
    write(frame) {
      if (!closed) req.write(frame);
    },
    frames() {
      return {
        async *[Symbol.asyncIterator]() {
          while (true) {
            const frame =
              pending.length > 0
                ? pending.shift()
                : await new Promise<Buffer | null>((resolve) => {
                    waiting = resolve;
                  });
            if (frame == null) {
              if (failed) throw failed;
              return;
            }
            yield frame;
          }
        },
      };
    },
    close() {
      if (closed) return;
      closed = true;
      input.signal?.removeEventListener('abort', onAbort);
      push(null);
      req.close();
      client.close();
    },
  };
  return Promise.resolve(session);
}
