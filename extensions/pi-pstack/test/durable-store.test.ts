import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { expect, test, vi } from 'vitest';
import { durableRegistryPath, durableRuntimeDir } from '../src/paths.ts';
import {
  acceptEvent,
  acquireLease,
  acquireSupervisorLock,
  cancelDesired,
  canonicalPath,
  createDesired,
  deliverOwner,
  finishFresh,
  isSupervisorLive,
  ownerLockPath,
  readRegistry,
  releaseSupervisorLock,
  startFresh,
  supervisorLockPath,
  visibleSubscriptions,
} from '../src/subscriptions/durable-store.ts';
import type { DurableSubscription } from '../src/subscriptions/durable-types.ts';

const run = promisify(execFile);
const fixture = join(import.meta.dirname, 'fixtures/subscription-writer.mts');
const local = test.extend<{ cwd: string }>({
  cwd: async ({ signal }, use) => {
    signal.throwIfAborted();
    const dir = mkdtempSync(join(tmpdir(), 'pstack-durable-'));
    vi.stubEnv('PI_CODING_AGENT_DIR', dir);
    try {
      await use(canonicalPath(join(dir, 'workspace')));
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  },
});
const timer = (over: Partial<DurableSubscription> = {}): DurableSubscription => ({
  id: 'sub-aaaa',
  name: 'nudge',
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000,
  ownerSessionId: 'owner',
  config: { kind: 'timer', prompt: 'check', delaySeconds: 15, once: true, strategy: 'wake_self' },
  ...over,
});

local('same-name creation preserves configuration and ownership without rewriting', ({ cwd }) => {
  const first = createDesired(cwd, timer());
  const before = readFileSync(durableRegistryPath(cwd));
  const again = createDesired(cwd, timer({ id: 'sub-bbbb', ownerSessionId: 'peer' }));
  expect(first.created).toBe(true);
  expect(again).toEqual({ created: false, subscription: first.subscription });
  expect(readFileSync(durableRegistryPath(cwd))).toEqual(before);
  expect(statSync(durableRegistryPath(cwd)).mode & 0o777).toBe(0o600);
});

local('refuses another workspace whose path collides in the storage folder name', ({ cwd }) => {
  const first = join(cwd, 'a-b');
  const other = join(cwd, 'a', 'b');
  createDesired(first, timer());
  expect(durableRegistryPath(first)).toBe(durableRegistryPath(other));
  expect(() => readRegistry(other)).toThrow('different workspace');
  expect(() => cancelDesired(other, 'nudge')).toThrow('different workspace');
  expect(readRegistry(first).subscriptions[0]?.lifecycle).toBe('active');
});

local('once acceptance commits completion and pending delivery together', ({ cwd }) => {
  createDesired(cwd, timer());
  expect(acceptEvent(cwd, 'sub-aaaa', 'sub-aaaa:once', 'check')).toBe('accepted');
  expect(readRegistry(cwd)).toMatchObject({ subscriptions: [{ lifecycle: 'completed' }], pending: [{ id: 'sub-aaaa:once', content: 'check' }] });
  expect(acceptEvent(cwd, 'sub-aaaa', 'sub-aaaa:once', 'check')).toBe('inactive');
  const received: string[] = [];
  deliverOwner(
    cwd,
    'owner',
    () => true,
    (_sub, event) => {
      received.push(event.content);
    },
  );
  deliverOwner(
    cwd,
    'owner',
    () => true,
    (_sub, event) => {
      received.push(event.content);
    },
  );
  expect(received).toEqual(['check']);
  expect(readRegistry(cwd).pending).toEqual([]);
  expect(visibleSubscriptions(readRegistry(cwd))).toEqual([]);
});

local('peer and missing owner identities cannot drain another session backlog', ({ cwd }) => {
  createDesired(cwd, timer());
  acceptEvent(cwd, 'sub-aaaa', 'one', 'private');
  const received: string[] = [];
  for (const id of ['peer', ''])
    deliverOwner(
      cwd,
      id,
      () => true,
      (_sub, event) => {
        received.push(event.content);
      },
    );
  expect(received).toEqual([]);
  expect(readRegistry(cwd).pending).toHaveLength(1);
  deliverOwner(
    cwd,
    'owner',
    () => false,
    () => {
      throw new Error('obsolete lifecycle');
    },
  );
  expect(readRegistry(cwd).pending).toHaveLength(1);
});

local('failed native enqueue retains the accepted event for retry', ({ cwd }) => {
  createDesired(cwd, timer());
  acceptEvent(cwd, 'sub-aaaa', 'one', 'check');
  expect(() =>
    deliverOwner(
      cwd,
      'owner',
      () => true,
      () => {
        throw new Error('enqueue failed');
      },
    ),
  ).toThrow('enqueue failed');
  expect(readRegistry(cwd).pending).toMatchObject([{ id: 'one' }]);
});

local('cancelling completed-once backlog removes pending delivery and retains its identity', ({ cwd }) => {
  createDesired(cwd, timer());
  acceptEvent(cwd, 'sub-aaaa', 'one', 'check');
  expect(cancelDesired(cwd, 'nudge')).toMatchObject({ id: 'sub-aaaa', lifecycle: 'cancelled' });
  expect(readRegistry(cwd).pending).toEqual([]);
  expect(acceptEvent(cwd, 'sub-aaaa', 'late', 'check')).toBe('inactive');
  const next = createDesired(cwd, timer({ id: 'sub-bbbb' }));
  expect(next.created).toBe(true);
  expect(readRegistry(cwd).subscriptions.map((sub) => sub.lifecycle)).toEqual(['cancelled', 'active']);
});

local('expired subscriptions keep accepted deliveries but reject later fires', ({ cwd }) => {
  const sub = timer();
  createDesired(cwd, sub);
  acceptEvent(cwd, sub.id, 'one', 'accepted', sub.createdAt + 1);
  expect(acceptEvent(cwd, sub.id, 'two', 'late', sub.expiresAt + 1)).toBe('inactive');
  const received: string[] = [];
  deliverOwner(
    cwd,
    'owner',
    () => true,
    (_sub, event) => {
      received.push(event.content);
    },
  );
  expect(received).toEqual(['accepted']);
});

local('slug collisions are rejected workspace-wide', ({ cwd }) => {
  createDesired(cwd, timer({ name: 'Bot UI', config: { kind: 'webhook', slug: 'bot-ui', prompt: 'p' } }));
  expect(() => createDesired(cwd, timer({ id: 'sub-other', name: 'bot-ui', config: { kind: 'webhook', slug: 'bot-ui', prompt: 'p' } }))).toThrow('already uses the slug bot-ui');
  expect(readRegistry(cwd).subscriptions).toHaveLength(1);
});

local('a live owner reserves fresh events for its Task-backed callback', async ({ cwd }) => {
  createDesired(cwd, timer({ config: { kind: 'timer', prompt: 'fresh', delaySeconds: 1, once: true, strategy: 'new_session' } }));
  acceptEvent(cwd, 'sub-aaaa', 'one', 'fresh');
  const lease = acquireLease(ownerLockPath(cwd, 'owner'));
  expect(lease?.token).toMatch(/^\d+-/);
  try {
    const received: string[] = [];
    expect(
      startFresh(
        cwd,
        'one',
        undefined,
        () => true,
        () => {
          received.push('offline');
        },
      ),
    ).toBeUndefined();
    const claim = startFresh(
      cwd,
      'one',
      'owner',
      () => true,
      () => {
        received.push('live');
      },
    );
    expect(claim?.token).toEqual(expect.any(String));
    expect(
      startFresh(
        cwd,
        'one',
        'owner',
        () => true,
        () => {
          received.push('duplicate');
        },
      ),
    ).toBeUndefined();
    await claim?.result;
    if (claim !== undefined) finishFresh(cwd, 'one', claim.token);
    expect(received).toEqual(['live']);
    expect(readRegistry(cwd).pending).toEqual([]);
  } finally {
    lease?.release();
  }
});

local('dead fresh execution claims are recovered without reclaiming a live claimant', async ({ cwd }) => {
  createDesired(cwd, timer({ config: { kind: 'timer', prompt: 'fresh', delaySeconds: 1, once: true, strategy: 'new_session' } }));
  acceptEvent(cwd, 'sub-aaaa', 'one', 'fresh');
  const registry = readRegistry(cwd);
  const pending = registry.pending[0];
  if (pending === undefined) throw new Error('Expected the accepted event.');
  pending.claim = { pid: 2_147_483_647, token: 'dead', mode: 'detached' };
  writeFileSync(durableRegistryPath(cwd), JSON.stringify(registry));
  const received: string[] = [];
  const claim = startFresh(
    cwd,
    'one',
    undefined,
    () => true,
    () => {
      received.push('offline');
    },
  );
  expect(claim?.token).toEqual(expect.any(String));
  await claim?.result;
  if (claim !== undefined) finishFresh(cwd, 'one', claim.token);
  expect(received).toEqual(['offline']);
  expect(readRegistry(cwd).subscriptions[0]?.lastOutcome?.text).toBe('detached run completed');
  expect(visibleSubscriptions(readRegistry(cwd))).toHaveLength(1);
  expect(cancelDesired(cwd, 'nudge')?.lifecycle).toBe('cancelled');
  expect(visibleSubscriptions(readRegistry(cwd))).toEqual([]);
});

local('a fresh launch callback can manage subscriptions without holding the registry lock', async ({ cwd }) => {
  createDesired(cwd, timer({ config: { kind: 'timer', prompt: 'fresh', delaySeconds: 1, once: true, strategy: 'new_session' } }));
  acceptEvent(cwd, 'sub-aaaa', 'one', 'fresh');
  const claim = startFresh(
    cwd,
    'one',
    undefined,
    () => true,
    () => {
      createDesired(cwd, timer({ id: 'sub-next', name: 'next' }));
    },
  );
  await expect(claim?.result).resolves.toBeUndefined();
  expect(readRegistry(cwd).subscriptions.map((sub) => sub.name)).toEqual(['nudge', 'next']);
});

local('failed fresh execution keeps the pending event and exposes the error', async ({ cwd }) => {
  createDesired(cwd, timer({ config: { kind: 'timer', prompt: 'fresh', delaySeconds: 1, once: true, strategy: 'new_session' } }));
  acceptEvent(cwd, 'sub-aaaa', 'one', 'fresh');
  const claim = startFresh(
    cwd,
    'one',
    undefined,
    () => true,
    () => Promise.reject(new Error('spawn failed')),
  );
  await expect(claim?.result).rejects.toThrow('spawn failed');
  if (claim !== undefined) finishFresh(cwd, 'one', claim.token, new Error('spawn failed'));
  expect(readRegistry(cwd)).toMatchObject({ subscriptions: [{ lastError: { text: 'spawn failed' } }], pending: [{ id: 'one' }] });
  expect(readRegistry(cwd).pending[0]).not.toHaveProperty('claim');
});

local('corrupt authority fails visibly without erasing the file', ({ cwd }) => {
  createDesired(cwd, timer());
  const path = durableRegistryPath(cwd);
  writeFileSync(path, '{broken');
  expect(() => readRegistry(cwd)).toThrow('Cannot read authoritative subscription registry');
  expect(() => createDesired(cwd, timer({ id: 'sub-other', name: 'other' }))).toThrow('Retain the file');
  expect(readFileSync(path, 'utf8')).toBe('{broken');
});

local('v1 migration derives exact owner ID from the session header and ignores blanket spawn', ({ cwd }) => {
  const file = join(dirname(cwd), 'owner.jsonl');
  writeFileSync(file, `${JSON.stringify({ type: 'session', id: 'saved-owner' })}\n`);
  const path = durableRegistryPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const legacy = timer({ ownerSessionFile: file, detachedDelivery: 'spawn' });
  delete legacy.ownerSessionId;
  writeFileSync(path, JSON.stringify({ version: 1, workspaceCwd: cwd, subscriptions: [legacy] }));
  expect(readRegistry(cwd)).toMatchObject({ version: 2, subscriptions: [{ ownerSessionId: 'saved-owner', lifecycle: 'active' }], pending: [] });
  expect(JSON.parse(readFileSync(path, 'utf8')).subscriptions[0]).not.toHaveProperty('detachedDelivery');
});

local('legacy missing identity is visible and cannot become a wildcard owner', ({ cwd }) => {
  const path = durableRegistryPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const legacy = timer();
  delete legacy.ownerSessionId;
  writeFileSync(path, JSON.stringify({ version: 1, workspaceCwd: cwd, subscriptions: [legacy] }));
  expect(readRegistry(cwd).subscriptions[0]?.lastError?.text).toContain('Owner session ID unavailable');
});

local('workspace symlink aliases share authoritative state', ({ cwd }) => {
  mkdirSync(cwd);
  const alias = join(dirname(cwd), 'alias');
  symlinkSync(cwd, alias);
  createDesired(alias, timer());
  expect(canonicalPath(alias)).toBe(canonicalPath(cwd));
  expect(readRegistry(cwd).subscriptions).toHaveLength(1);
  expect(cancelDesired(cwd, 'nudge')?.id).toBe('sub-aaaa');
  expect(visibleSubscriptions(readRegistry(alias))).toEqual([]);
});

local('cross-process creates preserve different names and deduplicate one shared name', async ({ cwd, signal }) => {
  const names = ['shared', 'shared', 'shared', 'one', 'two', 'three'];
  const results = await Promise.all(
    names.map(async (name) => {
      const { stdout } = await run(process.execPath, ['--experimental-strip-types', fixture, cwd, 'create', name], { signal, env: process.env });
      return JSON.parse(stdout) as { created: boolean };
    }),
  );
  expect(results.filter((result) => result.created)).toHaveLength(4);
  expect(
    readRegistry(cwd)
      .subscriptions.map((sub) => sub.name)
      .sort(),
  ).toEqual(['one', 'shared', 'three', 'two']);
});

local('dead registry writers and owner consumers release exclusive ownership', async ({ cwd, signal, onTestFinished }) => {
  const marker = join(dirname(cwd), 'held');
  const path = join(durableRuntimeDir(cwd), 'registry.lock');
  const child = spawn(process.execPath, ['--experimental-strip-types', fixture, cwd, 'hold', path, marker], { signal, env: process.env, stdio: 'ignore' });
  const closed = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', () => resolve());
  });
  onTestFinished(async () => {
    child.kill('SIGKILL');
    await closed;
  });
  await expect.poll(() => existsSync(marker)).toBe(true);
  expect(acquireLease(path)).toBeUndefined();
  child.kill('SIGKILL');
  await closed;
  expect(createDesired(cwd, timer()).created).toBe(true);
  const ownerPath = ownerLockPath(cwd, 'owner');
  mkdirSync(ownerPath);
  writeFileSync(join(ownerPath, `2147483647-${randomUUID()}`), '');
  const recovered = acquireLease(ownerPath);
  expect(recovered?.token).toMatch(/^\d+-/);
  recovered?.release();
});

