import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { durableRegistryPath, durableRuntimeDir } from '../paths.ts';
import { parseCron } from './cron.ts';
import type { ArmStatus, DurableRegistry, DurableSubscription, PendingEvent, StoredSubscription, SupervisorLock } from './durable-types.ts';
import { routineSlug } from './webhook.ts';

export function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const absolute = resolve(path);
    return absolute === dirname(absolute) ? absolute : join(canonicalPath(dirname(absolute)), absolute.slice(dirname(absolute).length + 1));
  }
}

export function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

const runtime = (cwd: string) => durableRuntimeDir(canonicalPath(cwd));
export const supervisorLockPath = (cwd: string) => join(runtime(cwd), 'supervisor.lock');
const registryLockPath = (cwd: string) => join(runtime(cwd), 'registry.lock');
export const ownerLockPath = (cwd: string, id: string) => join(runtime(cwd), `owner-${createHash('sha256').update(id).digest('hex')}.lock`);

export type Lease = { token: string; release: () => void };

/** Publish a nonempty directory atomically. Recovery removes only the dead holder's token. */
export function acquireLease(path: string): Lease | undefined {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const token = `${process.pid}-${randomUUID()}`;
  const temporary = `${path}.${token}.tmp`;
  mkdirSync(temporary, { mode: 0o700 });
  try {
    writeFileSync(join(temporary, token), '', { mode: 0o600 });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        renameSync(temporary, path);
        return {
          token,
          release: () => {
            rmSync(join(path, token), { force: true });
            try {
              rmdirSync(path);
            } catch (error) {
              if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
            }
          },
        };
      } catch (error) {
        if (!['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
      let holders: string[];
      try {
        holders = readdirSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      for (const holder of holders) {
        const pid = Number(/^(\d+)-[a-f0-9-]+$/.exec(holder)?.[1]);
        if (!Number.isInteger(pid)) throw new Error(`Invalid subscription lock ${path}. Retain it for diagnosis.`);
        if (alive(pid)) return undefined;
        rmSync(join(path, holder), { force: true });
      }
      try {
        rmdirSync(path);
      } catch (error) {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
    }
    return undefined;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function ownerIsLive(cwd: string, sessionId: string): boolean {
  const path = ownerLockPath(cwd, sessionId);
  try {
    const holders = readdirSync(path);
    for (const holder of holders) {
      const pid = Number(/^(\d+)-[a-f0-9-]+$/.exec(holder)?.[1]);
      if (Number.isInteger(pid) && alive(pid)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function withRegistryLock<T>(cwd: string, work: () => T): T {
  const deadline = performance.now() + 5_000;
  do {
    const lease = acquireLease(registryLockPath(cwd));
    if (lease !== undefined) {
      try {
        return work();
      } finally {
        lease.release();
      }
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  } while (performance.now() < deadline);
  throw new Error(`Subscription registry is busy in ${cwd}. Retry when the live writer finishes.`);
}

function validSubscription(value: unknown): value is DurableSubscription {
  if (typeof value !== 'object' || value === null) return false;
  const sub = value as DurableSubscription;
  if (typeof sub.id !== 'string' || !/^sub-[a-zA-Z0-9-]+$/.test(sub.id) || typeof sub.name !== 'string' || !sub.name.trim() || !Number.isFinite(sub.createdAt) || !Number.isFinite(sub.expiresAt)) return false;
  if ((sub.ownerSessionId !== undefined && (typeof sub.ownerSessionId !== 'string' || !sub.ownerSessionId)) || (sub.ownerSessionFile !== undefined && typeof sub.ownerSessionFile !== 'string')) return false;
  const c = sub.config;
  if (typeof c !== 'object' || c === null) return false;
  if (c.kind === 'github') {
    const t = c.target;
    return (
      typeof t === 'object' &&
      t !== null &&
      (t.scope === 'pr'
        ? typeof t.prUrl === 'string' && /^https:\/\/[^\s/]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+\/?$/.test(t.prUrl)
        : (t.scope === 'repo' || t.scope === 'author') &&
          typeof t.repo === 'string' &&
          /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(t.repo) &&
          (t.scope !== 'author' || (typeof t.author === 'string' && /^(?:@me|[A-Za-z0-9](?:[A-Za-z0-9-]|\[bot\]|\/)*)$/.test(t.author))))
    );
  }
  if (typeof c.prompt !== 'string') return false;
  if (c.kind === 'webhook') {
    try {
      return typeof c.slug === 'string' && routineSlug(sub.name) === c.slug;
    } catch {
      return false;
    }
  }
  if (c.kind !== 'timer' || typeof c.once !== 'boolean' || !['wake_self', 'new_session'].includes(c.strategy)) return false;
  if ((c.cron === undefined) === (c.delaySeconds === undefined)) return false;
  if (c.cron !== undefined) {
    try {
      parseCron(c.cron);
    } catch {
      return false;
    }
  }
  return c.delaySeconds === undefined || (Number.isInteger(c.delaySeconds) && c.delaySeconds >= 1);
}

function emptyRegistry(cwd: string): DurableRegistry {
  return { version: 2, workspaceCwd: canonicalPath(cwd), revision: 0, subscriptions: [], pending: [] };
}

function migratedOwner(sub: DurableSubscription): string | undefined {
  if (sub.ownerSessionId !== undefined) return sub.ownerSessionId;
  if (sub.ownerSessionFile === undefined) return undefined;
  try {
    const header = JSON.parse(readFileSync(sub.ownerSessionFile, 'utf8').split('\n')[0] ?? '');
    return header.type === 'session' && typeof header.id === 'string' && header.id ? header.id : undefined;
  } catch {
    return undefined;
  }
}

function loadRegistry(cwd: string): DurableRegistry {
  const path = durableRegistryPath(canonicalPath(cwd));
  if (!existsSync(path)) return emptyRegistry(cwd);
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof raw !== 'object' || raw === null || ![1, 2].includes(raw.version) || !Array.isArray(raw.subscriptions) || !raw.subscriptions.every(validSubscription)) throw new Error('invalid subscriptions');
    if (typeof raw.workspaceCwd !== 'string' || canonicalPath(raw.workspaceCwd) !== canonicalPath(cwd)) throw new Error('Registry belongs to a different workspace.');
    if (raw.version === 1) {
      return {
        ...emptyRegistry(cwd),
        revision: 1,
        subscriptions: raw.subscriptions.map((sub: DurableSubscription) => {
          const { detachedDelivery: _legacy, ...config } = sub;
          const ownerSessionId = migratedOwner(sub);
          return { ...config, ...(ownerSessionId === undefined ? { lastError: { at: Date.now(), text: 'Owner session ID unavailable. Recreate this subscription.' } } : { ownerSessionId }), revision: 1, lifecycle: 'active' };
        }),
      };
    }
    if (!Number.isInteger(raw.revision) || raw.revision < 0 || !Array.isArray(raw.pending)) throw new Error('invalid registry revision or pending events');
    const ids = new Set<string>();
    for (const sub of raw.subscriptions) {
      if (ids.has(sub.id) || !Number.isInteger(sub.revision) || !['active', 'completed', 'cancelled', 'expired'].includes(sub.lifecycle)) throw new Error('invalid subscription lifecycle');
      ids.add(sub.id);
      if (sub.lastOccurrence !== undefined && typeof sub.lastOccurrence !== 'string') throw new Error('invalid occurrence');
      for (const note of [sub.lastEvent, sub.lastError, sub.lastOutcome]) if (note !== undefined && (typeof note.text !== 'string' || !Number.isFinite(note.at))) throw new Error('invalid subscription status');
    }
    const eventIds = new Set<string>();
    for (const event of raw.pending) {
      if (
        typeof event.id !== 'string' ||
        eventIds.has(event.id) ||
        !ids.has(event.subscriptionId) ||
        !Number.isFinite(event.acceptedAt) ||
        typeof event.content !== 'string' ||
        (event.claim !== undefined && (!Number.isInteger(event.claim.pid) || event.claim.pid <= 0 || typeof event.claim.token !== 'string' || !['live', 'detached'].includes(event.claim.mode))) ||
        (event.attempts !== undefined && (!Number.isInteger(event.attempts) || event.attempts < 0)) ||
        (event.retryAt !== undefined && !Number.isFinite(event.retryAt))
      )
        throw new Error('invalid pending event');
      eventIds.add(event.id);
    }
    return { version: 2, workspaceCwd: canonicalPath(cwd), revision: raw.revision, subscriptions: raw.subscriptions, pending: raw.pending };
  } catch (error) {
    throw new Error(`Cannot read authoritative subscription registry ${path}. Retain the file for diagnosis. ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function readRegistry(cwd: string): DurableRegistry {
  const path = durableRegistryPath(canonicalPath(cwd));
  const registry = loadRegistry(cwd);
  if (existsSync(path) && JSON.parse(readFileSync(path, 'utf8')).version === 1) {
    return withRegistryLock(cwd, () => {
      const current = loadRegistry(cwd);
      writeAtomic(path, current);
      return current;
    });
  }
  return registry;
}

function transaction<T>(cwd: string, change: (registry: DurableRegistry) => T): T {
  return withRegistryLock(cwd, () => {
    const registry = loadRegistry(cwd);
    const before = JSON.stringify(registry);
    const result = change(registry);
    if (JSON.stringify(registry) !== before) {
      registry.revision += 1;
      writeAtomic(durableRegistryPath(canonicalPath(cwd)), registry);
    }
    return result;
  });
}

export const isDesired = (sub: StoredSubscription, now = Date.now()) => sub.lifecycle === 'active' && sub.expiresAt > now;
export function visibleSubscriptions(registry: DurableRegistry, now = Date.now()): StoredSubscription[] {
  return registry.subscriptions.filter((sub) => sub.lifecycle !== 'cancelled' && (isDesired(sub, now) || registry.pending.some((event) => event.subscriptionId === sub.id) || sub.lastOutcome !== undefined));
}

export function createDesired(cwd: string, sub: DurableSubscription): { created: boolean; subscription: StoredSubscription } {
  if (!validSubscription(sub)) throw new Error('Invalid subscription configuration.');
  return transaction(cwd, (registry) => {
    const existing = registry.subscriptions.find((entry) => isDesired(entry) && entry.name === sub.name);
    if (existing !== undefined) return { created: false, subscription: existing };
    if (registry.subscriptions.some((entry) => entry.id === sub.id)) throw new Error(`Subscription identity ${sub.id} already exists.`);
    const config = sub.config;
    if (config.kind === 'webhook') {
      const clash = registry.subscriptions.find((entry) => isDesired(entry) && entry.config.kind === 'webhook' && entry.config.slug === config.slug);
      if (clash !== undefined) throw new Error(`Routine "${clash.name}" already uses the slug ${config.slug}.`);
    }
    const { detachedDelivery: _legacy, ...input } = sub;
    const stored: StoredSubscription = { ...input, revision: registry.revision + 1, lifecycle: 'active' };
    registry.subscriptions.push(stored);
    return { created: true, subscription: stored };
  });
}

export function cancelDesired(cwd: string, key: string): StoredSubscription | undefined {
  return transaction(cwd, (registry) => {
    const candidates = visibleSubscriptions(registry);
    const sub = candidates.find((entry) => entry.id === key) ?? candidates.find((entry) => entry.name === key && isDesired(entry)) ?? candidates.find((entry) => entry.name === key);
    if (sub === undefined) return undefined;
    sub.lifecycle = 'cancelled';
    delete sub.lastOutcome;
    registry.pending = registry.pending.filter((event) => event.subscriptionId !== sub.id);
    return sub;
  });
}

export function expireDesired(cwd: string, at = Date.now()): void {
  transaction(cwd, (registry) => {
    for (const sub of registry.subscriptions) if (sub.lifecycle === 'active' && sub.expiresAt <= at) sub.lifecycle = 'expired';
  });
}

export const MAX_PENDING_PER_SUBSCRIPTION = 20;

export function acceptEvent(cwd: string, subscriptionId: string, occurrence: string, content: string, at = Date.now()): 'accepted' | 'duplicate' | 'inactive' {
  return transaction(cwd, (registry) => {
    const sub = registry.subscriptions.find((entry) => entry.id === subscriptionId);
    if (sub === undefined || !isDesired(sub, at)) return 'inactive';
    if (sub.lastOccurrence === occurrence || registry.pending.some((event) => event.id === occurrence)) return 'duplicate';
    const forSub = registry.pending.filter((event) => event.subscriptionId === subscriptionId);
    if (forSub.length >= MAX_PENDING_PER_SUBSCRIPTION) {
      const oldest = forSub[0];
      if (oldest !== undefined) {
        registry.pending = registry.pending.filter((event) => event.id !== oldest.id);
      }
    }
    registry.pending.push({ id: occurrence, subscriptionId, acceptedAt: at, content });
    sub.lastOccurrence = occurrence;
    sub.lastEvent = { at, text: 'accepted' };
    delete sub.lastError;
    if (sub.config.kind === 'timer' && sub.config.once) sub.lifecycle = 'completed';
    return 'accepted';
  });
}

export function deliverOwner(cwd: string, ownerSessionId: string, eligible: () => boolean, send: (sub: StoredSubscription, event: PendingEvent) => void): void {
  transaction(cwd, (registry) => {
    for (const event of [...registry.pending]) {
      const sub = registry.subscriptions.find((entry) => entry.id === event.subscriptionId);
      if (sub === undefined || sub.ownerSessionId !== ownerSessionId || sub.lifecycle === 'cancelled' || (sub.config.kind === 'timer' && sub.config.strategy === 'new_session')) continue;
      if (!eligible()) return;
      // Pi enqueue and disk acknowledgement cannot commit atomically. A crash can replay this event.
      send(sub, event);
      registry.pending = registry.pending.filter((entry) => entry.id !== event.id);
    }
  });
}

export function startFresh(
  cwd: string,
  eventId: string,
  ownerSessionId: string | undefined,
  eligible: () => boolean,
  run: (sub: StoredSubscription, event: PendingEvent) => Promise<void> | void,
): { token: string; result: Promise<void> } | undefined {
  const claim = transaction(cwd, (registry) => {
    const event = registry.pending.find((entry) => entry.id === eventId);
    const sub = registry.subscriptions.find((entry) => entry.id === event?.subscriptionId);
    if (
      event === undefined ||
      sub === undefined ||
      sub.lifecycle === 'cancelled' ||
      sub.config.kind !== 'timer' ||
      sub.config.strategy !== 'new_session' ||
      sub.ownerSessionId === undefined ||
      (event.claim !== undefined && alive(event.claim.pid)) ||
      (event.retryAt !== undefined && Date.now() < event.retryAt) ||
      Date.now() >= sub.expiresAt ||
      !eligible()
    )
      return undefined;
    if (ownerSessionId === undefined ? sub.ownerSessionId !== undefined && ownerIsLive(cwd, sub.ownerSessionId) : sub.ownerSessionId !== ownerSessionId) return undefined;
    const token = randomUUID();
    event.claim = { pid: process.pid, token, mode: ownerSessionId === undefined ? 'detached' : 'live' };
    return { token, sub, event };
  });
  if (claim === undefined) return undefined;
  let result: Promise<void>;
  try {
    result = Promise.resolve(run(claim.sub, claim.event));
  } catch (error) {
    result = Promise.reject(error);
  }
  return { token: claim.token, result };
}

export function finishFresh(cwd: string, eventId: string, token: string, error?: unknown): void {
  transaction(cwd, (registry) => {
    const event = registry.pending.find((entry) => entry.id === eventId && entry.claim?.token === token);
    if (event === undefined) return;
    const sub = registry.subscriptions.find((entry) => entry.id === event.subscriptionId);
    if (sub === undefined) return;
    if (error !== undefined) {
      const attempts = (event.attempts ?? 0) + 1;
      const MAX_ATTEMPTS = 5;
      sub.lastError = { at: Date.now(), text: error instanceof Error ? error.message : String(error) };
      delete event.claim;
      event.attempts = attempts;
      if (attempts >= MAX_ATTEMPTS || Date.now() >= sub.expiresAt) {
        registry.pending = registry.pending.filter((entry) => entry.id !== eventId);
      } else {
        const backoffMs = Math.min(60_000, 250 * 2 ** (attempts - 1));
        event.retryAt = Date.now() + backoffMs;
      }
    } else {
      sub.lastOutcome = { at: Date.now(), text: event.claim?.mode === 'live' ? 'live Task callback accepted' : 'detached run completed' };
      delete sub.lastError;
      registry.pending = registry.pending.filter((entry) => entry.id !== eventId);
    }
  });
}

export function clearError(cwd: string, id: string): void {
  transaction(cwd, (registry) => {
    const sub = registry.subscriptions.find((entry) => entry.id === id);
    if (sub !== undefined) delete sub.lastError;
  });
}

export function recordError(cwd: string, id: string, error: unknown): void {
  const text = error instanceof Error ? error.message : String(error);
  transaction(cwd, (registry) => {
    const sub = registry.subscriptions.find((entry) => entry.id === id);
    if (sub !== undefined && sub.lastError?.text !== text) {
      sub.lastError = { at: Date.now(), text };
    }
  });
}

export function readLock(cwd: string): SupervisorLock | undefined {
  try {
    const value = JSON.parse(readFileSync(supervisorLockPath(cwd), 'utf8'));
    return Number.isInteger(value.pid) && value.pid > 0 && Number.isFinite(value.startedAt) && typeof value.epoch === 'string' && value.epoch !== '' ? { pid: value.pid, startedAt: value.startedAt, epoch: value.epoch } : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`Cannot read supervisor lock ${supervisorLockPath(cwd)}. ${String(error)}`);
  }
}
export function isSupervisorLive(cwd: string): boolean {
  const lock = readLock(cwd);
  return lock !== undefined && alive(lock.pid);
}
export function acquireSupervisorLock(cwd: string, pid = process.pid, startedAt = Date.now()): { acquired: true } | { acquired: false; alreadyRunning: true; pid: number } {
  return withRegistryLock(cwd, () => {
    try {
      const raw = JSON.parse(readFileSync(supervisorLockPath(cwd), 'utf8'));
      if (Number.isInteger(raw.pid) && raw.pid > 0 && alive(raw.pid)) {
        if (typeof raw.epoch === 'string' && raw.epoch !== '') {
          return { acquired: false, alreadyRunning: true, pid: raw.pid };
        }
        try {
          process.kill(raw.pid, 'SIGTERM');
        } catch {}
        const deadline = Date.now() + 1_000;
        while (Date.now() < deadline && alive(raw.pid)) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
        }
        if (alive(raw.pid)) {
          return { acquired: false, alreadyRunning: true, pid: raw.pid };
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Corrupted lock file: overwrite with clean lock
      }
    }
    writeAtomic(supervisorLockPath(cwd), { pid, startedAt, epoch: randomUUID() });
    return { acquired: true };
  });
}
export function releaseSupervisorLock(cwd: string, pid = process.pid, epoch?: string): void {
  withRegistryLock(cwd, () => {
    const lock = readLock(cwd);
    if (lock?.pid === pid && (epoch === undefined || epoch === lock.epoch)) rmSync(supervisorLockPath(cwd), { force: true });
  });
}

const armPath = (cwd: string, id: string) => join(runtime(cwd), 'arms', `${createHash('sha256').update(id).digest('hex')}.json`);
export function writeArm(cwd: string, status: ArmStatus): void {
  writeAtomic(armPath(cwd, status.subscriptionId), status);
}
export function readArm(cwd: string, sub: StoredSubscription): ArmStatus | undefined {
  const lock = readLock(cwd);
  if (lock === undefined || !alive(lock.pid)) return undefined;
  try {
    const status = JSON.parse(readFileSync(armPath(cwd, sub.id), 'utf8')) as ArmStatus;
    return status.subscriptionId === sub.id &&
      status.revision === sub.revision &&
      status.epoch === lock.epoch &&
      ((status.state === 'error' && typeof status.message === 'string') || (status.state === 'ready' && (status.url === undefined || typeof status.url === 'string')))
      ? status
      : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
