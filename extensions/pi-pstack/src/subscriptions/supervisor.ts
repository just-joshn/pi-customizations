import { randomUUID } from 'node:crypto';

import { routinesDir } from '../paths.ts';
import { cronMatches, parseCron } from './cron.ts';
import { acceptEvent, acquireSupervisorLock, alive, canonicalPath, clearError, expireDesired, finishFresh, isDesired, readLock, readRegistry, recordError, releaseSupervisorLock, startFresh, writeArm } from './durable-store.ts';
import type { DurableSubscription, StoredSubscription } from './durable-types.ts';
import { defaultGhRunner, fetchPrs, type GhRunner, type PrSnapshot, pollChanges } from './github.ts';
import { credentialFile, DEFAULT_ROUTINES_PORT, ensureCredentials, RoutineServer, type WebhookEvent, webhookEventBlock } from './webhook.ts';

const MAX_STEP_MS = 24 * 24 * 3_600_000;
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
  onAccepted?: () => void;
  isDaemon?: boolean;
  ownerSessionId?: string;
}
type TimerConfig = Extract<DurableSubscription['config'], { kind: 'timer' }>;
type Armed = { sub: StoredSubscription; timers: Set<ReturnType<typeof setTimeout>>; baseline?: Map<number, PrSnapshot>; polling?: boolean };

function envPort(): number {
  const raw = process.env['PSTACK_ROUTINES_PORT'];
  const port = raw === undefined || raw === '' ? DEFAULT_ROUTINES_PORT : Number(raw);
  return Number.isInteger(port) && port >= 0 && port < 65536 ? port : DEFAULT_ROUTINES_PORT;
}
export function delayFireIndex(createdAt: number, delaySeconds: number, at: number): number {
  return Math.floor(Math.max(0, at - createdAt) / (Math.max(1, delaySeconds) * 1_000));
}
export function timerClaimKey(sub: DurableSubscription, config: TimerConfig, at: number): string {
  if (config.once) return `${sub.id}:once`;
  return `${sub.id}:${config.cron === undefined ? delayFireIndex(sub.createdAt, config.delaySeconds ?? 1, at) : Math.floor(at / MINUTE_MS)}`;
}

