import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface LoopbackCallback {
  readonly redirectUri: string;
  readonly code: Promise<string>;
  close(): void;
}

const LOOPBACK_TIMEOUT_MINUTES = 5;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const LOOPBACK_TIMEOUT_MS = LOOPBACK_TIMEOUT_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;

const CALLBACK_PATH = '/oauth2callback';
const ROOT_PATH = '/';
const LOOPBACK_HOST = '127.0.0.1';
const LOOPBACK_ORIGIN = 'http://127.0.0.1';
const EPHEMERAL_PORT = 0;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const PLAIN_TEXT = { 'Content-Type': 'text/plain' };

interface Outcome {
  resolve(code: string): void;
  reject(error: Error): void;
}

function statesMatch(received: string | null, expected: string): boolean {
  if (received === null) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function handleRequest(request: IncomingMessage, response: ServerResponse, state: string, outcome: Outcome, close: () => void): void {
  const url = new URL(request.url ?? ROOT_PATH, LOOPBACK_ORIGIN);
  if (url.pathname !== CALLBACK_PATH) {
    response.writeHead(HTTP_NOT_FOUND).end();
    return;
  }
  if (!statesMatch(url.searchParams.get('state'), state)) {
    response.writeHead(HTTP_BAD_REQUEST, PLAIN_TEXT).end('Invalid state');
    return;
  }
  const error = url.searchParams.get('error');
  const authorizationCode = url.searchParams.get('code');
  if (!error && authorizationCode) {
    outcome.resolve(authorizationCode);
    response.writeHead(HTTP_OK, PLAIN_TEXT).end('Signed in. You can close this tab and return to Pi.', close);
    return;
  }
  const description = url.searchParams.get('error_description');
  outcome.reject(new Error(error ? `Google sign-in failed: ${error}${description ? `. ${description}` : ''}` : 'Google sign-in returned no authorization code'));
  response.writeHead(HTTP_BAD_REQUEST, PLAIN_TEXT).end('Sign-in failed. Return to Pi.', close);
}

function listen(server: Server): Promise<void> {
  return new Promise<void>((onListening, onError) => {
    server.once('error', onError);
    server.listen(EPHEMERAL_PORT, LOOPBACK_HOST, onListening);
  });
}

export async function startLoopbackCallback(input: { state: string; signal: AbortSignal }): Promise<LoopbackCallback> {
  const outcome = Promise.withResolvers<string>();
  outcome.promise.catch(() => undefined);
  const server = createServer((request, response) => handleRequest(request, response, input.state, outcome, close));

  // On timeout the listener closes and `code` stays pending, so a pasted code can still finish the login.
  const timer = setTimeout(close, LOOPBACK_TIMEOUT_MS);
  const onAbort = () => {
    outcome.reject(new Error('Google sign-in was cancelled'));
    close();
  };
  input.signal.addEventListener('abort', onAbort, { once: true });

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    input.signal.removeEventListener('abort', onAbort);
    server.closeAllConnections();
    server.close();
  }

  await listen(server).catch((error: unknown) => {
    close();
    throw error;
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    close();
    throw new Error('Google sign-in listener did not bind to a port');
  }
  const { port } = address;
  if (input.signal.aborted) onAbort();

  return { redirectUri: `${LOOPBACK_ORIGIN}:${port}${CALLBACK_PATH}`, code: outcome.promise, close };
}
