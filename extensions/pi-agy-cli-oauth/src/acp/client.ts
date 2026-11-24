/** NDJSON JSON-RPC over one spawned `agy acp --stdio` process. Resolves once the child is spawned, not after `initialize`. Callers parse each method payload. */
import { spawn, type ChildProcess } from 'node:child_process';
import { type Readable, type Writable } from 'node:stream';
import { z } from 'zod';
import { type AcpError, type AcpId } from './protocol.ts';
const STDERR_TAIL_BYTES = 8_192;
const CLOSE_GRACE_MS = 2_000;
const KILL_GRACE_MS = 2_000;
const METHOD_NOT_FOUND = -32_601;
const INTERNAL_ERROR = -32_603;
const JSON_RPC = '2.0';
export interface AcpClientOptions {
  command: string;
  args: readonly string[];
  env: Record<string, string>;
  cwd: string;
  /** Forwarded each stderr line, for diagnostics only. Must never throw. */
  onStderr?: (line: string) => void;
}
export interface AcpRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
/** Return the result payload, or a value with an `error` key to answer with a JSON-RPC error. */
export type ServerRequestHandler = (method: string, params: unknown) => Promise<unknown>;
export interface AcpClient {
  request<T>(method: string, params: unknown, options?: AcpRequestOptions): Promise<T>;
  notify(method: string, params: unknown): void;
  /** Server-to-client requests such as `session/request_permission`. One handler at a time. */
  setServerRequestHandler(handler: ServerRequestHandler | undefined): void;
  /** Every server-to-client notification, such as `session/update`. Returns an unsubscribe function. */
  onNotification(handler: (method: string, params: unknown) => void): () => void;
  /** Last 8 KiB of stderr, for error messages. */
  readonly stderrTail: string;
  readonly alive: boolean;
  close(): void;
}
/** A JSON-RPC error from the CLI. `code` and `message` are the CLI's own. */
export class AcpTransportError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(error: AcpError) {
    super(error.message);
    this.name = 'AcpTransportError';
    this.code = error.code;
    this.data = error.data;
  }
}
type NotifyHandler = (method: string, params: unknown) => void;
/** One phase, so closed and alive cannot disagree. */
type Phase = 'starting' | 'open' | 'closing' | 'closed';
type PendingCall = { readonly resolve: (value: unknown) => void; readonly reject: (error: Error) => void; readonly timer: NodeJS.Timeout | undefined; readonly signal: AbortSignal | undefined; readonly onAbort: (() => void) | undefined };
type ExitStatus = { readonly code: number | null; readonly signal: NodeJS.Signals | null };
type TransportState = {
  readonly pending: ReadonlyMap<AcpId, PendingCall>;
  readonly listeners: ReadonlySet<NotifyHandler>;
  readonly handler: ServerRequestHandler | undefined;
  readonly phase: Phase;
  readonly exitStatus: ExitStatus | undefined;
  readonly nextId: number;
  readonly tail: string;
  readonly stdoutPartial: string;
  readonly stderrPartial: string;
  readonly termTimer: NodeJS.Timeout | undefined;
  readonly killTimer: NodeJS.Timeout | undefined;
};
type Incoming =
  | { readonly type: 'server-request'; readonly id: AcpId; readonly method: string; readonly params: unknown }
  | { readonly type: 'notification'; readonly method: string; readonly params: unknown }
  | { readonly type: 'response'; readonly id: AcpId; readonly error: AcpError | undefined; readonly result: unknown }
  | { readonly type: 'ignore' };
