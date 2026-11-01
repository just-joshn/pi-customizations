import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { durableDir, durableRegistryPath, durableRuntimeDir } from '../paths.ts';
import type { DeliveryLedger, DurableRegistry, DurableSubscription, SupervisorLock } from './durable-types.ts';

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
  const subscriptions = value.subscriptions.filter((item): item is DurableSubscription => typeof item === 'object' && item !== null && typeof (item as DurableSubscription).id === 'string' && typeof (item as DurableSubscription).name === 'string');
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
 * Does not bind ports; caller owns that after a successful acquire.
 */
export function acquireSupervisorLock(cwd: string, pid = process.pid, startedAt = Date.now()): { acquired: true } | { acquired: false; alreadyRunning: true; pid: number } {
  mkdirSync(durableRuntimeDir(cwd), { recursive: true, mode: 0o700 });
  const path = supervisorLockPath(cwd);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, `${JSON.stringify({ pid, startedAt })}\n`, { flag: 'wx', mode: 0o600 });
      return { acquired: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const lock = readLock(cwd);
    if (lock !== undefined && alive(lock.pid)) return { acquired: false, alreadyRunning: true, pid: lock.pid };
    if (lock !== undefined) {
      const still = readLock(cwd);
      if (still !== undefined && still.pid === lock.pid) rmSync(path, { force: true });
    } else {
      rmSync(path, { force: true });
    }
  }
  const lock = readLock(cwd);
  if (lock !== undefined && alive(lock.pid)) return { acquired: false, alreadyRunning: true, pid: lock.pid };
  writeAtomic(path, `${JSON.stringify({ pid, startedAt })}\n`);
  return { acquired: true };
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
 * Once keys that are already claimed stay claimed forever so a crash after claim does not re-spawn.
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
