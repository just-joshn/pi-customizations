import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { OAuthCredential } from '@earendil-works/pi-ai';
import { expect, onTestFinished, test, vi } from 'vitest';
import { defaultRefreshClaimRetryDelayMs, REFRESH_CLAIM_ELOCKED, REFRESH_CLAIM_MAX_RETRIES, rotateRefreshToken } from '../src/refresh-claim.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function credential(name: string, expiresInMs = HOUR): OAuthCredential {
  return { type: 'oauth', access: `${name}-access`, refresh: `${name}-refresh-secret`, expires: Date.now() + expiresInMs };
}

async function tempClaims(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pi-anth-refresh-claim-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'claude-subscription-refresh.claims');
}

async function age(directory: string, ms: number): Promise<void> {
  const old = new Date(Date.now() - ms);
  for (const name of await readdir(directory)) await utimes(join(directory, name), old, old);
}

function returning(next: OAuthCredential) {
  return vi.fn(async (_credential: OAuthCredential, _signal: AbortSignal) => next);
}

async function holdClaim(directory: string, held: OAuthCredential, signal: AbortSignal) {
  let settle: (outcome: OAuthCredential | Error) => void = () => {};
  let entered: () => void = () => {};
  const inRefresh = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const rotation = rotateRefreshToken({
    directory,
    credential: held,
    refresh: () => {
      entered();
      return new Promise<OAuthCredential>((resolve, reject) => {
        settle = (outcome) => (outcome instanceof Error ? reject(outcome) : resolve(outcome));
      });
    },
    options: {},
    signal,
  });
  await inRefresh;
  return { settle: (outcome: OAuthCredential | Error) => settle(outcome), rotation };
}

test('a contended claim retries with the configured delays then rejects with ELOCKED', async ({ signal }) => {
  const directory = await tempClaims();
  const a = credential('a');
  const b = credential('b');
  const { settle, rotation } = await holdClaim(directory, a, signal);
  const delays: number[] = [];
  const refresh = returning(credential('never'));

  await expect(
    rotateRefreshToken({
      directory,
      credential: a,
      refresh,
      options: {
        retries: REFRESH_CLAIM_MAX_RETRIES,
        retryDelayMs: () => {
          delays.push(3);
          return 3;
        },
      },
      signal,
    }),
  ).rejects.toMatchObject({ code: REFRESH_CLAIM_ELOCKED, file: directory });
  expect(delays).toStrictEqual(Array(REFRESH_CLAIM_MAX_RETRIES).fill(3));
  expect(refresh).not.toHaveBeenCalled();

  settle(b);
  await expect(rotation).resolves.toStrictEqual(b);
});

test('a stale claim is taken over and refresh runs once', async ({ signal }) => {
  const directory = await tempClaims();
  const a = credential('a');
  const b = credential('b');
  const { settle, rotation } = await holdClaim(directory, a, signal);
  await age(directory, 60_000);
  const refresh = returning(b);

  await expect(rotateRefreshToken({ directory, credential: a, refresh, options: { staleMs: 1_000, retries: 0 }, signal })).resolves.toStrictEqual(b);
  expect(refresh.mock.calls.map(([sent]) => sent.refresh)).toStrictEqual([a.refresh]);
  expect(await readdir(directory)).toHaveLength(2);

  settle(new Error('the abandoned refresher gave up'));
  await expect(rotation).rejects.toThrow('the abandoned refresher gave up');
});

test('a failed refresh rejects and a later call claims and refreshes', async ({ signal }) => {
  const directory = await tempClaims();
  const a = credential('a');
  const b = credential('b');
  const options = { retries: 0, staleMs: 0 };

  await expect(rotateRefreshToken({ directory, credential: a, refresh: async () => Promise.reject(new Error('network down')), options, signal })).rejects.toThrow('network down');
  await expect(rotateRefreshToken({ directory, credential: a, refresh: returning(b), options, signal })).resolves.toStrictEqual(b);
});

