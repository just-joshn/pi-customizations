import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rmdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { durableRecord, routineDefinition, routineRecord } from './routine-client.mjs';
import { webhookBody } from './routine-domain.mjs';
import { readSenderKey } from './routine-secret.mjs';

async function spool(directory, event) {
  const lock = join(directory, 'fallback', '.writer');
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST' || Date.now() >= deadline) throw new Error('Fallback queue is busy. Inspect its writer before resubmitting.');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    if ((await readdir(join(directory, 'fallback'))).filter((name) => name.endsWith('.json')).length >= 128) throw new Error('Routine fallback queue is full.');
    await durableRecord(join(directory, 'fallback', `${event.deliveryId}.json`), event);
  } finally {
    await rmdir(lock);
  }
}

async function forward(directory, status, event, deliveryId) {
  const body = event.body;
  try {
    if (status?.kind !== 'ready' || !status.url) throw new Error('Routine is unavailable.');
    const endpoint = new URL(status.url);
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.pathname !== '/webhook' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
      throw new Error('Invalid local routine endpoint.');
    const key = await readSenderKey(directory);
    const response = await fetch(status.url, {
      method: 'POST',
      headers: { ...event.headers, Authorization: `Bearer ${key}`, 'X-Automation-Key': key, 'X-Pstack-Delivery-Id': deliveryId },
      body,
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

export async function relayEvent(directory, input) {
  const definition = await routineDefinition(directory);
  const body = JSON.stringify(input);
  if (Buffer.byteLength(body) > 65536) throw new Error('Webhook body exceeds 65536 bytes.');
  webhookBody(body, definition.fields);
  const event = { headers: { 'content-type': 'application/json', 'user-agent': 'pi-pstack-ui-relay' }, body_digest: createHash('sha256').update(body).digest('hex'), body, timestamp_ms: Date.now() };
  const deliveryId = randomUUID();
  const status = await routineRecord(join(directory, 'status.json'));
  if (await forward(directory, status, event, deliveryId)) return { accepted: true, spooled: false };
  await spool(directory, { deliveryId, envelope: event });
  return { accepted: false, spooled: true };
}

async function receive(directory, request, response) {
  try {
    if (request.method !== 'POST' || request.url !== '/event') {
      response.writeHead(404);
      return response.end();
    }
    if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) {
      response.writeHead(403);
      return response.end();
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
      response.writeHead(415);
      return response.end();
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 65536) throw new Error('Body too large');
      chunks.push(chunk);
    }
    const result = await relayEvent(directory, JSON.parse(Buffer.concat(chunks).toString('utf8')));
    response.writeHead(result.accepted ? 200 : 202, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(result));
  } catch {
    response.writeHead(400);
    response.end('{"accepted":false}');
  }
}

export async function startRelay(directory, { port, host = '0.0.0.0' }) {
  await routineDefinition(directory);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid relay port.');
  const server = createServer((request, response) => {
    void receive(directory, request, response);
  });
  server.requestTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, port] = process.argv.slice(2);
  if (!directory || !port) throw new Error('Usage: routine-relay.mjs <routine-directory> <port>');
  await startRelay(directory, { port: Number(port) });
}
