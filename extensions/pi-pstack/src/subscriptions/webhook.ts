import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

export const DEFAULT_ROUTINES_PORT = 47913;
export const MAX_BODY_BYTES = 64 * 1024;
const HOST = '127.0.0.1';
const KEY = /^[0-9a-f]{64}$/;

export function routineSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug === '') throw new Error(`Routine name "${name}" has no letters or digits to make a slug from.`);
  return slug.slice(0, 64).replace(/-+$/, '');
}

export function credentialFile(routinesDir: string, slug: string): string {
  return join(routinesDir, slug, 'credentials.json');
}

function readKey(file: string): string | undefined {
  try {
    const key = (JSON.parse(readFileSync(file, 'utf8')) as { key?: unknown } | null)?.key;
    return typeof key === 'string' && KEY.test(key) ? key : undefined;
  } catch {
    return undefined;
  }
}

const errno = (error: unknown) => (typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined);
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** The routine's sender key file, created with a fresh key unless a valid one is already there. Returns the path only. */
export function ensureCredentials(routinesDir: string, slug: string): string {
  const file = credentialFile(routinesDir, slug);
  mkdirSync(join(routinesDir, slug), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const key = readKey(file);
    if (key !== undefined) {
      chmodSync(file, 0o600);
      return file;
    }
    if (!existsSync(file)) {
      try {
        writeFileSync(file, `${JSON.stringify({ key: randomBytes(32).toString('hex') })}\n`, { flag: 'wx', mode: 0o600 });
        chmodSync(file, 0o600);
        return file;
      } catch (error) {
        if (errno(error) !== 'EEXIST') throw error;
      }
    }
    if (attempt < 4) pause(5);
  }
  if (readKey(file) !== undefined) {
    chmodSync(file, 0o600);
    return file;
  }
  writeFileSync(file, `${JSON.stringify({ key: randomBytes(32).toString('hex') })}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

const digest = (text: string) => createHash('sha256').update(text).digest();

/** Constant-time: both sides are hashed first, so length differences do not leak either. */
export function keyMatches(presented: string | undefined, expected: string | undefined): boolean {
  if (presented === undefined || expected === undefined) return false;
  return timingSafeEqual(digest(presented), digest(expected));
}

function presentedKey(request: IncomingMessage): string | undefined {
  const header = request.headers['x-automation-key'];
  if (typeof header === 'string' && header !== '') return header.trim();
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.authorization ?? '');
  return bearer?.[1];
}

export interface WebhookEvent {
  headers: Record<string, string>;
  bodyDigest: string;
  body: string;
  timestampMs: number;
}

/** JSON whose `<` is escaped, so a body cannot close the surrounding tag; it still parses to the same value. */
const tagSafeJson = (value: unknown) => JSON.stringify(value, null, 2).replace(/</g, '\\u003c');

export function webhookEventBlock(event: WebhookEvent): string {
  return ['<webhook_event>', tagSafeJson({ headers: event.headers, body_digest: event.bodyDigest, body: event.body, timestamp_ms: event.timestampMs }), '</webhook_event>'].join('\n');
}

export interface RoutineRoute {
  slug: string;
  credentialFile: string;
  onEvent: (event: WebhookEvent) => void;
}

const reply = (response: ServerResponse, status: number, message: string) => {
  response.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
  response.end(`${JSON.stringify(status === 200 ? { ok: true } : { error: message })}\n`);
};

/** One local listener for every routine of this process. Routes are looked up per request, so they can change while it runs. */
export class RoutineServer {
  private server: Server | undefined;
  private listening: Promise<number> | undefined;
  readonly routes = new Map<string, RoutineRoute>();
  private readonly port: number;

  constructor(port: number) {
    this.port = port;
  }

  /** Starts the listener once and resolves to its port. */
  start(): Promise<number> {
    this.listening ??= new Promise<number>((resolve, reject) => {
      const server = createServer((request, response) => this.handle(request, response));
      server.once('error', (error: NodeJS.ErrnoException) => {
        this.listening = undefined;
        this.server = undefined;
        reject(new Error(error.code === 'EADDRINUSE' ? `Port ${this.port} on ${HOST} is in use (another Pi process may own the routines listener). Set PSTACK_ROUTINES_PORT to a free port.` : `Routines listener failed: ${error.message}`));
      });
      server.listen(this.port, HOST, () => {
        server.unref();
        resolve((server.address() as AddressInfo).port);
      });
      this.server = server;
    });
    return this.listening;
  }

  async url(slug: string): Promise<string> {
    return `http://${HOST}:${await this.start()}/routines/${slug}`;
  }

  isListening(): boolean {
    return this.server?.listening === true;
  }

  close(): void {
    this.server?.close();
    this.server?.closeAllConnections();
    this.server = undefined;
    this.listening = undefined;
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const slug = /^\/routines\/([a-z0-9-]+)\/?$/.exec(new URL(request.url ?? '/', 'http://localhost').pathname)?.[1];
    const route = slug === undefined ? undefined : this.routes.get(slug);
    if (route === undefined) {
      reply(response, 404, 'No such routine.');
      return;
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST');
      reply(response, 405, 'Use POST.');
      return;
    }
    if (!keyMatches(presentedKey(request), readKey(route.credentialFile))) {
      reply(response, 401, 'Wrong or missing sender key.');
      return;
    }
    if (Number(request.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
      reply(response, 413, `Body over ${MAX_BODY_BYTES} bytes.`);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    request.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        response.writeHead(413, { 'content-type': 'application/json', connection: 'close' });
        response.write(`${JSON.stringify({ error: `Body over ${MAX_BODY_BYTES} bytes.` })}\n`);
        request.once('end', () => response.end());
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (done) return;
      done = true;
      const raw = Buffer.concat(chunks);
      const body = raw.toString('utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = undefined;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return reply(response, 400, 'Body must be a JSON object.');
      const headers: Record<string, string> = {};
      for (const name of ['content-type', 'user-agent'] as const) {
        const header = request.headers[name];
        if (typeof header === 'string') headers[name] = header;
      }
      route.onEvent({ headers, bodyDigest: createHash('sha256').update(raw).digest('hex'), body, timestampMs: Date.now() });
      reply(response, 200, 'ok');
    });
  }
}