test('staleMs 0 never takes over an old claim', async ({ signal }) => {
  const directory = await tempClaims();
  const a = credential('a');
  const { settle, rotation } = await holdClaim(directory, a, signal);
  await age(directory, HOUR);
  const refresh = returning(credential('b'));

  await expect(rotateRefreshToken({ directory, credential: a, refresh, options: { staleMs: 0, retries: 0 }, signal })).rejects.toMatchObject({ code: REFRESH_CLAIM_ELOCKED });
  expect(refresh).not.toHaveBeenCalled();

  settle(new Error('released'));
  await expect(rotation).rejects.toThrow('released');
});

test('a recorded successor is returned without a refresh', async ({ signal }) => {
  const directory = await tempClaims();
  const a = credential('a');
  const b = credential('b');
  await rotateRefreshToken({ directory, credential: a, refresh: returning(b), options: {}, signal });
  const refresh = returning(credential('c'));

  await expect(rotateRefreshToken({ directory, credential: a, refresh, options: {}, signal })).resolves.toStrictEqual(b);
  expect(refresh).not.toHaveBeenCalled();
});

test('a chain of two successors returns the newest', async ({ signal }) => {
  const directory = await tempClaims();
  const a = credential('a');
  const b = credential('b');
  const c = credential('c');
  await rotateRefreshToken({ directory, credential: a, refresh: returning(b), options: {}, signal });
  await rotateRefreshToken({ directory, credential: b, refresh: returning(c), options: {}, signal });
  const refresh = returning(credential('d'));

  await expect(rotateRefreshToken({ directory, credential: a, refresh, options: {}, signal })).resolves.toStrictEqual(c);
  expect(refresh).not.toHaveBeenCalled();
});

test('an expiring newest successor is rotated with its own refresh token', async ({ signal }) => {
  const directory = await tempClaims();
  const a = credential('a');
  const expiring = credential('b', 60_000);
  const c = credential('c');
  await rotateRefreshToken({ directory, credential: a, refresh: returning(expiring), options: {}, signal });
  const refresh = returning(c);

  await expect(rotateRefreshToken({ directory, credential: a, refresh, options: {}, signal })).resolves.toStrictEqual(c);
  expect(refresh.mock.calls.map(([sent]) => sent.refresh)).toStrictEqual([expiring.refresh]);
});

test('a later legacy share file is not followed when nothing claimed the credential', async ({ signal }) => {
  const directory = await tempClaims();
  const a = credential('a');
  const other = credential('other-account', 2 * HOUR);
  const b = credential('b');
  await writeFile(join(directory, '..', 'claude-subscription-refresh.json'), `${JSON.stringify(other)}\n`);
  const refresh = returning(b);

  await expect(rotateRefreshToken({ directory, credential: a, refresh, options: {}, signal })).resolves.toStrictEqual(b);
  expect(refresh).toHaveBeenCalledTimes(1);
});

