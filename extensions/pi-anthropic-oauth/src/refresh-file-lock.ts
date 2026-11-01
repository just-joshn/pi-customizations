import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Claude proper-lockfile contention code for refresh lock retries. */
export const REFRESH_LOCK_ELOCKED = 'ELOCKED';

// Fixture claude/fixtures/refresh-lifecycle-2.1.312.json records ELOCKED retries up to 5,
// then failure, with a 1000+random*1000 ms delay. A 2.1.316 holder loop keeps waiting
// on ELOCKED and runs unlocked after other errors. This helper follows the fixture.
export const REFRESH_LOCK_MAX_RETRIES = 5;

// proper-lockfile drops a lock directory whose mtime is older than `stale`.
// This lock does not touch mtime while held, so 30s stays above the 15s refresh
// timeout. A crashed holder becomes stealable. A live refresh does not.
export const REFRESH_LOCK_STALE_MS = 30_000;

const REFRESH_LOCK_FILENAME = 'claude-subscription-refresh.lock';

export type RefreshFileLockOptions = {
  /** Max ELOCKED retries after the first attempt. Default 5. */
  retries?: number;
  /** Delay before a retry. Default matches Claude: 1000 + random * 1000 ms. */
  retryDelayMs?: () => number;
  /** Lock directory. Default is `<directory of target>/claude-subscription-refresh.lock`. */
  lockPath?: string;
  /** Steal a lock directory older than this. `0` disables stealing. Default 30s. */
  staleMs?: number;
};

function lockedError(file: string): NodeJS.ErrnoException {
  return Object.assign(new Error('Lock file is already being held'), {
    code: REFRESH_LOCK_ELOCKED,
    file,
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function defaultRefreshLockRetryDelayMs(): number {
  return 1000 + Math.random() * 1000;
}

export function refreshLockPathFor(targetPath: string): string {
  return join(dirname(targetPath), REFRESH_LOCK_FILENAME);
}

async function lockAbandoned(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const info = await stat(lockPath);
    return info.mtimeMs < Date.now() - staleMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}

/**
 * Cross-process exclusive section via a mkdir lock directory (proper-lockfile shape).
 * Retries a fresh ELOCKED up to `retries` times with Claude's backoff.
 * A lock directory older than `staleMs` is removed and taken.
 * Does not replace the in-process refresh latch.
 */
export async function withRefreshFileLock<T>(
  targetPath: string,
  work: () => Promise<T>,
  options: RefreshFileLockOptions = {},
  signal?: AbortSignal,
): Promise<T> {
  const lockPath = options.lockPath ?? refreshLockPathFor(targetPath);
  const retries = options.retries ?? REFRESH_LOCK_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? defaultRefreshLockRetryDelayMs;
  const staleMs = options.staleMs ?? REFRESH_LOCK_STALE_MS;

  let attempt = 0;
  for (;;) {
    signal?.throwIfAborted();
    try {
      await mkdir(lockPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        if (staleMs > 0 && (await lockAbandoned(lockPath, staleMs))) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
        if (attempt >= retries) throw lockedError(targetPath);
        attempt += 1;
        await sleep(retryDelayMs(), signal);
        continue;
      }
      throw error;
    }

    try {
      return await work();
    } finally {
      await rm(lockPath, { recursive: true, force: true });
    }
  }
}
