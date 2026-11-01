import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { durableDir, durableRegistryPath, durableRuntimeDir } from '../paths.ts';
import type { DeliveryLedger, DurableRegistry, DurableSubscription, ParkedWake, SupervisorLock } from './durable-types.ts';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text, { mode: 0o600 });
  renameSync(temporary, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort: some test tmp roots ignore mode.
  }
}

function emptyRegistry(workspaceCwd: string): DurableRegistry {
  return { version: 1, workspaceCwd, subscriptions: [] };
}

function parseRegistry(raw: unknown, workspaceCwd: string): DurableRegistry {
  const value = raw as Partial<DurableRegistry> | null;
  if (typeof value !== 'object' || value === null || value.version !== 1 || !Array.isArray(value.subscriptions)) return emptyRegistry(workspaceCwd);
  const cwd = typeof value.workspaceCwd === 'string' && value.workspaceCwd !== '' ? value.workspaceCwd : workspaceCwd;
  const subscriptions = value.subscriptions.filter(
    (item): item is DurableSubscription => typeof item === 'object' && item !== null && typeof (item as DurableSubscription).id === 'string' && typeof (item as DurableSubscription).name === 'string',
  );
  return { version: 1, workspaceCwd: cwd, subscriptions };
}

export function readRegistry(cwd: string): DurableRegistry {
  const path = durableRegistryPath(cwd);
  if (!existsSync(path)) return emptyRegistry(cwd);
  try {
    return parseRegistry(JSON.parse(readFileSync(path, 'utf8')), cwd);
  } catch {
    return emptyRegistry(cwd);
  }
}

export function writeRegistry(cwd: string, registry: DurableRegistry): void {
  writeAtomic(durableRegistryPath(cwd), `${JSON.stringify(registry, null, 2)}\n`);
}

export function dropExpired(registry: DurableRegistry, now = Date.now()): DurableRegistry {
  return { ...registry, subscriptions: registry.subscriptions.filter((sub) => sub.expiresAt > now) };
}

/**
 * Re-subscribe rule on disk: same name returns created:false and does not rewrite.
 * New names upsert by id (replace an existing id).
 */
export function createDesired(cwd: string, sub: DurableSubscription, workspaceCwd = cwd): { created: boolean } {
  const current = dropExpired(readRegistry(cwd));
  if (current.subscriptions.some((entry) => entry.name === sub.name)) return { created: false };
  const next: DurableRegistry = {
    version: 1,
    workspaceCwd: current.workspaceCwd || workspaceCwd,
    subscriptions: [...current.subscriptions.filter((entry) => entry.id !== sub.id), sub],
  };
  writeRegistry(cwd, next);
  return { created: true };
}

/** Always writes the id (create success path and supervisor once-removal companions). */
export function upsertDesired(cwd: string, sub: DurableSubscription, workspaceCwd = cwd): void {
  const current = dropExpired(readRegistry(cwd));
  const without = current.subscriptions.filter((entry) => entry.id !== sub.id && entry.name !== sub.name);
  writeRegistry(cwd, { version: 1, workspaceCwd: current.workspaceCwd || workspaceCwd, subscriptions: [...without, sub] });
}

export function removeDesired(cwd: string, id: string): void {
  const current = readRegistry(cwd);
  const subscriptions = current.subscriptions.filter((entry) => entry.id !== id);
  if (subscriptions.length === current.subscriptions.length) return;
  writeRegistry(cwd, { ...current, subscriptions });
}

export function supervisorLockPath(cwd: string): string {
  return join(durableRuntimeDir(cwd), 'supervisor.lock');
}

export function deliveryPath(cwd: string, subscriptionId: string): string {
  return join(durableRuntimeDir(cwd), 'delivery', `${subscriptionId}.json`);
}

export function inboxDir(cwd: string): string {
  return join(durableRuntimeDir(cwd), 'inbox');
}

export function readLock(cwd: string): SupervisorLock | undefined {
  try {
    const value = JSON.parse(readFileSync(supervisorLockPath(cwd), 'utf8')) as Partial<SupervisorLock> | null;
    if (typeof value !== 'object' || value === null || !Number.isInteger(value.pid) || !Number.isFinite(value.startedAt)) return undefined;
    return { pid: value.pid as number, startedAt: value.startedAt as number };
  } catch {
    return undefined;
  }
}

export function isSupervisorLive(cwd: string): boolean {
  const lock = readLock(cwd);
  return lock !== undefined && alive(lock.pid);
}

/**
 * Takes supervisor.lock when free or stale. Second live start returns alreadyRunning.
 * Only creates with O_EXCL (`wx`); never overwrites via rename. Stale path: re-read,
 * confirm the same dead pid, unlink, retry wx in a bounded loop.
 * Does not bind ports; caller owns that after a successful acquire.
 */
