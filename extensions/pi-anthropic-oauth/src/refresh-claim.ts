import { createHash } from 'node:crypto';
import { mkdir, open, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Error code thrown when claim retries run out. Matches Claude's proper-lockfile contention code. */
export const REFRESH_CLAIM_ELOCKED = 'ELOCKED';

// Fixture claude/fixtures/refresh-lifecycle-2.1.312.json records ELOCKED retries up to 5,
// then failure, with a 1000+random*1000 ms delay. A 2.1.316 holder loop keeps waiting
// on ELOCKED and runs unlocked after other errors. This helper follows the fixture.
export const REFRESH_CLAIM_MAX_RETRIES = 5;

export const REFRESH_TIMEOUT_MS = 15_000;

export const REFRESH_CLAIM_STALE_MS = 2 * REFRESH_TIMEOUT_MS;

const CLAIM_RETENTION_MS = 24 * 60 * 60 * 1000;

export type RefreshClaimOptions = {
  /** Max ELOCKED retries after the first attempt. Default 5. */
  retries?: number;
  /** Delay before a retry. Default matches Claude: 1000 + random * 1000 ms. */
  retryDelayMs?: () => number;
  /** Take over a claim older than this. `0` disables takeover. Default 30s. */
  staleMs?: number;
  /** Claims directory. Default is `refreshClaimDirectoryFor(targetPath)`. */
  directory?: string;
};

type RefreshClaimSteps<T> = {
  /** A result another claimant already published, or `undefined`. */
  reuse(): Promise<T | undefined>;
  refresh(): Promise<T>;
};

function lockedError(file: string): NodeJS.ErrnoException {
  return Object.assign(new Error('Lock file is already being held'), {
    code: REFRESH_CLAIM_ELOCKED,
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

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

export function defaultRefreshClaimRetryDelayMs(): number {
  return 1000 + Math.random() * 1000;
}

export function refreshClaimDirectoryFor(targetPath: string): string {
  return join(dirname(targetPath), 'claude-subscription-refresh.claims');
}

function claimKey(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex').slice(0, 32);
}

async function latestGeneration(directory: string, key: string): Promise<number> {
  const prefix = `${key}.`;
  let latest = 0;
  for (const name of await readdir(directory)) {
    if (!name.startsWith(prefix)) continue;
    const suffix = name.slice(prefix.length);
    if (!/^[1-9]\d*$/.test(suffix)) continue;
    const generation = Number(suffix);
    if (Number.isSafeInteger(generation) && generation > latest) latest = generation;
  }
  return latest;
}

async function nextGeneration(directory: string, key: string, staleMs: number): Promise<number | undefined> {
  const latest = await latestGeneration(directory, key);
  if (latest === 0) return 1;
  try {
    const info = await stat(join(directory, `${key}.${latest}`));
    if (staleMs > 0 && info.mtimeMs < Date.now() - staleMs) return latest + 1;
    return undefined;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return latest;
    throw error;
  }
}

async function tryClaim(directory: string, key: string, staleMs: number): Promise<string | undefined> {
  await mkdir(directory, { recursive: true });
  const generation = await nextGeneration(directory, key, staleMs);
  if (generation === undefined) return undefined;
  const claimPath = join(directory, `${key}.${generation}`);
  try {
    await (await open(claimPath, 'wx', 0o600)).close();
    return claimPath;
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return undefined;
    throw error;
  }
}

async function sweepOldClaimsBestEffort(directory: string): Promise<void> {
  const cutoff = Date.now() - CLAIM_RETENTION_MS;
  for (const name of await readdir(directory).catch(() => [])) {
    const path = join(directory, name);
    try {
      if ((await stat(path)).mtimeMs < cutoff) await rm(path, { force: true });
    } catch {
      continue;
    }
  }
}

/**
 * Runs `steps.refresh` at most once per refresh token across processes.
 * Claims are files `<key>.<generation>` created with `wx`, where `key` hashes the token.
 * A successful claim stays on disk so its name is never reused while that token is current.
 * A failed refresh deletes only its own claim. Nothing deletes another process's claim.
 * Does not replace the in-process refresh latch.
 */
export async function withRefreshTokenClaim<T>(
  targetPath: string,
  refreshToken: string,
  steps: RefreshClaimSteps<T>,
  options: RefreshClaimOptions = {},
  signal?: AbortSignal,
): Promise<T> {
  const directory = options.directory ?? refreshClaimDirectoryFor(targetPath);
  const retries = options.retries ?? REFRESH_CLAIM_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? defaultRefreshClaimRetryDelayMs;
  const staleMs = options.staleMs ?? REFRESH_CLAIM_STALE_MS;
  const key = claimKey(refreshToken);

  let attempt = 0;
  for (;;) {
    signal?.throwIfAborted();
    const reused = await steps.reuse();
    if (reused !== undefined) return reused;
    const claimPath = await tryClaim(directory, key, staleMs);
    if (claimPath !== undefined) {
      const publishedMeanwhile = await steps.reuse();
      if (publishedMeanwhile !== undefined) return publishedMeanwhile;
      let result: T;
      try {
        result = await steps.refresh();
      } catch (error) {
        await rm(claimPath, { force: true });
        throw error;
      }
      await sweepOldClaimsBestEffort(directory);
      return result;
    }
    if (attempt >= retries) throw lockedError(targetPath);
    attempt += 1;
    await sleep(retryDelayMs(), signal);
  }
}
