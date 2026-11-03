import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { acceptEvent, createDesired, MAX_PENDING_PER_SUBSCRIPTION, readRegistry } from '../src/subscriptions/durable-store.ts';
import { ensureCredentials, RoutineServer } from '../src/subscriptions/webhook.ts';

test('an offline routine answers 200 for accepted events and 503 with Retry-After when its delivery queue is full', async ({ signal }) => {
  const root = mkdtempSync(join(tmpdir(), 'pstack-webhook-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', join(root, 'agent'));
  const server = new RoutineServer(0);
  try {
    const cwd = join(root, 'workspace');
    createDesired(cwd, { id: 'sub-webhook', name: 'Webhook', createdAt: Date.now(), expiresAt: Date.now() + 60_000, ownerSessionId: 'offline-owner', config: { kind: 'webhook', slug: 'webhook', prompt: 'record it' } });
    const credentialFile = ensureCredentials(join(root, 'routines'), 'webhook');
    const key = (JSON.parse(readFileSync(credentialFile, 'utf8')) as { key: string }).key;
    server.routes.set('webhook', { slug: 'webhook', credentialFile, onEvent: async (event) => acceptEvent(cwd, 'sub-webhook', event.eventId, event.body) });
    const url = await server.url('webhook');
    const post = (index: number) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-automation-key': key }, body: JSON.stringify({ index }), signal });
    const statuses: number[] = [];
    for (let index = 0; index < MAX_PENDING_PER_SUBSCRIPTION; index += 1) {
      const response = await post(index);
      statuses.push(response.status);
      await response.text();
    }
    const refused = await post(MAX_PENDING_PER_SUBSCRIPTION);
    expect(statuses).toEqual(Array.from({ length: MAX_PENDING_PER_SUBSCRIPTION }, () => 200));
    expect([refused.status, refused.headers.get('retry-after')]).toEqual([503, '30']);
    await refused.text();
    expect(readRegistry(cwd).pending.map((event) => event.id)).toHaveLength(MAX_PENDING_PER_SUBSCRIPTION);
  } finally {
    server.close();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
