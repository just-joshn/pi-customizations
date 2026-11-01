import { mkdir, rm } from 'node:fs/promises';

/** Claude proper-lockfile contention code for refresh lock retries. */
export const REFRESH_LOCK_ELOCKED = 'ELOCKED';

/** Contended retries from Claude refresh-lifecycle fixture (≤5). */
export const REFRESH_LOCK_MAX_RETRIES = 5;

export type RefreshFileLockOptions = {
  /** Max ELOCKED retries after the first attempt. Default 5. */
  retries?: number;
  /** Delay before a retry. Default matches Claude: 1000 + random * 1000 ms. */
  retryDelayMs?: () => number;
  /** Override lock directory path. Default `${targetPath}.lock`. */
  lockPath?: string;
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
  return `${targetPath}.lock`;
}

/**
 * Cross-process exclusive section via a mkdir lock directory (proper-lockfile shape).
 * Retries ELOCKED up to `retries` times with Claude's backoff. Does not replace the
 * in-process refresh latch; callers should keep singleflight outside this helper.
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

  let attempt = 0;
  for (;;) {
    signal?.throwIfAborted();
    try {
      await mkdir(lockPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
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