export function createSupervisor(options: SupervisorOptions) {
  const cwd = canonicalPath(options.workspaceCwd);
  const now = options.now ?? Date.now;
  const gh = options.gh ?? defaultGhRunner;
  const pollMs = options.pollIntervalMs ?? MINUTE_MS;
  const dir = options.routinesDir ?? routinesDir();
  const server = new RoutineServer(options.routinesPort ?? envPort());
  const armed = new Map<string, Armed>();
  const isDaemon = options.isDaemon ?? true;
  let active = false;
  let epoch: string | undefined;
  let watchTimer: ReturnType<typeof setTimeout> | undefined;
  let reconciling: Promise<void> | undefined;

  const owns = (entry: Armed) => active && armed.get(entry.sub.id) === entry;
  const at = (entry: Armed, when: number, fn: () => void) => {
    const handle = setTimeout(
      () => {
        entry.timers.delete(handle);
        if (!owns(entry)) return;
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
      if (server.routes.size === 0) server.close(false);
    }
  };
  const error = (id: string, cause: unknown) => recordError(cwd, id, cause);
  const offlineFresh = () => {
    if (!active) return;
    const registry = readRegistry(cwd);
    const eligible = registry.pending.filter((event) => {
      if (event.claim !== undefined && alive(event.claim.pid)) return false;
      if (event.retryAt !== undefined && now() < event.retryAt) return false;
      const sub = registry.subscriptions.find((s) => s.id === event.subscriptionId);
      if (sub === undefined || sub.lifecycle === 'cancelled' || sub.config.kind !== 'timer' || sub.config.strategy !== 'new_session') return false;
      if (!isDaemon && (options.ownerSessionId === undefined || sub.ownerSessionId !== options.ownerSessionId)) return false;
      return true;
    });
    for (const event of eligible) {
      const claim = startFresh(
        cwd,
        event.id,
        undefined,
        () => active,
        (sub, pending) => options.runFresh(pending.content, sub.name, { subscriptionId: sub.id, cwd }),
      );
      if (claim !== undefined)
        void claim.result
          .then(
            () => finishFresh(cwd, event.id, claim.token),
            (cause: unknown) => finishFresh(cwd, event.id, claim.token, cause),
          )
          .catch((cause: unknown) => {
            console.error(`Subscription delivery status failed. ${String(cause)}`);
          });
    }
  };
  const accepted = () => {
    options.onAccepted?.();
    offlineFresh();
  };
  const fireTimer = (entry: Armed, config: TimerConfig) => {
    if (!owns(entry)) return;
    try {
      const prompt = config.strategy === 'wake_self' ? `[timer] ${entry.sub.name}\n\n${config.prompt}` : config.prompt;
      if (acceptEvent(cwd, entry.sub.id, timerClaimKey(entry.sub, config, now()), prompt, now()) === 'accepted') accepted();
    } catch (cause) {
      error(entry.sub.id, cause);
    }
  };
  const armTimer = (entry: Armed, config: TimerConfig) => {
    if (config.cron !== undefined) {
      const schedule = parseCron(config.cron);
      const tick = () => {
        if (cronMatches(schedule, new Date(now()))) fireTimer(entry, config);
        const current = readRegistry(cwd).subscriptions.find((sub) => sub.id === entry.sub.id);
        if (current !== undefined && isDesired(current, now())) at(entry, (Math.floor(now() / MINUTE_MS) + 1) * MINUTE_MS, tick);
      };
      at(entry, (Math.floor(now() / MINUTE_MS) + 1) * MINUTE_MS, tick);
    } else {
      const period = (config.delaySeconds ?? 1) * 1_000;
      const next = () => (config.once ? entry.sub.createdAt + period : entry.sub.createdAt + (Math.floor(Math.max(0, now() - entry.sub.createdAt) / period) + 1) * period);
      const fire = () => {
        fireTimer(entry, config);
        const current = readRegistry(cwd).subscriptions.find((sub) => sub.id === entry.sub.id);
        if (current !== undefined && isDesired(current, now())) at(entry, config.once ? now() + 1_000 : next(), fire);
      };
      at(entry, next(), fire);
    }
  };
  const onWebhook =
    (entry: Armed, prompt: string) =>
    async (event: WebhookEvent): Promise<boolean> => {
      if (!owns(entry)) return false;
      const content = [`[routine] ${entry.sub.name}`, prompt, webhookEventBlock(event)].join('\n\n');
      const result = acceptEvent(cwd, entry.sub.id, event.eventId, content, now());
      if (result === 'inactive') return false;
      if (result === 'accepted') accepted();
      return true;
    };
  const poll = async (entry: Armed, target: Extract<DurableSubscription['config'], { kind: 'github' }>['target']) => {
    if (entry.polling || !owns(entry)) return;
    entry.polling = true;
    try {
      const after = await fetchPrs(gh, target);
      if (!owns(entry)) return;
      if (entry.baseline !== undefined) {
        const blocks = await pollChanges(gh, target, entry.baseline, after);
        if (!owns(entry)) return;
        if (blocks.length > 0 && acceptEvent(cwd, entry.sub.id, randomUUID(), [`[github] ${entry.sub.name}`, ...blocks].join('\n\n'), now()) === 'accepted') accepted();
      }
      entry.baseline = after;
      clearError(cwd, entry.sub.id);
    } finally {
      entry.polling = false;
    }
  };
  const arm = async (entry: Armed): Promise<string | undefined> => {
    if (entry.sub.ownerSessionId === undefined) throw new Error('Owner session ID unavailable. Recreate this subscription.');
    at(entry, entry.sub.expiresAt, () => {
      expireDesired(cwd, now());
      void reconcile().catch((cause: unknown) => error(entry.sub.id, cause));
    });
    const config = entry.sub.config;
    if (config.kind === 'timer') armTimer(entry, config);
    else if (config.kind === 'webhook') {
      server.routes.set(config.slug, { slug: config.slug, credentialFile: ensureCredentials(dir, config.slug), onEvent: onWebhook(entry, config.prompt) });
      return await server.url(config.slug);
    } else {
      const loop = () => {
        void poll(entry, config.target).then(
          () => {
            if (owns(entry)) at(entry, now() + pollMs, loop);
          },
          (cause: unknown) => {
            error(entry.sub.id, cause);
            if (owns(entry)) at(entry, now() + pollMs, loop);
          },
        );
      };
      loop();
    }
    return undefined;
  };
  const reconcile = (): Promise<void> => {
    if (!active) return Promise.resolve();
    if (reconciling !== undefined) return reconciling;
    reconciling = (async () => {
      const registry = readRegistry(cwd);
      if (registry.subscriptions.some((sub) => sub.lifecycle === 'active' && sub.expiresAt <= now())) expireDesired(cwd, now());
      const desired = registry.subscriptions.filter((sub) => isDesired(sub, now()));
      for (const [id, entry] of armed)
        if (!desired.some((sub) => sub.id === id && sub.revision === entry.sub.revision)) {
          disarm(entry);
          armed.delete(id);
        }
      for (const sub of desired) {
        if (!active) return;
        if (armed.has(sub.id)) continue;
        const entry: Armed = { sub, timers: new Set() };
        armed.set(sub.id, entry);
        try {
          const url = await arm(entry);
          if (!owns(entry) || epoch === undefined) continue;
          clearError(cwd, sub.id);
          writeArm(cwd, { state: 'ready', subscriptionId: sub.id, revision: sub.revision, epoch, ...(url === undefined ? {} : { url }) });
        } catch (cause) {
          disarm(entry);
          armed.delete(sub.id);
          if (!active || epoch === undefined) return;
          const message = cause instanceof Error ? cause.message : String(cause);
          error(sub.id, cause);
          writeArm(cwd, { state: 'error', subscriptionId: sub.id, revision: sub.revision, epoch, message });
        }
      }
      offlineFresh();
    })().finally(() => {
      reconciling = undefined;
    });
    return reconciling;
  };
  const watch = () => {
    if (!active) return;
    watchTimer = setTimeout(() => {
      void reconcile()
        .catch((cause: unknown) => console.error(`Subscription supervisor reconcile failed. ${String(cause)}`))
        .finally(watch);
    }, options.reconcileIntervalMs ?? 250);
  };
  return {
    start: async (): Promise<{ started: boolean; alreadyRunning?: boolean; pid?: number }> => {
      const lock = acquireSupervisorLock(cwd);
      if (!lock.acquired) return { started: false, alreadyRunning: true, pid: lock.pid };
      epoch = readLock(cwd)?.epoch;
      active = true;
      try {
        await reconcile();
        watch();
        return { started: true };
      } catch (cause) {
        active = false;
        releaseSupervisorLock(cwd, process.pid, epoch);
        throw cause;
      }
    },
    reconcile,
    stop: () => {
      active = false;
      if (watchTimer !== undefined) clearTimeout(watchTimer);
      for (const entry of armed.values()) disarm(entry);
      armed.clear();
      server.close();
      if (epoch !== undefined) releaseSupervisorLock(cwd, process.pid, epoch);
      epoch = undefined;
    },
    isListening: () => server.isListening(),
    credentialFile: (slug: string) => credentialFile(dir, slug),
  };
}
export type Supervisor = ReturnType<typeof createSupervisor>;
