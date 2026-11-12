import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { readCredential } from './credentials.ts';

export const MAX_BODY_BYTES = 64 * 1024;
const HOST = '127.0.0.1';
const PATH = '/events';

const digest = (text: string) => createHash('sha256').update(text).digest();

/** Constant time: both sides are hashed first, so a length difference leaks nothing either. */
export function secretMatches(presented: string | undefined, expected: string | undefined): boolean {
  if (presented === undefined || expected === undefined) return false;
  return timingSafeEqual(digest(presented), digest(expected));
}

const bearer = (request: IncomingMessage) => /^Bearer\s+(\S+)\s*$/i.exec(request.headers.authorization ?? '')?.[1];

export interface WebhookReply {
  status: number;
  body: Record<string, unknown>;
}

export interface WebhookReceiver {
  url: string;
  close(): Promise<void>;
}

/**
 * Accepts `POST /events` on 127.0.0.1 with `Authorization: Bearer <key>`, where key is the `key` field of the 0600
 * credential file, read per request so rotation needs no restart. Bodies must be JSON objects within `maxBodyBytes`.
 */
export function startWebhookReceiver(options: { credentialFile: string; onEvent: (body: Record<string, unknown>) => Promise<WebhookReply>; port?: number; maxBodyBytes?: number }): Promise<WebhookReceiver> {
  const limit = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const send = (response: ServerResponse, reply: WebhookReply) => {
    response.writeHead(reply.status, { 'content-type': 'application/json', connection: 'close' });
    response.end(`${JSON.stringify(reply.body)}\n`);
  };
  const handle = (request: IncomingMessage, response: ServerResponse) => {
    if (new URL(request.url ?? '/', 'http://localhost').pathname !== PATH) return send(response, { status: 404, body: { error: 'not found' } });
    if (request.method !== 'POST') return send(response, { status: 405, body: { error: 'use POST' } });
    const secret = readCredential(options.credentialFile, 'key');
    if (!secretMatches(bearer(request), secret.ok ? secret.value : undefined)) return send(response, { status: 401, body: { error: 'unauthorized' } });
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) over = true;
      else chunks.push(chunk);
    });
    request.on('end', async () => {
      if (over) return send(response, { status: 413, body: { error: `body over ${limit} bytes` } });
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {}
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return send(response, { status: 400, body: { error: 'body must be a JSON object' } });
      try {
        send(response, await options.onEvent(parsed as Record<string, unknown>));
      } catch {
        send(response, { status: 503, body: { error: 'not durably accepted; retry later' } });
      }
    });
  };
  return new Promise((resolve, reject) => {
    const server = createServer(handle);
    server.once('error', reject);
    server.listen(options.port ?? 0, HOST, () => {
      server.removeListener('error', reject);
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://${HOST}:${port}${PATH}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