test.for([
  { name: 'a later legacy share file is followed', legacyExpiresInMs: 2 * HOUR, refreshes: 0 },
  { name: 'an earlier legacy share file is ignored', legacyExpiresInMs: HOUR / 2, refreshes: 1 },
])('$name', async ({ legacyExpiresInMs, refreshes }, { signal }) => {
  const directory = await tempClaims();
  const a = credential('a');
  const legacy = credential('legacy', legacyExpiresInMs);
  const b = credential('b');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${createHash('sha256').update(a.refresh).digest('hex').slice(0, 32)}.1`), '');
  await age(directory, 60_000);
  await writeFile(join(directory, '..', 'claude-subscription-refresh.json'), `${JSON.stringify(legacy)}\n`);
  const refresh = returning(b);

  await expect(rotateRefreshToken({ directory, credential: a, refresh, options: {}, signal })).resolves.toStrictEqual(refreshes === 0 ? legacy : b);
  expect(refresh).toHaveBeenCalledTimes(refreshes);
});

test('a successor that keeps its refresh token is reused by a second caller', async ({ signal }) => {
  const directory = await tempClaims();
  const stale = credential('a', -1000);
  const refresh = returning({ ...credential('fresh', 8 * HOUR), refresh: stale.refresh });
  await rotateRefreshToken({ directory, credential: stale, refresh, signal });

  await expect(rotateRefreshToken({ directory, credential: stale, refresh, options: { retries: 0 }, signal })).resolves.toMatchObject({ access: 'fresh-access' });
  expect(refresh).toHaveBeenCalledTimes(1);
});

test('a successor that kept its refresh token can be refreshed again at once', async ({ signal }) => {
  const directory = await tempClaims();
  const original = credential('a', -1000);
  const first = { ...credential('first', 8 * HOUR), refresh: original.refresh };
  const second = { ...credential('second', 8 * HOUR), refresh: original.refresh };
  const recovered = await rotateRefreshToken({ directory, credential: original, refresh: returning(first), signal });

  const refresh = returning(second);
  await expect(rotateRefreshToken({ directory, credential: recovered, refresh, options: { retries: 0 }, signal })).resolves.toStrictEqual(second);
  expect(refresh).toHaveBeenCalledTimes(1);
});

test('claim file names do not contain the refresh token', async ({ signal }) => {
  const directory = await tempClaims();
  const a = credential('a');
  await rotateRefreshToken({ directory, credential: a, refresh: returning(credential('b')), options: {}, signal });

  const names = await readdir(directory);
  expect(names).toHaveLength(1);
  expect(names.join('\n')).not.toContain(a.refresh);
});

test('a log entry is readable only by its owner', async ({ signal }) => {
  const directory = await tempClaims();
  await rotateRefreshToken({ directory, credential: credential('a'), refresh: returning(credential('b')), options: {}, signal });

  const [entry] = await readdir(directory);
  if (entry === undefined) throw new Error('rotation left no log entry');
  expect((await stat(join(directory, entry))).mode & 0o777).toBe(0o600);
});

test.for([
  { name: 'the sweep removes day-old entries off the live chain', live: 'unrelated', agedMs: 2 * DAY, swept: true },
  { name: 'the sweep keeps day-old entries on the live chain', live: 'a', agedMs: 2 * DAY, swept: false },
  { name: 'with no live credential the sweep keeps entries under 30 days', live: undefined, agedMs: 2 * DAY, swept: false },
  { name: 'with no live credential the sweep removes entries over 30 days', live: undefined, agedMs: 31 * DAY, swept: true },
])('$name', async ({ live, agedMs, swept }, { signal }) => {
  const directory = await tempClaims();
  const a = credential('a');
  const b = credential('b');
  const liveCredential = () => (live === 'a' ? a : live === undefined ? undefined : credential(live));
  await rotateRefreshToken({ directory, credential: a, refresh: returning(b), options: {}, signal });
  await age(directory, agedMs);
  await rotateRefreshToken({ directory, credential: credential('x'), refresh: returning(credential('y')), options: { liveCredential }, signal });
  const refresh = returning(credential('c'));

  await rotateRefreshToken({ directory, credential: a, refresh, options: {}, signal });
  expect(refresh).toHaveBeenCalledTimes(swept ? 1 : 0);
});

test('default retry delay stays in Claude 1000..2000 ms range', () => {
  using _spy = vi.spyOn(Math, 'random').mockReturnValue(0.25);
  expect(defaultRefreshClaimRetryDelayMs()).toBe(1250);
});

test('a started refresh is not cancelled by the caller signal', async () => {
  const directory = await tempClaims();
  const caller = new AbortController();
  const next = credential('b');
  let refreshCancelled: boolean | undefined;
  const refresh = vi.fn(async (_current: OAuthCredential, refreshSignal: AbortSignal) => {
    caller.abort(new Error('caller gave up'));
    refreshCancelled = refreshSignal.aborted;
    return next;
  });

  await expect(rotateRefreshToken({ directory, credential: credential('a'), refresh, options: {}, signal: caller.signal })).resolves.toStrictEqual(next);
  expect(refreshCancelled).toBe(false);
});

test('a refresh whose successor cannot be recorded still returns the new credential', async ({ signal }) => {
  const directory = await tempClaims();
  onTestFinished(() => chmod(directory, 0o700));
  const next = credential('b');
  const refresh = vi.fn(async () => {
    await chmod(directory, 0o500);
    return next;
  });

  await expect(rotateRefreshToken({ directory, credential: credential('a'), refresh, options: {}, signal })).resolves.toStrictEqual(next);
});