export function acquireSupervisorLock(cwd: string, pid = process.pid, startedAt = Date.now()): { acquired: true } | { acquired: false; alreadyRunning: true; pid: number } {
  mkdirSync(durableRuntimeDir(cwd), { recursive: true, mode: 0o700 });
  const path = supervisorLockPath(cwd);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    try {
      writeFileSync(path, `${JSON.stringify({ pid, startedAt })}\n`, { flag: 'wx', mode: 0o600 });
      return { acquired: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const lock = readLock(cwd);
    if (lock !== undefined && alive(lock.pid)) return { acquired: false, alreadyRunning: true, pid: lock.pid };
    // Stale or unreadable: confirm the dead pid is unchanged, then unlink and retry wx.
    const still = readLock(cwd);
    if (lock !== undefined) {
      if (still === undefined || still.pid !== lock.pid || alive(still.pid)) continue;
      rmSync(path, { force: true });
      continue;
    }
    if (still !== undefined && alive(still.pid)) return { acquired: false, alreadyRunning: true, pid: still.pid };
    rmSync(path, { force: true });
  }
  const lock = readLock(cwd);
  if (lock !== undefined && alive(lock.pid)) return { acquired: false, alreadyRunning: true, pid: lock.pid };
  // Exhausted exclusive attempts; refuse non-exclusive overwrite (would race a live taker).
  if (lock !== undefined) return { acquired: false, alreadyRunning: true, pid: lock.pid };
  return { acquired: false, alreadyRunning: true, pid: 0 };
}

export function releaseSupervisorLock(cwd: string, pid = process.pid): void {
  const lock = readLock(cwd);
  if (lock === undefined || lock.pid !== pid) return;
  rmSync(supervisorLockPath(cwd), { force: true });
}

export function readDelivery(cwd: string, subscriptionId: string): DeliveryLedger | undefined {
  try {
    const value = JSON.parse(readFileSync(deliveryPath(cwd, subscriptionId), 'utf8')) as Partial<DeliveryLedger> | null;
    if (typeof value !== 'object' || value === null || value.subscriptionId !== subscriptionId || typeof value.lastClaimKey !== 'string' || !Number.isFinite(value.lastClaimAt)) return undefined;
    return value as DeliveryLedger;
  } catch {
    return undefined;
  }
}

export function writeDelivery(cwd: string, ledger: DeliveryLedger): void {
  writeAtomic(deliveryPath(cwd, ledger.subscriptionId), `${JSON.stringify(ledger, null, 2)}\n`);
}

/**
 * Claims a fire key. Returns claimed:false when the ledger already holds this key (idempotent skip).
 * Callers that claim-before-deliver for once wakes should clear the once claim on deliver failure
 * so reconcile can retry (at-least-once); lastError stays on the ledger.
 */
export function claimDelivery(cwd: string, subscriptionId: string, claimKey: string, at = Date.now()): { claimed: boolean; ledger: DeliveryLedger } {
  const existing = readDelivery(cwd, subscriptionId);
  if (existing !== undefined && existing.lastClaimKey === claimKey) return { claimed: false, ledger: existing };
  const ledger: DeliveryLedger = { subscriptionId, lastClaimKey: claimKey, lastClaimAt: at };
  writeDelivery(cwd, ledger);
  return { claimed: true, ledger };
}

export function registryMtimeMs(cwd: string): number | undefined {
  try {
    return statSync(durableRegistryPath(cwd)).mtimeMs;
  } catch {
    return undefined;
  }
}

export function ensureDurableDirs(cwd: string): void {
  mkdirSync(durableDir(cwd), { recursive: true, mode: 0o700 });
  mkdirSync(durableRuntimeDir(cwd), { recursive: true, mode: 0o700 });
  mkdirSync(join(durableRuntimeDir(cwd), 'delivery'), { recursive: true, mode: 0o700 });
  mkdirSync(inboxDir(cwd), { recursive: true, mode: 0o700 });
}

function isParkedWake(value: unknown): value is ParkedWake {
  const candidate = value as Partial<ParkedWake> | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.subscriptionId === 'string' &&
    typeof candidate.name === 'string' &&
    Number.isFinite(candidate.at) &&
    typeof candidate.content === 'string' &&
    (candidate.ownerSessionFile === undefined || typeof candidate.ownerSessionFile === 'string')
  );
}

export function drainInbox(cwd: string, ownerSessionFile?: string): ParkedWake[] {
  const dir = inboxDir(cwd);
  if (!existsSync(dir)) return [];
  const drained: ParkedWake[] = [];
  for (const name of readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .toSorted()) {
    const path = join(dir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      rmSync(path, { force: true });
      continue;
    }
    if (!isParkedWake(parsed)) {
      rmSync(path, { force: true });
      continue;
    }
    if (ownerSessionFile !== undefined && parsed.ownerSessionFile !== undefined && parsed.ownerSessionFile !== ownerSessionFile) continue;
    rmSync(path, { force: true });
    drained.push(parsed);
  }
  return drained;
}
