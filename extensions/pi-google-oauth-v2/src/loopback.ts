import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface LoopbackCallback {
  /** Sent to Google as redirect_uri. */
  readonly redirectUri: string;
  /**
   * Resolves with the authorization code once a callback with the matching state arrives.
   * Rejects on a Google error, a missing code, timeout, abort, or close().
   */
  readonly code: Promise<string>;
  /** Idempotent. Releases the port and rejects `code` if still pending. */
  close(): void;
}

/** The listener ended without a verdict from Google or the user, so another sign-in path may still finish. */
export class LoopbackExpiredError extends Error {}

export const LOOPBACK_TIMEOUT_MS = 5 * 60 * 1000;

const CALLBACK_PATH = '/oauth2callback';

function statesMatch(received: string | null, expected: string): boolean {
  if (received === null) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Binds 127.0.0.1 on an OS-assigned port, so there is no probe-then-bind race. Requests that are
 * not this login's callback (other paths, wrong or missing state) get an error response and the
 * server keeps waiting, so a stray request cannot fail the login.
 */
export async function startLoopbackCallback(input: { state: string; signal: AbortSignal }): Promise<LoopbackCallback> {
  let resolve!: (code: string) => void;
  let reject!: (error: Error) => void;
  const code = new Promise<string>((onCode, onError) => {
    resolve = onCode;
    reject = onError;
  });
  code.catch(() => undefined);

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end();
      return;
    }
    if (!statesMatch(url.searchParams.get('state'), input.state)) {
      response.writeHead(400, { 'Content-Type': 'text/plain' }).end('Invalid state');
      return;
    }
    const error = url.searchParams.get('error');
    const authorizationCode = url.searchParams.get('code');
    if (!error && authorizationCode) {
      resolve(authorizationCode);
      response.writeHead(200, { 'Content-Type': 'text/plain' }).end('Signed in. You can close this tab and return to Pi.', close);
      return;
    }
    const description = url.searchParams.get('error_description');
    reject(new Error(error ? `Google sign-in failed: ${error}${description ? `. ${description}` : ''}` : 'Google sign-in returned no authorization code'));
    response.writeHead(400, { 'Content-Type': 'text/plain' }).end('Sign-in failed. Return to Pi.', close);
  });

  const timer = setTimeout(() => {
    reject(new LoopbackExpiredError('Google sign-in timed out'));
    close();
  }, LOOPBACK_TIMEOUT_MS);
  const onAbort = () => {
    reject(new Error('Google sign-in was cancelled'));
    close();
  };
  input.signal.addEventListener('abort', onAbort, { once: true });

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    input.signal.removeEventListener('abort', onAbort);
    reject(new LoopbackExpiredError('Google sign-in listener closed'));
    server.closeAllConnections();
    server.close();
  }

  try {
    await new Promise<void>((onListening, onError) => {
      server.once('error', onError);
      server.listen(0, '127.0.0.1', onListening);
    });
  } catch (error) {
    close();
    throw error;
  }
  const { port } = server.address() as AddressInfo;
  if (input.signal.aborted) onAbort();

  return { redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`, code, close };
}
