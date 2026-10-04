import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { durableRecord, prepareRoutine } from '../scripts/routine-client.mjs';
import { relayEvent, startRelay } from '../scripts/routine-relay.mjs';
import { expectDefined } from './support/expect-defined.ts';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pstack-routine-relay-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const draft = await prepareRoutine(root, { name: 'relay', prompt: 'Ignore action probe.', fields: ['action'] });
  const key = 'fixture-relay-key-with-32-characters';
  await writeFile(join(draft.directory, 'secrets/sender-key'), key, { mode: 0o600 });
  return { ...draft, key };
}

async function receiver(code: number) {
  const requests: { headers: IncomingHttpHeaders; body: string }[] = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
    response.writeHead(code, { Location: 'http://127.0.0.1:1/webhook' });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Receiver address missing.');
  return { requests, url: `http://127.0.0.1:${address.port}/webhook` };
}

test('the server relay sends both auth headers once and exposes only the acceptance receipt', async () => {
  const draft = await fixture();
  const endpoint = await receiver(200);
  await durableRecord(join(draft.directory, 'status.json'), { kind: 'ready', url: endpoint.url });
  const result = await relayEvent(draft.directory, { action: 'probe' });
  expect(result).toEqual({ accepted: true, spooled: false });
  expect(endpoint.requests).toHaveLength(1);
  expect(endpoint.requests[0]).toMatchObject({ headers: { authorization: `Bearer ${draft.key}`, 'x-automation-key': draft.key, 'content-type': 'application/json' }, body: '{"action":"probe"}' });
  expect(JSON.stringify(result)).not.toContain(draft.key);
});

test('a redirect is never followed and spools the original delivery ID', async () => {
  const draft = await fixture();
  const endpoint = await receiver(302);
  await durableRecord(join(draft.directory, 'status.json'), { kind: 'ready', url: endpoint.url });
  expect(await relayEvent(draft.directory, { action: 'probe' })).toEqual({ accepted: false, spooled: true });
  expect(endpoint.requests).toHaveLength(1);
  const deliveryId = expectDefined(endpoint.requests[0]).headers['x-pstack-delivery-id'];
  expect(JSON.parse(await readFile(join(draft.directory, 'fallback', `${deliveryId}.json`), 'utf8'))).toMatchObject({ deliveryId, envelope: { body: '{"action":"probe"}' } });
});

test('fallback bounds reject overflow without overwriting the accepted queue', async () => {
  const draft = await fixture();
  await Promise.all(Array.from({ length: 128 }, (_, index) => writeFile(join(draft.directory, 'fallback', `${index}.json`), '{}')));
  await expect(relayEvent(draft.directory, { action: 'probe' })).rejects.toThrow('fallback queue is full');
  expect(await readdir(join(draft.directory, 'fallback'))).toHaveLength(128);
});

test('the browser endpoint rejects cross-origin requests and never sends a key to the browser', async () => {
  const draft = await fixture();
  const server = await startRelay(draft.directory, { host: '127.0.0.1', port: 0 });
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Relay address missing.');
  const url = `http://127.0.0.1:${address.port}/event`;
  expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://outside.invalid' }, body: '{"action":"probe"}' })).status).toBe(403);
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"probe"}' });
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ accepted: false, spooled: true });
});
