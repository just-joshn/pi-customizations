import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest';
import { claimDelivery, createDesired, ensureDurableDirs, readDelivery, readRegistry, writeRegistry } from '../src/subscriptions/durable-store.ts';
import type { DurableSubscription } from '../src/subscriptions/durable-types.ts';
import { createSupervisor, timerClaimKey, webhookClaimKey } from '../src/subscriptions/supervisor.ts';
import { ensureCredentials } from '../src/subscriptions/webhook.ts';

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);

const onceTimer = (over: Partial<DurableSubscription> = {}): DurableSubscription => ({
  id: 'sub-once1',
  name: 'durable-smoke',
  createdAt: NOW,
  expiresAt: NOW + 7 * 24 * 3_600_000,
  config: { kind: 'timer', prompt: 'write the marker', delaySeconds: 15, once: true, strategy: 'new_session' },
  detachedDelivery: 'spawn',
  ...over,
});

describe('supervisor reconcile', () => {
  let agentDir: string;
  let cwd: string;
  let routines: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), 'pstack-supervisor-'));
    cwd = join(agentDir, 'workspace');
    routines = join(agentDir, 'routines');
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
    vi.useFakeTimers({ now: NOW });
    onTestFinished(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      rmSync(agentDir, { recursive: true, force: true });
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  test('once delay claims, spawns once via runFresh, and removes desired state', async () => {
    ensureDurableDirs(cwd);
    createDesired(cwd, onceTimer());
    const fires: { prompt: string; name: string }[] = [];
    const supervisor = createSupervisor({
      workspaceCwd: cwd,
      routinesDir: routines,
      routinesPort: 0,
      reconcileIntervalMs: 60_000,
      runFresh: (prompt, name) => {
        fires.push({ prompt, name });
      },
    });
    expect(await supervisor.start()).toEqual({ started: true });
    expect(readRegistry(cwd).subscriptions).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(14_000);
    expect(fires).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(fires).toEqual([{ prompt: 'write the marker', name: 'durable-smoke' }]));

    expect(readDelivery(cwd, 'sub-once1')).toMatchObject({ lastClaimKey: 'sub-once1:once' });
    expect(readRegistry(cwd).subscriptions).toEqual([]);

    writeRegistry(cwd, { version: 1, workspaceCwd: cwd, subscriptions: [onceTimer()] });
    await supervisor.reconcile();
    expect(fires).toHaveLength(1);
    expect(readRegistry(cwd).subscriptions).toEqual([]);

    supervisor.stop();
  });

  test('pre-claimed once key removes desired state on reconcile without spawning', async () => {
    ensureDurableDirs(cwd);
    const sub = onceTimer();
    const config = sub.config as Extract<DurableSubscription['config'], { kind: 'timer' }>;
    claimDelivery(cwd, sub.id, timerClaimKey(sub, config, NOW + 15_000), NOW);
    createDesired(cwd, sub);
    const fires: string[] = [];
    const supervisor = createSupervisor({
      workspaceCwd: cwd,
      routinesDir: routines,
      routinesPort: 0,
      reconcileIntervalMs: 60_000,
      runFresh: (_prompt, name) => {
        fires.push(name);
      },
    });
    await supervisor.start();
    expect(readRegistry(cwd).subscriptions).toEqual([]);
    expect(fires).toEqual([]);
    supervisor.stop();
  });

  test('repeating delay uses fire-index claim keys', async () => {
    ensureDurableDirs(cwd);
    const sub = onceTimer({
      id: 'sub-rep',
      name: 'tick',
      config: { kind: 'timer', prompt: 'tick', delaySeconds: 10, once: false, strategy: 'new_session' },
    });
    createDesired(cwd, sub);
    const fires: string[] = [];
    const supervisor = createSupervisor({
      workspaceCwd: cwd,
      routinesDir: routines,
      routinesPort: 0,
      reconcileIntervalMs: 60_000,
      runFresh: (prompt) => {
        fires.push(prompt);
      },
    });
    await supervisor.start();
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(fires).toHaveLength(1));
    expect(readDelivery(cwd, 'sub-rep')?.lastClaimKey).toBe('sub-rep:1');
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(fires).toHaveLength(2));
    expect(readDelivery(cwd, 'sub-rep')?.lastClaimKey).toBe('sub-rep:2');
    expect(readRegistry(cwd).subscriptions).toHaveLength(1);
    supervisor.stop();
  });

  test('duplicate webhook POST with the same body digest does not spawn twice', async () => {
    ensureDurableDirs(cwd);
    const sub: DurableSubscription = {
      id: 'sub-hook',
      name: 'durable-hook',
      createdAt: NOW,
      expiresAt: NOW + 7 * 24 * 3_600_000,
      config: { kind: 'webhook', prompt: 'handle the post', slug: 'durable-hook' },
      detachedDelivery: 'spawn',
    };
    createDesired(cwd, sub);
    const port = 48_000 + Math.floor(Math.random() * 1_000);
    const fires: string[] = [];
    const supervisor = createSupervisor({
      workspaceCwd: cwd,
      routinesDir: routines,
      routinesPort: port,
      reconcileIntervalMs: 60_000,
      runFresh: (prompt) => {
        fires.push(prompt);
      },
    });
    await supervisor.start();
    expect(supervisor.isListening()).toBe(true);

    const credPath = ensureCredentials(routines, 'durable-hook');
    const key = (JSON.parse(readFileSync(credPath, 'utf8')) as { key: string }).key;
    const body = '{"ping":true}';
    const digest = createHash('sha256').update(body).digest('hex');
    expect(webhookClaimKey('sub-hook', digest)).toBe(`sub-hook:sha256:${digest}`);

    const post = () =>
      fetch(`http://127.0.0.1:${port}/routines/durable-hook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-automation-key': key },
        body,
      });

    // Fake timers block real HTTP sockets; run the POSTs on the real clock.
    vi.useRealTimers();
    const a = await post();
    expect(a.status).toBe(200);
    await vi.waitFor(() => expect(fires).toHaveLength(1));
    const b = await post();
    expect(b.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fires).toHaveLength(1);
    expect(readDelivery(cwd, 'sub-hook')?.lastClaimKey).toBe(webhookClaimKey('sub-hook', digest));
    expect(fires[0]).toContain('handle the post');
    expect(fires[0]).toContain(digest);
    supervisor.stop();
  });

  test('second supervisor start does not acquire the lock', async () => {
    ensureDurableDirs(cwd);
    const first = createSupervisor({
      workspaceCwd: cwd,
      routinesDir: routines,
      routinesPort: 0,
      reconcileIntervalMs: 60_000,
      runFresh: () => undefined,
    });
    expect(await first.start()).toEqual({ started: true });
    const second = createSupervisor({
      workspaceCwd: cwd,
      routinesDir: routines,
      routinesPort: 0,
      reconcileIntervalMs: 60_000,
      runFresh: () => undefined,
    });
    expect(await second.start()).toEqual({ started: false, alreadyRunning: true, pid: process.pid });
    first.stop();
    second.stop();
  });
});