const idSchema = z.union([z.number(), z.string()]);
const acpErrorSchema = z.object({ code: z.number(), message: z.string(), data: z.unknown().optional() });
const envelopeSchema = z.object({ id: idSchema.optional(), method: z.string().optional(), params: z.unknown().optional(), result: z.unknown().optional(), error: z.unknown().optional() });
export function connectAcp(options: AcpClientOptions): Promise<AcpClient> {
  const child = spawnChild(options);
  const transport = createTransport(child);
  wireStreams(child, transport, options.onStderr);
  return openWhenSpawned(child, transport);
}
function spawnChild(options: AcpClientOptions): ChildProcess {
  return spawn(options.command, [...options.args], { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], detached: false });
}
function createTransport(child: ChildProcess) {
  // Property writes are forbidden, so the session is one value and each update replaces that binding.
  let state: TransportState = { pending: new Map(), listeners: new Set(), handler: undefined, phase: 'starting', exitStatus: undefined, nextId: 0, tail: '', stdoutPartial: '', stderrPartial: '', termTimer: undefined, killTimer: undefined };
  const replace = (next: TransportState) => {
    state = next;
  };
  return {
    child,
    read: () => state,
    replace,
    takeId: () => {
      const nextId = state.nextId + 1;
      replace({ ...state, nextId });
      return nextId;
    },
  };
}
type Transport = ReturnType<typeof createTransport>;
type Envelope = NonNullable<ReturnType<typeof parseEnvelope>>;
function openWhenSpawned(child: ChildProcess, transport: Transport): Promise<AcpClient> {
  const client = createClient(transport);
  return new Promise((resolve, reject) => {
    child.on('spawn', () => {
      if (transport.read().phase !== 'starting') return;
      transport.replace({ ...transport.read(), phase: 'open' });
      resolve(client);
    });
    child.on('error', (error: Error) => onChildError(transport, error, reject));
    child.on('exit', (code, signal) => onChildExit(transport, code, signal, reject));
  });
}
function onChildError(transport: Transport, error: Error, reject: (reason: Error) => void): void {
  if (transport.read().phase !== 'starting') {
    failPending(transport, streamFailure(transport, error));
    return;
  }
  transport.replace({ ...transport.read(), phase: 'closed' });
  reject(error);
}
function onChildExit(transport: Transport, code: number | null, signal: NodeJS.Signals | null, reject: (reason: Error) => void): void {
  const starting = transport.read().phase === 'starting';
  finishExit(transport, code, signal);
  if (starting) reject(new Error(exitText(transport)));
}
function createClient(transport: Transport): AcpClient {
  return {
    request: (method, params, options) => request(transport, method, params, options),
    notify: (method, params) => notify(transport, method, params),
    setServerRequestHandler: (handler) => transport.replace({ ...transport.read(), handler }),
    onNotification: (handler) => subscribe(transport, handler),
    get stderrTail() {
      return transport.read().tail;
    },
    get alive() {
      const phase = transport.read().phase;
      return phase === 'open' || phase === 'closing';
    },
    close: () => closeTransport(transport),
  };
}
// `T` is the caller's schema. The bytes are only known to be JSON here.
function request<T>(transport: Transport, method: string, params: unknown, options?: AcpRequestOptions): Promise<T> {
  return call(transport, method, params, options) as Promise<T>;
}
function call(transport: Transport, method: string, params: unknown, options: AcpRequestOptions | undefined): Promise<unknown> {
  const failure = unavailable(transport);
  if (failure !== undefined) return Promise.reject(failure);
  const signal = options?.signal;
  if (signal?.aborted === true) {
    const reason: unknown = signal.reason;
    return Promise.reject(reason instanceof Error ? reason : new Error('The operation was aborted'));
  }
  const id = transport.takeId();
  return new Promise((resolve, reject) => {
    transport.replace({ ...transport.read(), pending: new Map([...transport.read().pending, [id, arm(transport, id, resolve, reject, options)]]) });
    const body = params === undefined ? { jsonrpc: JSON_RPC, id, method } : { jsonrpc: JSON_RPC, id, method, params };
    try {
      writeMessage(transport, body);
    } catch (error: unknown) {
      settle(transport, id, (pending) => pending.reject(error instanceof Error ? error : new Error('ACP stream failed')));
    }
  });
}
function unavailable(transport: Transport): Error | undefined {
  const stdin = transport.child.stdin;
  if (transport.read().phase === 'open' && stdin !== null && !stdin.destroyed && stdin.writable) return undefined;
  return new Error(exitText(transport));
}
function arm(transport: Transport, id: AcpId, resolve: (value: unknown) => void, reject: (error: Error) => void, options: AcpRequestOptions | undefined): PendingCall {
  const signal = options?.signal;
  const onAbort =
    signal === undefined
      ? undefined
      : () => {
          const reason: unknown = signal.reason;
          settle(transport, id, (pending) => pending.reject(reason instanceof Error ? reason : new Error('The operation was aborted')));
        };
  if (signal !== undefined && onAbort !== undefined) signal.addEventListener('abort', onAbort, { once: true });
  const timeoutMs = options?.timeoutMs;
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => settle(transport, id, (pending) => pending.reject(new Error(`ACP request timed out after ${String(timeoutMs)}ms`))), timeoutMs);
  return { resolve, reject, timer, signal, onAbort };
}
function notify(transport: Transport, method: string, params: unknown): void {
  const message = params === undefined ? { jsonrpc: JSON_RPC, method } : { jsonrpc: JSON_RPC, method, params };
  try {
    writeMessage(transport, message);
  } catch {
    /* A payload that cannot be encoded must not take down the process. */
  }
}
function subscribe(transport: Transport, handler: NotifyHandler): () => void {
  transport.replace({ ...transport.read(), listeners: new Set([...transport.read().listeners, handler]) });
  return () => transport.replace({ ...transport.read(), listeners: new Set([...transport.read().listeners].filter((item) => item !== handler)) });
}
function closeTransport(transport: Transport): void {
  const phase = transport.read().phase;
  if (phase === 'closing' || phase === 'closed') return;
  transport.replace({ ...transport.read(), phase: 'closing' });
  withStdin(transport.child, (stdin) => stdin.end());
  transport.replace({ ...transport.read(), termTimer: setTimeout(() => signalChild(transport.child, 'SIGTERM'), CLOSE_GRACE_MS) });
  transport.replace({ ...transport.read(), killTimer: setTimeout(() => signalChild(transport.child, 'SIGKILL'), CLOSE_GRACE_MS + KILL_GRACE_MS) });
}
function finishExit(transport: Transport, code: number | null, signal: NodeJS.Signals | null): void {
  const state = transport.read();
  if (state.phase === 'closed') return;
  clearTimer(state.termTimer);
  clearTimer(state.killTimer);
  transport.replace({ ...state, exitStatus: { code, signal }, phase: 'closed', termTimer: undefined, killTimer: undefined });
  failPending(transport, new Error(exitText(transport)));
}
function failPending(transport: Transport, error: Error): void {
  const pending = transport.read().pending;
  transport.replace({ ...transport.read(), pending: new Map() });
  for (const pendingCall of pending.values()) {
    disarm(pendingCall);
    pendingCall.reject(error);
  }
}
function settle(transport: Transport, id: AcpId, finish: (pendingCall: PendingCall) => void): void {
  const state = transport.read();
  const pendingCall = state.pending.get(id);
  if (pendingCall === undefined) return;
  transport.replace({ ...state, pending: new Map([...state.pending].filter(([key]) => key !== id)) });
  disarm(pendingCall);
  finish(pendingCall);
}
function disarm(pendingCall: PendingCall): void {
  if (pendingCall.timer !== undefined) clearTimeout(pendingCall.timer);
  if (pendingCall.signal !== undefined && pendingCall.onAbort !== undefined) pendingCall.signal.removeEventListener('abort', pendingCall.onAbort);
}
function wireStreams(child: ChildProcess, transport: Transport, onStderr: ((line: string) => void) | undefined): void {
  listenText(
    child.stdout,
    (chunk) => onStdoutChunk(transport, chunk),
    (error) => failPending(transport, streamFailure(transport, error)),
  );
  listenText(
    child.stderr,
    (chunk) => onStderrChunk(transport, chunk, onStderr),
    (error) => failPending(transport, streamFailure(transport, error)),
  );
  listenError(child.stdin, (error) => failPending(transport, streamFailure(transport, error)));
}
function listenText(stream: Readable | null, onChunk: (chunk: string) => void, onError: (error: Error) => void): void {
  if (stream === null) return;
  stream.setEncoding('utf8');
  stream.on('data', (chunk: unknown) => onChunk(typeof chunk === 'string' ? chunk : chunk instanceof Buffer ? chunk.toString('utf8') : ''));
  stream.on('error', (error: unknown) => onError(error instanceof Error ? error : new Error('ACP stream failed')));
}
function listenError(stream: Writable | null, onError: (error: Error) => void): void {
  if (stream === null) return;
  stream.on('error', (error: unknown) => onError(error instanceof Error ? error : new Error('ACP stream failed')));
}
function onStdoutChunk(transport: Transport, chunk: string): void {
  const consumed = consumeChunks(transport.read().stdoutPartial, chunk);
  transport.replace({ ...transport.read(), stdoutPartial: consumed.pending });
  for (const line of consumed.lines) acceptLine(transport, line);
}
function onStderrChunk(transport: Transport, chunk: string, onStderr: ((line: string) => void) | undefined): void {
  const state = transport.read();
  const nextTail = state.tail + chunk;
  const consumed = consumeChunks(state.stderrPartial, chunk);
  transport.replace({ ...state, tail: nextTail.length <= STDERR_TAIL_BYTES ? nextTail : nextTail.slice(-STDERR_TAIL_BYTES), stderrPartial: consumed.pending });
  for (const line of consumed.lines) emitStderr(onStderr, line);
}
function acceptLine(transport: Transport, line: string): void {
  const envelope = line.trim() === '' ? undefined : parseEnvelope(line.trim());
  if (envelope !== undefined) dispatch(transport, envelope);
}
function dispatch(transport: Transport, envelope: Envelope): void {
  const incoming = classify(envelope);
  switch (incoming.type) {
    case 'server-request':
      onServerRequest(transport, incoming.id, incoming.method, incoming.params);
      return;
    case 'notification':
      onNotification(transport, incoming.method, incoming.params);
      return;
    case 'response':
      onResponse(transport, incoming.id, incoming.error, incoming.result);
      return;
    case 'ignore':
      return;
  }
}
function onServerRequest(transport: Transport, id: AcpId, method: string, params: unknown): void {
  const handler = transport.read().handler;
  if (handler === undefined) {
    writeMessage(transport, { jsonrpc: JSON_RPC, id, error: { code: METHOD_NOT_FOUND, message: `Method not found: ${method}` } });
    return;
  }
  void answer(transport, id, handler, method, params);
}
async function answer(transport: Transport, id: AcpId, handler: ServerRequestHandler, method: string, params: unknown): Promise<void> {
  try {
    const value = await handler(method, params);
    const failure = asHandlerError(value);
    if (failure !== undefined) {
      writeMessage(transport, { jsonrpc: JSON_RPC, id, error: failure });
      return;
    }
    writeMessage(transport, { jsonrpc: JSON_RPC, id, result: value ?? null });
  } catch (error: unknown) {
    writeMessage(transport, { jsonrpc: JSON_RPC, id, error: { code: INTERNAL_ERROR, message: error instanceof Error ? error.message : 'Server request handler failed' } });
  }
}
function onNotification(transport: Transport, method: string, params: unknown): void {
  for (const listener of transport.read().listeners) emitNotification(listener, method, params);
}
function onResponse(transport: Transport, id: AcpId, error: AcpError | undefined, result: unknown): void {
  settle(transport, id, (pendingCall) => {
    if (error !== undefined) {
      pendingCall.reject(new AcpTransportError(error));
      return;
    }
    pendingCall.resolve(result);
  });
}
function emitNotification(listener: NotifyHandler, method: string, params: unknown): void {
  try {
    listener(method, params);
  } catch {
    /* One subscriber must not stall the read loop for the others. */
  }
}
function emitStderr(onStderr: ((line: string) => void) | undefined, line: string): void {
  if (onStderr === undefined) return;
  try {
    onStderr(line);
  } catch {
    /* Diagnostics must not break the session. */
  }
}
function parseEnvelope(line: string) {
  try {
    const parsed = envelopeSchema.safeParse(JSON.parse(line));
    if (!parsed.success) return undefined;
    return { id: parsed.data.id, method: parsed.data.method, params: parsed.data.params, result: parsed.data.result, error: parsed.data.error };
  } catch {
    // A banner or a torn line is not fatal. The next line can still be a message.
    return undefined;
  }
}
function classify(envelope: Envelope): Incoming {
  if (envelope.method !== undefined && envelope.id !== undefined) return { type: 'server-request', id: envelope.id, method: envelope.method, params: envelope.params };
  if (envelope.method !== undefined) return { type: 'notification', method: envelope.method, params: envelope.params };
  const failure = envelope.error === undefined ? undefined : (acpErrorFrom(envelope.error) ?? { code: INTERNAL_ERROR, message: 'Malformed JSON-RPC error' });
  if (envelope.id !== undefined) return { type: 'response', id: envelope.id, error: failure, result: envelope.result };
  return { type: 'ignore' };
}
function asHandlerError(value: unknown): AcpError | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('error' in value)) return undefined;
  return acpErrorFrom(value.error) ?? { code: INTERNAL_ERROR, message: 'Handler returned an invalid error' };
}
function acpErrorFrom(value: unknown): AcpError | undefined {
  const parsed = acpErrorSchema.safeParse(value);
  if (!parsed.success) return undefined;
  if (parsed.data.data === undefined) return { code: parsed.data.code, message: parsed.data.message };
  return { code: parsed.data.code, message: parsed.data.message, data: parsed.data.data };
}
function writeMessage(transport: Transport, message: unknown): void {
  withStdin(transport.child, (stdin) => stdin.write(`${JSON.stringify(message)}\n`));
}
function withStdin(child: ChildProcess, use: (stdin: NonNullable<ChildProcess['stdin']>) => void): void {
  const stdin = child.stdin;
  if (stdin === null || stdin.destroyed || !stdin.writable) return;
  try {
    use(stdin);
  } catch {
    /* The pipe can close between the writable check and the call. */
  }
}
function signalChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill(signal);
  } catch {
    /* The process can exit between the status check and the signal. */
  }
}
function exitText(transport: Transport): string {
  const status = transport.read().exitStatus;
  const code = status === undefined ? 'unknown' : String(status.code);
  return `agy exited with code ${code} signal ${status?.signal ?? 'none'}: ${transport.read().tail}`;
}
function streamFailure(transport: Transport, error: Error): Error {
  return new Error(`${error.message}; ${exitText(transport)}`);
}
function consumeChunks(current: string, chunk: string): { readonly pending: string; readonly lines: readonly string[] } {
  const parts = `${current}${chunk}`.split(/\r?\n/);
  return { pending: parts.at(-1) ?? '', lines: parts.slice(0, -1) };
}
function clearTimer(timer: NodeJS.Timeout | undefined): void {
  if (timer !== undefined) clearTimeout(timer);
}
