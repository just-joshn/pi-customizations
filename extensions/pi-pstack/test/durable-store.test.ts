import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest';
import {
  acquireSupervisorLock,
  claimDelivery,
  createDesired,
  dropExpired,
  ensureDurableDirs,
  isSupervisorLive,
  readDelivery,
  readRegistry,
  releaseSupervisorLock,
  removeDesired,
  supervisorLockPath,
  upsertDesired,
  writeRegistry,
} from '../src/subscriptions/durable-store.ts';
import type { DurableSubscription } from '../src/subscriptions/durable-types.ts';
import { durableRegistryPath } from '../src/paths.ts';

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);

const timer = (over: Partial<DurableSubscription> = {}): DurableSubscription => ({
  id: 'sub-aaaa',
  name: 'nudge',
  createdAt: NOW,
  expiresAt: NOW + 7 * 24 * 3_600_000,
  config: { kind: 'timer', prompt: 'check', delaySeconds: 15, once: true, strategy: 'new_session' },
  detachedDelivery: 'spawn',
  ...over,
});

describe('durable store', () => {
  let cwd: string;
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), 'pstack-durable-'));
    cwd = join(agentDir, 'workspace');
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
    onTestFinished(() => {
      vi.unstubAllEnvs();
      rmSync(agentDir, { recursive: true, force: true });
    });
  });

  test('writeRegistry is atomic and readable', () => {
    const sub = timer();
    writeRegistry(cwd, { version: 1, workspaceCwd: cwd, subscriptions: [sub] });
    const path = durableRegistryPath(cwd);
    expect(statSync(path).isFile()).toBe(true);
    expect(readRegistry(cwd)).toEqual({ version: 1, workspaceCwd: cwd, subscriptions: [sub] });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ version: 1, subscriptions: [{ id: 'sub-aaaa', name: 'nudge' }] });
  });

  test('createDesired upserts once; same name returns created:false without rewrite', () => {
    const first = createDesired(cwd, timer());
    expect(first).toEqual({ created: true });
    const before = readFileSync(durableRegistryPath(cwd));
    const again = createDesired(cwd, timer({ id: 'sub-bbbb', config: { kind: 'timer', prompt: 'other', delaySeconds: 1, once: false, strategy: 'wake_self' } }));
    expect(again).toEqual({ created: false });
    expect(readFileSync(durableRegistryPath(cwd))).toEqual(before);
    expect(readRegistry(cwd).subscriptions).toHaveLength(1);
    expect(readRegistry(cwd).subscriptions[0]?.config).toMatchObject({ prompt: 'check' });
  });

  test('upsertDesired replaces by id and drops a colliding name', () => {
    createDesired(cwd, timer());
    upsertDesired(cwd, timer({ id: 'sub-aaaa', config: { kind: 'timer', prompt: 'updated', delaySeconds: 15, once: true, strategy: 'new_session' } }));
    expect(readRegistry(cwd).subscriptions).toEqual([
      expect.objectContaining({ id: 'sub-aaaa', config: expect.objectContaining({ prompt: 'updated' }) }),
    ]);
  });

  test('removeDesired drops by id', () => {
    createDesired(cwd, timer());
    createDesired(cwd, timer({ id: 'sub-bbbb', name: 'other' }));
    removeDesired(cwd, 'sub-aaaa');
    expect(readRegistry(cwd).subscriptions.map((sub) => sub.id)).toEqual(['sub-bbbb']);
  });

  test('dropExpired removes past expiresAt', () => {
    const kept = timer({ id: 'sub-keep', name: 'keep', expiresAt: NOW + 60_000 });
    const gone = timer({ id: 'sub-gone', name: 'gone', expiresAt: NOW - 1 });
    const next = dropExpired({ version: 1, workspaceCwd: cwd, subscriptions: [kept, gone] }, NOW);
    expect(next.subscriptions.map((sub) => sub.id)).toEqual(['sub-keep']);
  });

  test('claimDelivery is idempotent for the same claim key', () => {
    const first = claimDelivery(cwd, 'sub-aaaa', 'sub-aaaa:once', 1_500);
    expect(first.claimed).toBe(true);
    expect(readDelivery(cwd, 'sub-aaaa')).toMatchObject({ lastClaimKey: 'sub-aaaa:once', lastClaimAt: 1_500 });
    const again = claimDelivery(cwd, 'sub-aaaa', 'sub-aaaa:once', 1_600);
    expect(again.claimed).toBe(false);
    expect(again.ledger.lastClaimAt).toBe(1_500);
  });

  test('a new claim key replaces the ledger', () => {
    claimDelivery(cwd, 'sub-aaaa', 'sub-aaaa:0', 1_000);
    const next = claimDelivery(cwd, 'sub-aaaa', 'sub-aaaa:1', 2_000);
    expect(next.claimed).toBe(true);
    expect(readDelivery(cwd, 'sub-aaaa')).toMatchObject({ lastClaimKey: 'sub-aaaa:1', lastClaimAt: 2_000 });
  });

  test('acquireSupervisorLock is idempotent while the pid lives', () => {
    const first = acquireSupervisorLock(cwd, process.pid, 10);
    expect(first).toEqual({ acquired: true });
    expect(isSupervisorLive(cwd)).toBe(true);
    const second = acquireSupervisorLock(cwd, process.pid + 1, 20);
    expect(second).toEqual({ acquired: false, alreadyRunning: true, pid: process.pid });
    releaseSupervisorLock(cwd, process.pid);
    expect(isSupervisorLive(cwd)).toBe(false);
  });

  test('a stale lock (dead pid) is taken over', () => {
    ensureDurableDirs(cwd);
    writeFileSync(supervisorLockPath(cwd), `${JSON.stringify({ pid: 2_147_483_647, startedAt: 1 })}\n`);
    expect(isSupervisorLive(cwd)).toBe(false);
    expect(acquireSupervisorLock(cwd, process.pid, 30)).toEqual({ acquired: true });
    releaseSupervisorLock(cwd);
  });
});
