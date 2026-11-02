import { chmod, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
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
  const rotation = rotateRefreshToken(
    directory,
    held,
    () => {
      entered();
      return new Promise<OAuthCredential>((resolve, reject) => {
        settle = (outcome) => (outcome instanceof Error ? reject(outcome) : resolve(outcome));
      });
    },
    {},
    signal,
  );
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
    rotateRefreshToken(
      directory,
      a,
      refresh,
      {
        retries: REFRESH_CLAIM_MAX_RETRIES,
        retryDelayMs: () => {
          delays.push(3);
          return 3;
        },
      },
      signal,
    ),
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

  await expect(rotateRefreshToken(directory, a, refresh, { staleMs: 1_000, retries: 0 }, signal)).resolves.toStrictEqual(b);
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

  await expect(rotateRefreshToken(directory, a, async () => Promise.reject(new Error('network down')), options, signal)).rejects.toThrow('network down');
  await expect(rotateRefreshToken(directory, a, returning(b), options, signal)).resolves.toStrictEqual(b);
});

test('staleMs 0 never takes over an old claim', async ({ signal }) => {
  const directory = await tempClaims();
  const a = credential('a');
  const { settle, rotation } = await holdClaim(directory, a, signal);
  await age(directory, HOUR);
  const refresh = returning(credential('b'));

  await expect(rotateRefreshToken(directory, a, refresh, { staleMs: 0, retries: 0 }, signal)).rejects.toMatchObject({ code: REFRESH_CLAIM_ELOCKED });
  expect(refresh).not.toHaveBeenCalled();

  settle(new Error('released'));
  await expect(rotation).rejects.toThrow('released');
});

test('a recorded successor is returned without a refresh', async ({ signal }) => {
  const directory = await tempClaims();
  const a = credential('a');
  const b = credential('b');
  await rotateRefreshToken(directory, a, returning(b), {}, signal);
  const refresh = returning(credential('c'));

  await expect(rotateRefreshToken(directory, a, refresh, {}, signal)).resolves.toStrictEqual(b);
  expect(refresh).not.toHaveBeenCalled();
});

test('a chain of two successors returns the newest', async ({ signal }) => {
  const directory = await tempClaims();
  const a = credential('a');
  const b = credential('b');
  const c = credential('c');
  await rotateRefreshToken(directory, a, returning(b), {}, signal);
  await rotateRefreshToken(directory, b, returning(c), {}, signal);
  const refresh = returning(credential('d'));

  await expect(rotateRefreshToken(directory, a, refresh, {}, signal)).resolves.toStrictEqual(c);
  expect(refresh).not.toHaveBeenCalled();
});

test('an expiring newest successor is rotated with its own refresh token', async ({ signal }) => {
  const directory = await tempClaims();
  const a = credential('a');
  const expiring = credential('b', 60_000);
  const c = credential('c');
  await rotateRefreshToken(directory, a, returning(expiring), {}, signal);
  const refresh = returning(c);

  await expect(rotateRefreshToken(directory, a, refresh, {}, signal)).resolves.toStrictEqual(c);
  expect(refresh.mock.calls.map(([sent]) => sent.refresh)).toStrictEqual([expiring.refresh]);
});

test.for([
  { name: 'a later legacy share file is followed', legacyExpiresInMs: 2 * HOUR, refreshes: 0 },
  { name: 'an earlier legacy share file is ignored', legacyExpiresInMs: HOUR / 2, refreshes: 1 },
])('$name', async ({ legacyExpiresInMs, refreshes }, { signal }) => {
  const directory = await tempClaims();
  const a = credential('a');
  const legacy = credential('legacy', legacyExpiresInMs);
  const b = credential('b');
  await writeFile(join(directory, '..', 'claude-subscription-refresh.json'), `${JSON.stringify(legacy)}\n`);
  const refresh = returning(b);

  await expect(rotateRefreshToken(directory, a, refresh, {}, signal)).resolves.toStrictEqual(refreshes === 0 ? legacy : b);
  expect(refresh).toHaveBeenCalledTimes(refreshes);
});

test('claim file names do not contain the refresh token', async ({ signal }) => {
  const directory = await tempClaims();
  const a = credential('a');
  await rotateRefreshToken(directory, a, returning(credential('b')), {}, signal);

  const names = await readdir(directory);
  expect(names).toHaveLength(1);
  expect(names.join('\n')).not.toContain(a.refresh);
});

test('a log entry is readable only by its owner', async ({ signal }) => {
  const directory = await tempClaims();
  await rotateRefreshToken(directory, credential('a'), returning(credential('b')), {}, signal);

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
  await rotateRefreshToken(directory, a, returning(b), {}, signal);
  await age(directory, agedMs);
  await rotateRefreshToken(directory, credential('x'), returning(credential('y')), { liveCredential }, signal);
  const refresh = returning(credential('c'));

  await rotateRefreshToken(directory, a, refresh, {}, signal);
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

  await expect(rotateRefreshToken(directory, credential('a'), refresh, {}, caller.signal)).resolves.toStrictEqual(next);
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

  await expect(rotateRefreshToken(directory, credential('a'), refresh, {}, signal)).resolves.toStrictEqual(next);
});