local('supervisor takeover retains exclusivity and epoch-checked release', ({ cwd }) => {
  mkdirSync(dirname(supervisorLockPath(cwd)), { recursive: true });
  writeFileSync(supervisorLockPath(cwd), JSON.stringify({ pid: 2_147_483_647, startedAt: 1, epoch: 'dead' }));
  expect(acquireSupervisorLock(cwd)).toEqual({ acquired: true });
  expect(isSupervisorLive(cwd)).toBe(true);
  expect(acquireSupervisorLock(cwd)).toEqual({ acquired: false, alreadyRunning: true, pid: process.pid });
  releaseSupervisorLock(cwd, process.pid, 'wrong-epoch');
  expect(isSupervisorLive(cwd)).toBe(true);
  releaseSupervisorLock(cwd);
  expect(isSupervisorLive(cwd)).toBe(false);
});

local.for(['before', 'after'] as const)('producer death %s the acceptance commit preserves the correct delivery boundary', async (crash, { cwd, signal }) => {
  createDesired(cwd, timer());
  await expect(
    run(process.execPath, ['--require', join(import.meta.dirname, 'fixtures/subscription-crash.cjs'), '--experimental-strip-types', fixture, cwd, 'accept', 'one'], {
      signal,
      env: { ...process.env, PSTACK_TEST_CRASH: crash },
    }),
  ).rejects.toMatchObject({ signal: 'SIGKILL' });
  const received: string[] = [];
  deliverOwner(
    cwd,
    'owner',
    () => true,
    (_sub, event) => {
      received.push(event.content);
    },
  );
  expect(received).toEqual(crash === 'before' ? [] : ['accepted in producer']);
  expect(readRegistry(cwd).subscriptions[0]?.lifecycle).toBe(crash === 'before' ? 'active' : 'completed');
  expect(readRegistry(cwd).pending).toEqual([]);
});

