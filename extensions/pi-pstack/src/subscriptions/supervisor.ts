import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { routinesDir } from '../paths.ts';
import { type CronSchedule, cronMatches, parseCron } from './cron.ts';
import { acquireSupervisorLock, claimDelivery, dropExpired, ensureDurableDirs, inboxDir, readDelivery, readRegistry, registryMtimeMs, releaseSupervisorLock, removeDesired, writeDelivery, writeRegistry } from './durable-store.ts';
import type { DurableSubscription } from './durable-types.ts';
import { defaultGhRunner, fetchPrs, type GhRunner, type PrSnapshot, pollChanges } from './github.ts';
import { credentialFile, DEFAULT_ROUTINES_PORT, ensureCredentials, RoutineServer, type WebhookEvent, webhookEventBlock } from './webhook.ts';

const HOUR_MS = 3_600_000;
const MAX_STEP_MS = 24 * 24 * HOUR_MS;
const MINUTE_MS = 60_000;

export type RunFresh = (prompt: string, name: string, meta: { subscriptionId: string; cwd: string }) => Promise<void> | void;

export interface SupervisorOptions {
  workspaceCwd: string;
  runFresh: RunFresh;
  now?: () => number;
  routinesPort?: number;
  routinesDir?: string;
  pollIntervalMs?: number;
  gh?: GhRunner;
  reconcileIntervalMs?: number;
}

type TimerConfig = Extract<DurableSubscription['config'], { kind: 'timer' }>;

interface Armed {
  sub: DurableSubscription;
  timers: Set<ReturnType<typeof setTimeout>>;
  lastCronMinute?: number;
  baseline?: Map<number, PrSnapshot>;
  polling?: boolean;
}

function envPort(): number {
  const raw = process.env['PSTACK_ROUTINES_PORT'];
  const port = raw === undefined || raw === '' ? DEFAULT_ROUTINES_PORT : Number(raw);
  return Number.isInteger(port) && port >= 0 && port < 65536 ? port : DEFAULT_ROUTINES_PORT;
}

