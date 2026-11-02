import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { durableRegistryPath } from '../src/paths.ts';
import { acceptEvent, cancelDesired, canonicalPath, createDesired, readArm, readRegistry } from '../src/subscriptions/durable-store.ts';
import type { DurableSubscription } from '../src/subscriptions/durable-types.ts';
import { createSupervisor, type SupervisorOptions } from '../src/subscriptions/supervisor.ts';
import { ensureCredentials } from '../src/subscriptions/webhook.ts';

const local = test.extend<{ cwd: string; routines: string }>({
  cwd: async ({ signal }, use) => {
    signal.throwIfAborted();
    const dir = mkdtempSync(join(tmpdir(), 'pstack-supervisor-'));
    vi.stubEnv('PI_CODING_AGENT_DIR', dir);
    try {
      await use(canonicalPath(join(dir, 'workspace')));
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  routines: async ({ cwd }, use) => {
    await use(join(cwd, '../routines'));
  },
});
const timer = (over: Partial<DurableSubscription> = {}): DurableSubscription => ({
  id: 'sub-once1',
  name: 'durable-smoke',
  createdAt: Date.now(),
  expiresAt: Date.now() + 7 * 24 * 3_600_000,
  ownerSessionId: 'owner',
  config: { kind: 'timer', prompt: 'write the marker', delaySeconds: 15, once: true, strategy: 'new_session' },
  ...over,
});

local('offline fresh once timers complete on acceptance and run once across supervisor restart', async ({ cwd, routines, onTestFinished }) => {
  vi.useFakeTimers();
  const sub = timer();
  createDesired(cwd, sub);
  const fires: string[] = [];
  const options: SupervisorOptions = {
    workspaceCwd: cwd,
    routinesDir: routines,
    routinesPort: 0,
    runFresh: (prompt) => {
      fires.push(prompt);
    },
  };
  const supervisor = createSupervisor(options);
  onTestFinished(() => supervisor.stop());
  expect(await supervisor.start()).toEqual({ started: true });
  await vi.advanceTimersByTimeAsync(15_000);
  expect(fires).toEqual(['write the marker']);
  expect(readRegistry(cwd)).toMatchObject({ subscriptions: [{ lifecycle: 'completed', lastOutcome: { text: 'detached run completed' } }], pending: [] });
  supervisor.stop();
  const restarted = createSupervisor(options);
  onTestFinished(() => restarted.stop());
  await restarted.start();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(fires).toEqual(['write the marker']);
});

local('owner-directed timers park while the owner is offline and never spawn a substitute', async ({ cwd, routines, onTestFinished }) => {
  vi.useFakeTimers();
  createDesired(cwd, timer({ config: { kind: 'timer', prompt: 'private marker', delaySeconds: 1, once: true, strategy: 'wake_self' } }));
  const fires: string[] = [];
  const supervisor = createSupervisor({
    workspaceCwd: cwd,
    routinesDir: routines,
    routinesPort: 0,
    runFresh: (prompt) => {
      fires.push(prompt);
    },
  });
  onTestFinished(() => supervisor.stop());
  await supervisor.start();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(fires).toEqual([]);
  expect(readRegistry(cwd)).toMatchObject({ subscriptions: [{ lifecycle: 'completed' }], pending: [{ content: '[timer] durable-smoke\n\nprivate marker' }] });
});

local('failed offline fresh launches retain pending work and retry without rearming once', async ({ cwd, routines, onTestFinished }) => {
  vi.useFakeTimers();
  createDesired(cwd, timer());
  let attempts = 0;
  const supervisor = createSupervisor({
    workspaceCwd: cwd,
    routinesDir: routines,
    routinesPort: 0,
    reconcileIntervalMs: 700,
    runFresh: () => {
      if (++attempts === 1) throw new Error('spawn failed');
    },
  });
  onTestFinished(() => supervisor.stop());
  await supervisor.start();
  await vi.advanceTimersByTimeAsync(15_001);
  expect(attempts).toBe(1);
  expect(readRegistry(cwd)).toMatchObject({ subscriptions: [{ lifecycle: 'completed', lastError: { text: 'spawn failed' } }], pending: [{ id: 'sub-once1:once' }] });
  await vi.advanceTimersByTimeAsync(700);
  expect(attempts).toBe(2);
  expect(readRegistry(cwd).pending).toEqual([]);
});

local('completed cron-once occurrences are not rearmed on restart', async ({ cwd, routines, onTestFinished }) => {
  vi.useFakeTimers({ now: new Date(2026, 0, 5, 9, 0, 30) });
  createDesired(cwd, timer({ config: { kind: 'timer', prompt: 'cron marker', cron: '* * * * *', once: true, strategy: 'wake_self' } }));
  const options: SupervisorOptions = {
    workspaceCwd: cwd,
    routinesDir: routines,
    routinesPort: 0,
    runFresh: () => {
      throw new Error('must park');
    },
  };
  const first = createSupervisor(options);
  onTestFinished(() => first.stop());
  await first.start();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(readRegistry(cwd).pending.map((event) => event.id)).toEqual(['sub-once1:once']);
  first.stop();
  const second = createSupervisor(options);
  onTestFinished(() => second.stop());
  await second.start();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(readRegistry(cwd).pending.map((event) => event.id)).toEqual(['sub-once1:once']);
});

local('cancelled stale arms cannot accept a later timer fire', async ({ cwd, routines, onTestFinished }) => {
  vi.useFakeTimers();
  createDesired(cwd, timer({ config: { kind: 'timer', prompt: 'cancelled', delaySeconds: 1, once: true, strategy: 'wake_self' } }));
  const supervisor = createSupervisor({ workspaceCwd: cwd, routinesDir: routines, routinesPort: 0, reconcileIntervalMs: 60_000, runFresh: () => {} });
  onTestFinished(() => supervisor.stop());
  await supervisor.start();
  cancelDesired(cwd, 'durable-smoke');
  await vi.advanceTimersByTimeAsync(1_000);
  expect(readRegistry(cwd)).toMatchObject({ subscriptions: [{ lifecycle: 'cancelled' }], pending: [] });
});

local('repeating delay preserves its cadence without replaying missed intervals', async ({ cwd, routines, onTestFinished }) => {
  vi.useFakeTimers();
  createDesired(cwd, timer({ createdAt: Date.now() - 35_000, config: { kind: 'timer', prompt: 'tick', delaySeconds: 10, once: false, strategy: 'wake_self' } }));
  const supervisor = createSupervisor({ workspaceCwd: cwd, routinesDir: routines, routinesPort: 0, runFresh: () => {} });
  onTestFinished(() => supervisor.stop());
  await supervisor.start();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(readRegistry(cwd).pending.map((event) => event.id)).toEqual(['sub-once1:4']);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(readRegistry(cwd).pending.map((event) => event.id)).toEqual(['sub-once1:4', 'sub-once1:5']);
});

local('equal authenticated POST bodies receive independent durable identities', async ({ cwd, routines, signal, onTestFinished }) => {
  const { subscription } = createDesired(cwd, timer({ name: 'durable-hook', config: { kind: 'webhook', prompt: 'handle the post', slug: 'durable-hook' } }));
  const supervisor = createSupervisor({
    workspaceCwd: cwd,
    routinesDir: routines,
    routinesPort: 0,
    runFresh: () => {
      throw new Error('must not spawn');
    },
  });
  onTestFinished(() => supervisor.stop());
  await supervisor.start();
  const status = readArm(cwd, subscription);
  expect(status).toMatchObject({ state: 'ready', url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\//) });
  if (status?.state !== 'ready' || status.url === undefined) throw new Error('Webhook is not ready.');
  const key = JSON.parse(readFileSync(ensureCredentials(routines, 'durable-hook'), 'utf8')).key;
  const url = status.url;
  const responses = await Promise.all(Array.from({ length: 2 }, () => fetch(url, { signal, method: 'POST', headers: { 'x-automation-key': key }, body: '{"ping":true}' })));
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  const events = readRegistry(cwd).pending;
  expect(events).toHaveLength(2);
  expect(new Set(events.map((event) => event.id)).size).toBe(2);
  expect(events.map((event) => event.content)).toEqual([expect.stringContaining('handle the post'), expect.stringContaining('handle the post')]);
});

local('storage rejection returns HTTP 503 instead of acknowledging an unaccepted POST', async ({ cwd, routines, signal, onTestFinished }) => {
  const { subscription } = createDesired(cwd, timer({ name: 'durable-hook', config: { kind: 'webhook', prompt: 'handle', slug: 'durable-hook' } }));
  const supervisor = createSupervisor({ workspaceCwd: cwd, routinesDir: routines, routinesPort: 0, reconcileIntervalMs: 60_000, runFresh: () => {} });
  onTestFinished(() => supervisor.stop());
  await supervisor.start();
  const status = readArm(cwd, subscription);
  if (status?.state !== 'ready' || status.url === undefined) throw new Error('Webhook is not ready.');
  const key = JSON.parse(readFileSync(ensureCredentials(routines, 'durable-hook'), 'utf8')).key;
  writeFileSync(durableRegistryPath(cwd), '{broken');
  const response = await fetch(status.url, { signal, method: 'POST', headers: { 'x-automation-key': key }, body: '{}' });
  expect(response.status).toBe(503);
  expect(await response.text()).toContain('Could not durably accept');
  expect(readFileSync(durableRegistryPath(cwd), 'utf8')).toBe('{broken');
});

local('webhook bind errors publish failed readiness even while the supervisor is alive', async ({ cwd, routines, onTestFinished }) => {
  const occupied = createServer();
  onTestFinished(() => {
    occupied.close();
  });
  await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  const address = occupied.address();
  if (address === null || typeof address === 'string') throw new Error('Missing port.');
  const { subscription } = createDesired(cwd, timer({ name: 'durable-hook', config: { kind: 'webhook', prompt: 'handle', slug: 'durable-hook' } }));
  const supervisor = createSupervisor({ workspaceCwd: cwd, routinesDir: routines, routinesPort: address.port, runFresh: () => {} });
  onTestFinished(() => supervisor.stop());
  expect(await supervisor.start()).toEqual({ started: true });
  expect(readArm(cwd, subscription)).toMatchObject({ state: 'error', message: expect.stringContaining('is in use') });
  expect(supervisor.isListening()).toBe(false);
});

local('a missing legacy owner reports a visible arm error rather than spawning', async ({ cwd, routines, onTestFinished }) => {
  const legacy = timer({ config: { kind: 'timer', prompt: 'owner', delaySeconds: 1, once: true, strategy: 'wake_self' } });
  delete legacy.ownerSessionId;
  const { subscription } = createDesired(cwd, legacy);
  const supervisor = createSupervisor({
    workspaceCwd: cwd,
    routinesDir: routines,
    routinesPort: 0,
    runFresh: () => {
      throw new Error('no substitute session');
    },
  });
  onTestFinished(() => supervisor.stop());
  await supervisor.start();
  expect(readArm(cwd, subscription)).toMatchObject({ state: 'error', message: expect.stringContaining('Owner session ID unavailable') });
  expect(readRegistry(cwd).pending).toEqual([]);
});

local('already accepted owner events remain pending across supervisor restarts', async ({ cwd, routines, onTestFinished }) => {
  createDesired(cwd, timer({ config: { kind: 'timer', prompt: 'owner', delaySeconds: 1, once: true, strategy: 'wake_self' } }));
  acceptEvent(cwd, 'sub-once1', 'sub-once1:once', 'owner');
  const first = createSupervisor({ workspaceCwd: cwd, routinesDir: routines, routinesPort: 0, runFresh: () => {} });
  onTestFinished(() => first.stop());
  await first.start();
  first.stop();
  const second = createSupervisor({ workspaceCwd: cwd, routinesDir: routines, routinesPort: 0, runFresh: () => {} });
  onTestFinished(() => second.stop());
  await second.start();
  expect(readRegistry(cwd).pending).toMatchObject([{ id: 'sub-once1:once', content: 'owner' }]);
});

local('only one supervisor can own a workspace', async ({ cwd, routines, onTestFinished }) => {
  const options: SupervisorOptions = { workspaceCwd: cwd, routinesDir: routines, routinesPort: 0, runFresh: () => {} };
  const first = createSupervisor(options);
  const second = createSupervisor(options);
  onTestFinished(() => {
    first.stop();
    second.stop();
  });
  expect(await first.start()).toEqual({ started: true });
  expect(await second.start()).toEqual({ started: false, alreadyRunning: true, pid: process.pid });
});