local('a crash after send but before acknowledgement permits an at-least-once replay', async ({ cwd, signal }) => {
  createDesired(cwd, timer());
  acceptEvent(cwd, 'sub-aaaa', 'one', 'accepted');
  const marker = join(dirname(cwd), 'sent-events');
  await expect(
    run(process.execPath, ['--require', join(import.meta.dirname, 'fixtures/subscription-crash.cjs'), '--experimental-strip-types', fixture, cwd, 'deliver', marker], {
      signal,
      env: { ...process.env, PSTACK_TEST_CRASH: 'before' },
    }),
  ).rejects.toMatchObject({ signal: 'SIGKILL' });
  expect(readFileSync(marker, 'utf8')).toBe('one\n');
  expect(readRegistry(cwd).pending).toMatchObject([{ id: 'one' }]);
  const replayed: string[] = [];
  deliverOwner(
    cwd,
    'owner',
    () => true,
    (_sub, event) => {
      replayed.push(event.id);
    },
  );
  expect(replayed).toEqual(['one']);
  expect(readRegistry(cwd).pending).toEqual([]);
});

local('cross-process cancellation wins over either acceptance ordering', async ({ cwd, signal }) => {
  createDesired(cwd, timer());
  await Promise.all([
    run(process.execPath, ['--experimental-strip-types', fixture, cwd, 'accept', 'one'], { signal, env: process.env }),
    run(process.execPath, ['--experimental-strip-types', fixture, cwd, 'cancel', 'nudge'], { signal, env: process.env }),
  ]);
  const received: string[] = [];
  deliverOwner(
    cwd,
    'owner',
    () => true,
    (_sub, event) => {
      received.push(event.content);
    },
  );
  expect(received).toEqual([]);
  expect(readRegistry(cwd)).toMatchObject({ subscriptions: [{ lifecycle: 'cancelled' }], pending: [] });
});
