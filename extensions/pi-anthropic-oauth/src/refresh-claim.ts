import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { OAuthCredential } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { Check } from 'typebox/value';

/** Error code thrown when claim retries run out. Matches Claude's proper-lockfile contention code. */
export const REFRESH_CLAIM_ELOCKED = 'ELOCKED';

// Fixture claude/fixtures/refresh-lifecycle-2.1.312.json records ELOCKED retries up to 5,
// then failure, with a 1000+random*1000 ms delay. A 2.1.316 holder loop keeps waiting
// on ELOCKED and runs unlocked after other errors. This helper follows the fixture.
export const REFRESH_CLAIM_MAX_RETRIES = 5;

export const REFRESH_TIMEOUT_MS = 15_000;

export const REFRESH_CLAIM_STALE_MS = 2 * REFRESH_TIMEOUT_MS;

const DAY_MS = 24 * 60 * 60 * 1000;

// A recorded successor must satisfy the longest window Pi's own callers request: `pi` bearer
// token export asks for 30 minutes (DEFAULT_BEARER_TOKEN_MIN_EXPIRY_MS). Pi rejects a refresh
// result that expires inside the caller's window instead of refreshing again.
const MINIMUM_VALIDITY_MS = 30 * 60 * 1000;

const V0_1_5_SHARE_FILE = 'claude-subscription-refresh.json';

