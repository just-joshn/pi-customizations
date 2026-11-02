import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, onTestFinished, test, vi } from 'vitest';
import {
  defaultRefreshClaimRetryDelayMs,
  REFRESH_CLAIM_ELOCKED,
  REFRESH_CLAIM_MAX_RETRIES,
  refreshClaimDirectoryFor,
  withRefreshTokenClaim,
} from '../src/refresh-claim.ts';

const TOKEN = 'refresh-token-secret';

async function tempAuthPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pi-anth-refresh-claim-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'auth.json');
}

function nothingToReuse(): Promise<undefined> {
  return Promise.resolve(undefined);
}

async function claimFiles(target: string): Promise<string[]> {
  return readdir(refreshClaimDirectoryFor(target));
}

async function holdClaim(target: string): Promise<{ finish: () => void; held: Promise<string> }> {
  let finish: () => void = () => {};
  let entered: () => void = () => {};
  const inRefresh = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = withRefreshTokenClaim(target, TOKEN, {
    reuse: nothingToReuse,
    refresh: () => {
      entered();
      return new Promise<string>((resolve) => {
        finish = () => resolve('first');
      });
    },
  });
  await inRefresh;
  return { finish, held };
}

test('a contended claim retries with the configured delays then rejects with ELOCKED', async () => {
  const target = await tempAuthPath();
  const { finish, held } = await holdClaim(target);
  const delays: number[] = [];
  const refresh = vi.fn(async () => 'never');

  await expect(
    withRefreshTokenClaim(
      target,
      TOKEN,
      { reuse: nothingToReuse, refresh },
      {
        retries: REFRESH_CLAIM_MAX_RETRIES,
        retryDelayMs: () => {
          delays.push(3);
          return 3;
        },
      },
    ),
  ).rejects.toMatchObject({ code: REFRESH_CLAIM_ELOCKED, file: target });
  expect(delays).toStrictEqual(Array(REFRESH_CLAIM_MAX_RETRIES).fill(3));
  expect(refresh).not.toHaveBeenCalled();

  finish();
  await expect(held).resolves.toBe('first');
});

test('a stale claim is taken over and refresh runs once', async () => {
  const target = await tempAuthPath();
  const directory = refreshClaimDirectoryFor(target);
  await withRefreshTokenClaim(target, TOKEN, { reuse: nothingToReuse, refresh: async () => 'crashed' });
  const [abandoned] = await claimFiles(target);
  if (abandoned === undefined) throw new Error('first claim left no file');
  const old = new Date(Date.now() - 60_000);
  await utimes(join(directory, abandoned), old, old);
  const refresh = vi.fn(async () => 'ran');

  await expect(withRefreshTokenClaim(target, TOKEN, { reuse: nothingToReuse, refresh }, { staleMs: 1_000, retries: 0 })).resolves.toBe('ran');
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(await claimFiles(target)).toHaveLength(2);
});

test('a failed refresh rejects and a later call claims and refreshes', async () => {
  const target = await tempAuthPath();
  const options = { retries: 0, staleMs: 0 };

  await expect(
    withRefreshTokenClaim(target, TOKEN, { reuse: nothingToReuse, refresh: async () => Promise.reject(new Error('network down')) }, options),
  ).rejects.toThrow('network down');
  await expect(withRefreshTokenClaim(target, TOKEN, { reuse: nothingToReuse, refresh: async () => 'second' }, options)).resolves.toBe('second');
});

test('staleMs 0 never takes over an old claim', async () => {
  const target = await tempAuthPath();
  const directory = refreshClaimDirectoryFor(target);
  await withRefreshTokenClaim(target, TOKEN, { reuse: nothingToReuse, refresh: async () => 'first' });
  const [claim] = await claimFiles(target);
  if (claim === undefined) throw new Error('first claim left no file');
  const old = new Date(Date.now() - 3_600_000);
  await utimes(join(directory, claim), old, old);
  const refresh = vi.fn(async () => 'second');

  await expect(withRefreshTokenClaim(target, TOKEN, { reuse: nothingToReuse, refresh }, { staleMs: 0, retries: 0 })).rejects.toMatchObject({
    code: REFRESH_CLAIM_ELOCKED,
  });
  expect(refresh).not.toHaveBeenCalled();
});

test('a reused result skips refresh', async () => {
  const target = await tempAuthPath();
  const refresh = vi.fn(async () => 'refreshed');

  await expect(withRefreshTokenClaim(target, TOKEN, { reuse: async () => 'published', refresh })).resolves.toBe('published');
  expect(refresh).not.toHaveBeenCalled();
});

test('a result published while claiming skips refresh', async () => {
  const target = await tempAuthPath();
  const reuse = vi.fn<() => Promise<string | undefined>>().mockResolvedValueOnce(undefined).mockResolvedValue('published');
  const refresh = vi.fn(async () => 'refreshed');

  await expect(withRefreshTokenClaim(target, TOKEN, { reuse, refresh })).resolves.toBe('published');
  expect(refresh).not.toHaveBeenCalled();
});

test('claim file names do not contain the refresh token', async () => {
  const target = await tempAuthPath();
  await withRefreshTokenClaim(target, TOKEN, { reuse: nothingToReuse, refresh: async () => 'done' });

  const names = await claimFiles(target);
  expect(names).toHaveLength(1);
  expect(names.join('\n')).not.toContain(TOKEN);
});

test('a successful refresh removes claims older than a day', async () => {
  const target = await tempAuthPath();
  const directory = refreshClaimDirectoryFor(target);
  await mkdir(directory, { recursive: true });
  const leftover = join(directory, 'leftover.1');
  await writeFile(leftover, '');
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await utimes(leftover, old, old);

  await withRefreshTokenClaim(target, TOKEN, { reuse: nothingToReuse, refresh: async () => 'done' });
  expect(await claimFiles(target)).not.toContain('leftover.1');
  expect(await claimFiles(target)).toHaveLength(1);
});

test('default retry delay stays in Claude 1000..2000 ms range', () => {
  using _spy = vi.spyOn(Math, 'random').mockReturnValue(0.25);
  expect(defaultRefreshClaimRetryDelayMs()).toBe(1250);
});