function oneLine(text: string, max = 500) {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function errorText(error: unknown) {
  return oneLine(error instanceof Error ? error.message : String(error));
}

/** Delay fire index matching in-process cadence (createdAt + n * period). */
export function delayFireIndex(createdAt: number, delaySeconds: number, at: number): number {
  const period = Math.max(1, delaySeconds) * 1_000;
  return Math.floor(Math.max(0, at - createdAt) / period);
}

export function timerClaimKey(sub: DurableSubscription, config: TimerConfig, at: number): string {
  if (config.once && config.cron === undefined) return `${sub.id}:once`;
  if (config.cron !== undefined) return `${sub.id}:${Math.floor(at / MINUTE_MS)}`;
  return `${sub.id}:${delayFireIndex(sub.createdAt, config.delaySeconds ?? 1, at)}`;
}

export function webhookClaimKey(subscriptionId: string, bodyDigest: string): string {
  return `${subscriptionId}:sha256:${bodyDigest}`;
}

function deliveryOf(sub: DurableSubscription): 'spawn' | 'park' {
  return sub.detachedDelivery ?? 'spawn';
}

/** True when a once timer already has its forever claim key on disk. */
export function onceClaimSettled(cwd: string, sub: DurableSubscription): boolean {
  if (sub.config.kind !== 'timer' || !sub.config.once || sub.config.cron !== undefined) return false;
  return readDelivery(cwd, sub.id)?.lastClaimKey === `${sub.id}:once`;
}

function timerDeliveryPrompt(sub: DurableSubscription, config: TimerConfig): string {
  if (config.strategy === 'wake_self' && deliveryOf(sub) === 'park') return `[timer] ${sub.name}\n\n${config.prompt}`;
  return config.prompt;
}

/**
 * Sole owner of timer/poll/routines arms for one workspace when its lock is held.
 * Chat dual-writes desired state; this process alone writes runtime/delivery.
 */
export function createSupervisor(options: SupervisorOptions) {
  const cwd = options.workspaceCwd;
  const now = options.now ?? Date.now;
  const gh = options.gh ?? defaultGhRunner;
  const pollMs = options.pollIntervalMs ?? MINUTE_MS;
  const dir = options.routinesDir ?? routinesDir();
  const server = new RoutineServer(options.routinesPort ?? envPort());
  const armed = new Map<string, Armed>();
  let active = false;
  let lastMtime: number | undefined;
  let watchTimer: ReturnType<typeof setTimeout> | undefined;
  let lockHeld = false;

  const at = (entry: Armed, when: number, fn: () => void) => {
    const handle = setTimeout(
      () => {
        entry.timers.delete(handle);
        if (!active || armed.get(entry.sub.id) !== entry) return;
        if (now() < when) at(entry, when, fn);
        else fn();
      },
      Math.min(Math.max(0, when - now()), MAX_STEP_MS),
    );
    handle.unref?.();
    entry.timers.add(handle);
  };

  const disarm = (entry: Armed) => {
    for (const handle of entry.timers) clearTimeout(handle);
    entry.timers.clear();
    if (entry.sub.config.kind === 'webhook') {
      server.routes.delete(entry.sub.config.slug);
      if (server.routes.size === 0) server.close();
    }
  };

  const stopAll = () => {
    for (const entry of armed.values()) disarm(entry);
    armed.clear();
    server.close();
  };

  const park = (sub: DurableSubscription, content: string) => {
    const file = join(inboxDir(cwd), `${sub.id}-${now()}.json`);
    writeFileSync(file, `${JSON.stringify({ subscriptionId: sub.id, name: sub.name, at: now(), content, ownerSessionFile: sub.ownerSessionFile }, null, 2)}\n`, { mode: 0o600 });
  };

  const deliver = async (sub: DurableSubscription, prompt: string) => {
    if (deliveryOf(sub) === 'park') {
      park(sub, prompt);
      return;
    }
    try {
      await options.runFresh(prompt, sub.name, { subscriptionId: sub.id, cwd });
    } catch (error) {
      const existing = readDelivery(cwd, sub.id);
      if (existing !== undefined) writeDelivery(cwd, { ...existing, lastError: { at: now(), text: errorText(error) } });
      throw error;
    }
  };

  const removeOnce = (id: string) => {
    removeDesired(cwd, id);
    const entry = armed.get(id);
    if (entry !== undefined) {
      disarm(entry);
      armed.delete(id);
    }
  };

  const clearOnceClaim = (subscriptionId: string, claimKey: string) => {
    const existing = readDelivery(cwd, subscriptionId);
    if (existing === undefined || existing.lastClaimKey !== claimKey) return;
    // Drop the forever once key so reconcile / retry can claim again; keep lastError.
    writeDelivery(cwd, { ...existing, lastClaimKey: `${subscriptionId}:retry` });
  };

  const fireTimer = async (entry: Armed, config: TimerConfig) => {
    const atMs = now();
    const key = timerClaimKey(entry.sub, config, atMs);
    if (onceClaimSettled(cwd, entry.sub)) {
      removeOnce(entry.sub.id);
      return;
    }
    const { claimed } = claimDelivery(cwd, entry.sub.id, key, atMs);
    if (!claimed) return;
    try {
      await deliver(entry.sub, timerDeliveryPrompt(entry.sub, config));
    } catch {
      if (config.once) clearOnceClaim(entry.sub.id, key);
      return;
    }
    if (config.once) removeOnce(entry.sub.id);
  };

  const armTimer = (entry: Armed, config: TimerConfig) => {
    if (config.cron !== undefined) {
      let schedule: CronSchedule;
      try {
        schedule = parseCron(config.cron);
      } catch {
        return;
      }
      const tick = () => {
        if (now() >= entry.sub.expiresAt) {
          removeOnce(entry.sub.id);
          return;
        }
        const atMs = now();
        const minute = Math.floor(atMs / MINUTE_MS);
        if (minute !== entry.lastCronMinute && cronMatches(schedule, new Date(atMs))) {
          entry.lastCronMinute = minute;
          void fireTimer(entry, config);
        }
        // Once success disarms; once deliver failure clears the claim and the next minute retries.
        if (armed.get(entry.sub.id) === entry && !(config.once && onceClaimSettled(cwd, entry.sub))) {
          at(entry, (minute + 1) * MINUTE_MS, tick);
        }
      };
      at(entry, (Math.floor(now() / MINUTE_MS) + 1) * MINUTE_MS, tick);
      return;
    }
    const period = (config.delaySeconds ?? 1) * 1_000;
    const next = () => {
      const { createdAt } = entry.sub;
      if (config.once) return createdAt + period;
      return createdAt + (Math.floor(Math.max(0, now() - createdAt) / period) + 1) * period;
    };
    const fire = () => {
      if (now() >= entry.sub.expiresAt) {
        removeOnce(entry.sub.id);
        return;
      }
      void fireTimer(entry, config).then(() => {
        if (armed.get(entry.sub.id) !== entry) return;
        if (!config.once) {
          at(entry, next(), fire);
          return;
        }
        // At-least-once: deliver failure cleared the once claim; retry shortly.
        if (!onceClaimSettled(cwd, entry.sub)) at(entry, now() + 1_000, fire);
      });
    };
    at(entry, next(), fire);
  };

  const onWebhook = (entry: Armed, prompt: string) => (event: WebhookEvent) => {
    if (armed.get(entry.sub.id) !== entry) return;
    if (now() >= entry.sub.expiresAt) {
      removeOnce(entry.sub.id);
      return;
    }
    const key = webhookClaimKey(entry.sub.id, event.bodyDigest);
    const { claimed } = claimDelivery(cwd, entry.sub.id, key, now());
    if (!claimed) return;
    const content = [`[routine] ${entry.sub.name}`, prompt, webhookEventBlock(event)].join('\n\n');
    void deliver(entry.sub, content).catch(() => {
      // deliver already wrote lastError; swallow so the POST handler has no unhandled rejection.
    });
  };

  const armWebhook = async (entry: Armed, slug: string, prompt: string) => {
    const file = ensureCredentials(dir, slug);
    server.routes.set(slug, { slug, credentialFile: file, onEvent: onWebhook(entry, prompt) });
    await server.url(slug);
  };

  const poll = async (entry: Armed, target: Extract<DurableSubscription['config'], { kind: 'github' }>['target']) => {
    if (entry.polling === true || !active || now() >= entry.sub.expiresAt) return;
    entry.polling = true;
    try {
      const after = await fetchPrs(gh, target);
      if (!active || armed.get(entry.sub.id) !== entry) return;
      if (entry.baseline !== undefined) {
        const blocks = await pollChanges(gh, target, entry.baseline, after);
        if (blocks.length > 0 && armed.get(entry.sub.id) === entry) {
          const content = [`[github] ${entry.sub.name}`, ...blocks].join('\n\n');
          await deliver(entry.sub, content);
        }
      }
      if (armed.get(entry.sub.id) !== entry) return;
      entry.baseline = after;
    } catch {
      // Keep polling; GitHub downtime gaps are accepted (same as interactive).
    } finally {
      entry.polling = false;
    }
  };

  const armGithub = async (entry: Armed, target: Extract<DurableSubscription['config'], { kind: 'github' }>['target']) => {
    const loop = () => {
      void poll(entry, target).then(() => {
        if (active && armed.get(entry.sub.id) === entry) at(entry, now() + pollMs, loop);
      });
    };
    await poll(entry, target);
    if (active && armed.get(entry.sub.id) === entry) at(entry, now() + pollMs, loop);
  };

  const arm = async (entry: Armed) => {
    at(entry, entry.sub.expiresAt, () => {
      if (armed.get(entry.sub.id) === entry) removeOnce(entry.sub.id);
    });
    const { config } = entry.sub;
    if (config.kind === 'timer') armTimer(entry, config);
    else if (config.kind === 'github') await armGithub(entry, config.target);
    else await armWebhook(entry, config.slug, config.prompt);
  };

  /** Load registry, drop expired, re-arm only ids whose desired state changed. Idempotent. */
  const reconcile = async () => {
    if (!active) return;
    const registry = dropExpired(readRegistry(cwd), now());
    if (registry.subscriptions.length !== readRegistry(cwd).subscriptions.length) writeRegistry(cwd, registry);
    const desired = new Map(registry.subscriptions.map((sub) => [sub.id, sub]));
    for (const [id, entry] of armed) {
      if (!desired.has(id)) {
        disarm(entry);
        armed.delete(id);
      }
    }
    for (const sub of registry.subscriptions) {
      const existing = armed.get(sub.id);
      const same = existing !== undefined && JSON.stringify(existing.sub) === JSON.stringify(sub);
      if (same) continue;
      if (existing !== undefined) {
        disarm(existing);
        armed.delete(sub.id);
      }
      if (onceClaimSettled(cwd, sub)) {
        removeDesired(cwd, sub.id);
        continue;
      }
      const entry: Armed = { sub, timers: new Set() };
      armed.set(sub.id, entry);
      try {
        await arm(entry);
      } catch {
        disarm(entry);
        armed.delete(sub.id);
      }
    }
    lastMtime = registryMtimeMs(cwd);
  };

  const scheduleWatch = () => {
    if (!active) return;
    const interval = options.reconcileIntervalMs ?? 2_000;
    // Do not unref: fire timers and the routines server are unref'd, so this watch is what keeps the daemon process alive.
    watchTimer = setTimeout(() => {
      void (async () => {
        if (!active) return;
        const mtime = registryMtimeMs(cwd);
        if (mtime !== lastMtime) await reconcile();
        scheduleWatch();
      })();
    }, interval);
  };

  return {
    /** Acquire lock (or no-op if already running elsewhere), reconcile, start watch. */
    start: async (): Promise<{ started: boolean; alreadyRunning?: boolean; pid?: number }> => {
      ensureDurableDirs(cwd);
      const lock = acquireSupervisorLock(cwd);
      if (!lock.acquired) return { started: false, alreadyRunning: true, pid: lock.pid };
      lockHeld = true;
      active = true;
      await reconcile();
      scheduleWatch();
      return { started: true };
    },
    reconcile,
    stop: () => {
      active = false;
      if (watchTimer !== undefined) clearTimeout(watchTimer);
      watchTimer = undefined;
      stopAll();
      if (lockHeld) {
        releaseSupervisorLock(cwd);
        lockHeld = false;
      }
    },
    isListening: () => server.isListening(),
    credentialFile: (slug: string) => credentialFile(dir, slug),
  };
}

export type Supervisor = ReturnType<typeof createSupervisor>;