export type RefreshClaimOptions = {
  retries?: number;
  retryDelayMs?: () => number;
  staleMs?: number;
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
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

export function defaultRefreshClaimRetryDelayMs(): number {
  return 1000 + Math.random() * 1000;
}

export function refreshClaimDirectoryFor(targetPath: string): string {
  return join(dirname(targetPath), 'claude-subscription-refresh.claims');
}

type ClaimKey = string & { readonly __brand: 'ClaimKey' };

const CLAIM_KEY = /^[0-9a-f]{32}$/;

function isClaimKey(value: string): value is ClaimKey {
  return CLAIM_KEY.test(value);
}

function claimKey(refreshToken: string): ClaimKey {
  const key = createHash('sha256').update(refreshToken).digest('hex').slice(0, 32);
  if (!isClaimKey(key)) throw new Error('A refresh token hashed to a malformed claim key.');
  return key;
}

function generationOf(name: string, key: ClaimKey): number | undefined {
  const prefix = `${key}.`;
  if (!name.startsWith(prefix)) return undefined;
  const suffix = name.slice(prefix.length);
  if (!/^[1-9]\d*$/.test(suffix)) return undefined;
  const generation = Number(suffix);
  return Number.isSafeInteger(generation) ? generation : undefined;
}

async function latestGeneration(directory: string, key: ClaimKey): Promise<number> {
  let latest = 0;
  for (const name of await readdir(directory)) {
    const generation = generationOf(name, key);
    if (generation !== undefined && generation > latest) latest = generation;
  }
  return latest;
}

/** A claim is created empty while its refresh runs, and holds the successor once the refresh finishes. */
type ClaimState = { readonly kind: 'missing' } | { readonly kind: 'pending'; readonly mtimeMs: number } | { readonly kind: 'finished' };

async function claimState(path: string): Promise<ClaimState> {
  const modified = await mtimeMs(path);
  if (modified === undefined) return { kind: 'missing' };
  return (await readCredential(path)) ? { kind: 'finished' } : { kind: 'pending', mtimeMs: modified };
}

async function nextGeneration(directory: string, key: ClaimKey, staleMs: number): Promise<number | undefined> {
  const latest = await latestGeneration(directory, key);
  if (latest === 0) return 1;
  const state = await claimState(join(directory, `${key}.${latest}`));
  switch (state.kind) {
    case 'missing':
      return latest;
    // Only a successor that kept the refresh token claims a finished key again.
    case 'finished':
      return latest + 1;
    case 'pending':
      return staleMs > 0 && state.mtimeMs < Date.now() - staleMs ? latest + 1 : undefined;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

async function tryClaim(directory: string, key: ClaimKey, staleMs: number): Promise<string | undefined> {
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

const LoggedCredential = Type.Object({ type: Type.Literal('oauth'), access: Type.String(), refresh: Type.String(), expires: Type.Number() });

async function readCredential(path: string): Promise<OAuthCredential | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return Check(LoggedCredential, parsed) ? parsed : undefined;
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

async function recordedSuccessor(directory: string, names: readonly string[], key: ClaimKey): Promise<OAuthCredential | undefined> {
  let newest: OAuthCredential | undefined;
  for (const name of names) {
    if (generationOf(name, key) === undefined) continue;
    const successor = await readCredential(join(directory, name));
    if (successor && (!newest || successor.expires > newest.expires)) newest = successor;
  }
  return newest;
}

async function mtimeMs(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mtimeMs;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
}

/** Where a credential's successor can be found. The rotation log is one source; a 0.1.5 share file is another. */
type SuccessorSource = (current: OAuthCredential, key: ClaimKey) => Promise<OAuthCredential | undefined>;

/**
 * 0.1.5 claimed a refresh token in the log, then wrote the successor to one share file next to it.
 * The share is followed from a credential whose claim predates it. Delete this source once 0.1.5 logs are gone.
 */
async function v0_1_5ShareSource(directory: string, names: readonly string[]): Promise<SuccessorSource | undefined> {
  const path = join(dirname(directory), V0_1_5_SHARE_FILE);
  const share = await readCredential(path);
  const shared = share === undefined ? undefined : await mtimeMs(path);
  if (share === undefined || shared === undefined) return undefined;
  return async (current, key) => {
    if (share.refresh === current.refresh || share.expires <= current.expires) return undefined;
    for (const name of names) {
      if (generationOf(name, key) === undefined) continue;
      const claimed = await mtimeMs(join(directory, name));
      if (claimed !== undefined && claimed <= shared) return share;
    }
    return undefined;
  };
}

async function rotationChain(directory: string, credential: OAuthCredential): Promise<OAuthCredential[]> {
  const names = await claimNames(directory);
  const sources: SuccessorSource[] = [(_current, key) => recordedSuccessor(directory, names, key)];
  const share = await v0_1_5ShareSource(directory, names);
  if (share) sources.push(share);
  const chain = [credential];
  const seen = new Set<ClaimKey>();
  for (let current = credential; ; ) {
    const key = claimKey(current.refresh);
    if (seen.has(key)) return chain;
    seen.add(key);
    const next = await firstSuccessor(sources, current, key);
    if (!next) return chain;
    chain.push(next);
    current = next;
  }
}

async function firstSuccessor(sources: readonly SuccessorSource[], current: OAuthCredential, key: ClaimKey): Promise<OAuthCredential | undefined> {
  for (const source of sources) {
    const next = await source(current, key);
    if (next) return next;
  }
  return undefined;
}

export async function followChain(directory: string, credential: OAuthCredential): Promise<OAuthCredential> {
  const chain = await rotationChain(directory, credential);
  return chain[chain.length - 1] ?? credential;
}

/**
 * The newest credential the log in `directory` records for `credential`, or `credential` with no log.
 * The log only offers a newer token, so a log that cannot be read offers none.
 */
export async function latestRecorded(directory: string | undefined, credential: OAuthCredential): Promise<OAuthCredential> {
  if (directory === undefined) return credential;
  return followChain(directory, credential).catch(() => credential);
}

export async function clearRotationLog(directory: string): Promise<void> {
  await Promise.all([rm(directory, { recursive: true, force: true }), rm(join(dirname(directory), V0_1_5_SHARE_FILE), { force: true })]);
}

// Every refresh mints a new access token. A response may keep the refresh token, so it cannot tell a successor apart.
export function isSuccessor(candidate: OAuthCredential, of: OAuthCredential): boolean {
  return candidate.access !== of.access;
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
      const prefix = name.split('.', 1)[0] ?? '';
      if (isClaimKey(prefix) && kept.has(prefix)) continue;
      const path = join(directory, name);
      try {
        if ((await stat(path)).mtimeMs < cutoff) await rm(path, { force: true });
      } catch {}
    }
  } catch {
    return;
  }
}

export async function rotateRefreshToken({
  directory,
  credential,
  refresh,
  options = {},
  signal,
}: {
  directory: string;
  credential: OAuthCredential;
  refresh: (credential: OAuthCredential, signal: AbortSignal) => Promise<OAuthCredential>;
  options?: RefreshClaimOptions | undefined;
  signal: AbortSignal;
}): Promise<OAuthCredential> {
  const retries = options.retries ?? REFRESH_CLAIM_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? defaultRefreshClaimRetryDelayMs;
  const staleMs = options.staleMs ?? REFRESH_CLAIM_STALE_MS;

  let attempt = 0;
  for (;;) {
    signal.throwIfAborted();
    const latest = await followChain(directory, credential);
    if (isSuccessor(latest, credential) && !expiringSoon(latest)) return latest;
    const target = latest;
    const claimPath = await tryClaim(directory, claimKey(target.refresh), staleMs);
    if (claimPath !== undefined) {
      const again = await followChain(directory, target);
      if (isSuccessor(again, target)) {
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
      // The token endpoint already rotated the token, so failing here would discard the only valid one.
      await writeSuccessor(claimPath, next).catch(() => undefined);
      await sweepOldClaimsBestEffort(directory, options.liveCredential);
      return next;
    }
    if (attempt >= retries) throw lockedError(directory);
    attempt += 1;
    await sleep(retryDelayMs(), signal);
  }
}
