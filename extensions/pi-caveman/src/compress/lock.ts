import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, mkdir, open, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { hasCode, isSymlink, removeQuietly, resolvePath } from './io.ts';
import { backupPathFor, IS_WINDOWS, stateBaseDir } from './paths.ts';

// Must outlast a legitimate holder's worst case (MAX_RETRIES+1 model calls).
export const LOCK_WAIT_SECONDS = 900;
export const LOCK_POLL_INTERVAL = 1.0;

const LOCK_FLAGS = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0);

/** Keyed on the backup path so two sources sharing a backup also share a lock. */
export async function lockPathFor(filepath: string): Promise<string> {
  const backup = backupPathFor(await resolvePath(filepath));
  const digest = createHash('sha256').update(backup, 'utf8').digest('hex').slice(0, 16);
  return join(stateBaseDir('locks'), `${digest}.lock`);
}

export class LockTimeoutError extends Error {
  override name = 'LockTimeoutError';
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the pid exists under another user, so only ESRCH is dead.
    return !hasCode(error, 'ESRCH');
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolveSleep, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolveSleep();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function prepareLockDir(lockPath: string): Promise<void> {
  const lockDir = dirname(lockPath);
  if (await isSymlink(lockDir)) throw new Error(`Refusing to use lock directory through a symlink: ${lockDir}`);
  await mkdir(lockDir, { recursive: true });
  // Tightening the mode is hardening only; a filesystem without chmod support still locks correctly.
  if (!IS_WINDOWS) await chmod(lockDir, 0o700).catch(() => undefined);
  if (await isSymlink(lockPath)) throw new Error(`Refusing to open lock file through a symlink: ${lockPath}`);
}

/** True when this process created the lock file; false when another holder has it. */
async function tryAcquire(lockPath: string): Promise<boolean> {
  try {
    const handle = await open(lockPath, LOCK_FLAGS, 0o600);
    try {
      await handle.writeFile(String(process.pid));
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if (hasCode(error, 'EEXIST')) return false;
    throw error;
  }
}

/** True when the lock's recorded holder is dead and the file was removed. */
async function reclaimIfStale(lockPath: string): Promise<boolean> {
  // The holder may release between our open and this read; an unreadable lock is treated as live.
  const holder = Number.parseInt(await readFile(lockPath, 'utf8').catch(() => ''), 10);
  if (!Number.isInteger(holder) || holder <= 0 || isProcessAlive(holder)) return false;
  await removeQuietly(lockPath);
  return true;
}

async function acquire(filepath: string, lockPath: string, signal: AbortSignal | undefined): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_SECONDS * 1000;
  while (!(await tryAcquire(lockPath))) {
    if (await reclaimIfStale(lockPath)) continue;
    if (Date.now() >= deadline) {
      throw new LockTimeoutError(`Another caveman-compress run appears to be compressing ${filepath} (lock: ${lockPath}). Giving up after ${LOCK_WAIT_SECONDS}s — retry once it finishes.`);
    }
    await sleep(LOCK_POLL_INTERVAL * 1000, signal);
  }
}

/**
 * Exclusive-create lock file. Unlike upstream's flock, a crashed holder leaves
 * the file behind, so a lock whose recorded pid is dead is reclaimed.
 */
export async function withFileLock<T>(filepath: string, signal: AbortSignal | undefined, body: () => Promise<T>): Promise<T> {
  const lockPath = await lockPathFor(filepath);
  await prepareLockDir(lockPath);
  await acquire(filepath, lockPath, signal);
  try {
    return await body();
  } finally {
    await removeQuietly(lockPath);
  }
}
