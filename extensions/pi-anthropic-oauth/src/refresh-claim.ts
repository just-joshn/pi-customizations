import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { OAuthCredential } from '@earendil-works/pi-ai';

/** Error code thrown when claim retries run out. Matches Claude's proper-lockfile contention code. */
export const REFRESH_CLAIM_ELOCKED = 'ELOCKED';

// Fixture claude/fixtures/refresh-lifecycle-2.1.312.json records ELOCKED retries up to 5,
// then failure, with a 1000+random*1000 ms delay. A 2.1.316 holder loop keeps waiting
// on ELOCKED and runs unlocked after other errors. This helper follows the fixture.
export const REFRESH_CLAIM_MAX_RETRIES = 5;

export const REFRESH_TIMEOUT_MS = 15_000;

export const REFRESH_CLAIM_STALE_MS = 2 * REFRESH_TIMEOUT_MS;

const DAY_MS = 24 * 60 * 60 * 1000;

// Pi core's DEFAULT_OAUTH_MINIMUM_VALIDITY_MS: it refreshes a credential with less left than this.
const MINIMUM_VALIDITY_MS = 5 * 60 * 1000;

const V0_1_5_SHARE_FILE = 'claude-subscription-refresh.json';

export type RefreshClaimOptions = {
  /** Max ELOCKED retries after the first attempt. Default 5. */
  retries?: number;
  /** Delay before a retry. Default matches Claude: 1000 + random * 1000 ms. */
  retryDelayMs?: () => number;
  /** Take over a claim older than this. `0` disables takeover. Default 30s. */
  staleMs?: number;
  /** The credential Pi stores in `auth.json`. The sweep keeps the log entries that lead from it. */
  liveCredential?: () => OAuthCredential | undefined;
};

function lockedError(file: string): NodeJS.ErrnoException {
  return Object.assign(new Error('Lock file is already being held'), {
    code: REFRESH_CLAIM_ELOCKED,
    file,
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
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

function generationOf(name: string, key: string): number | undefined {
  const prefix = `${key}.`;
  if (!name.startsWith(prefix)) return undefined;
  const suffix = name.slice(prefix.length);
  if (!/^[1-9]\d*$/.test(suffix)) return undefined;
  const generation = Number(suffix);
  return Number.isSafeInteger(generation) ? generation : undefined;
}

async function latestGeneration(directory: string, key: string): Promise<number> {
  let latest = 0;
  for (const name of await readdir(directory)) {
    const generation = generationOf(name, key);
    if (generation !== undefined && generation > latest) latest = generation;
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

function isOAuthCredential(value: unknown): value is OAuthCredential {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record['type'] === 'oauth' && typeof record['access'] === 'string' && typeof record['refresh'] === 'string' && typeof record['expires'] === 'number';
}

async function readCredential(path: string): Promise<OAuthCredential | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return isOAuthCredential(parsed) ? parsed : undefined;
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function claimNames(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
}

async function recordedSuccessor(directory: string, names: readonly string[], key: string): Promise<OAuthCredential | undefined> {
  let newest: OAuthCredential | undefined;
  for (const name of names) {
    if (generationOf(name, key) === undefined) continue;
    const successor = await readCredential(join(directory, name));
    if (successor && (!newest || successor.expires > newest.expires)) newest = successor;
  }
  return newest;
}

async function rotationChain(directory: string, credential: OAuthCredential): Promise<OAuthCredential[]> {
  const names = await claimNames(directory);
  const legacy = await readCredential(join(dirname(directory), V0_1_5_SHARE_FILE));
  const chain = [credential];
  const seen = new Set<string>();
  for (let current = credential; ; ) {
    const key = claimKey(current.refresh);
    if (seen.has(key)) return chain;
    seen.add(key);
    const next =
      (await recordedSuccessor(directory, names, key)) ?? (legacy && legacy.refresh !== current.refresh && legacy.expires > current.expires ? legacy : undefined);
    if (!next) return chain;
    chain.push(next);
    current = next;
  }
}

async function followChain(directory: string, credential: OAuthCredential): Promise<OAuthCredential> {
  const chain = await rotationChain(directory, credential);
  return chain[chain.length - 1] ?? credential;
}

function expiringSoon(credential: OAuthCredential): boolean {
  return Date.now() + MINIMUM_VALIDITY_MS >= credential.expires;
}

async function writeSuccessor(claimPath: string, successor: OAuthCredential): Promise<void> {
  const temporary = `${claimPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(successor)}\n`, { mode: 0o600 });
  await rename(temporary, claimPath);
}

async function sweepOldClaimsBestEffort(directory: string, liveCredential: (() => OAuthCredential | undefined) | undefined): Promise<void> {
  try {
    const live = liveCredential?.();
    const kept = new Set(live ? (await rotationChain(directory, live)).map((credential) => claimKey(credential.refresh)) : []);
    const cutoff = Date.now() - (live ? DAY_MS : 30 * DAY_MS);
    for (const name of await readdir(directory)) {
      if (kept.has(name.split('.', 1)[0] ?? '')) continue;
      const path = join(directory, name);
      try {
        if ((await stat(path)).mtimeMs < cutoff) await rm(path, { force: true });
      } catch {
        continue;
      }
    }
  } catch {
    return;
  }
}

/**
 * Rotates `credential` at most once across processes and returns the newest credential.
 * The claims directory is a rotation log. `<key>.<generation>` is created empty with `wx` to
 * claim the token whose hash is `key`, then atomically replaced by the credential that
 * succeeded it. A caller holding an already rotated token follows the log instead of
 * refreshing, and rotates the newest credential only when that one is expiring too.
 * A failed refresh deletes only its own claim. Nothing deletes another process's claim
 * except the age sweep.
 */
export async function rotateRefreshToken(
  directory: string,
  credential: OAuthCredential,
  refresh: (credential: OAuthCredential, signal: AbortSignal) => Promise<OAuthCredential>,
  options: RefreshClaimOptions = {},
  signal: AbortSignal,
): Promise<OAuthCredential> {
  const retries = options.retries ?? REFRESH_CLAIM_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? defaultRefreshClaimRetryDelayMs;
  const staleMs = options.staleMs ?? REFRESH_CLAIM_STALE_MS;

  let attempt = 0;
  for (;;) {
    signal.throwIfAborted();
    const latest = await followChain(directory, credential);
    if (latest.refresh !== credential.refresh && !expiringSoon(latest)) return latest;
    const target = latest;
    const claimPath = await tryClaim(directory, claimKey(target.refresh), staleMs);
    if (claimPath !== undefined) {
      const again = await followChain(directory, target);
      if (again.refresh !== target.refresh) {
        if (!expiringSoon(again)) return again;
        credential = again;
        continue;
      }
      let next: OAuthCredential;
      try {
        next = await refresh(target, AbortSignal.timeout(REFRESH_TIMEOUT_MS));
      } catch (error) {
        await rm(claimPath, { force: true });
        throw error;
      }
      await writeSuccessor(claimPath, next);
      await sweepOldClaimsBestEffort(directory, options.liveCredential);
      return next;
    }
    if (attempt >= retries) throw lockedError(directory);
    attempt += 1;
    await sleep(retryDelayMs(), signal);
  }
}
