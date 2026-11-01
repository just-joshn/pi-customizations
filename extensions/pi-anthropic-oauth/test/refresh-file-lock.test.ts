import { mkdir, mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, onTestFinished, test, vi } from 'vitest';
import {
  defaultRefreshLockRetryDelayMs,
  REFRESH_LOCK_ELOCKED,
  REFRESH_LOCK_MAX_RETRIES,
  refreshLockPathFor,
  withRefreshFileLock,
} from '../src/refresh-file-lock.ts';
import { createRefreshLatch } from '../src/refresh-latch.ts';

async function tempAuthPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pi-anth-refresh-lock-'));
  onTestFinished(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return join(dir, 'auth.json');
}

test('contended locks serialize work and avoid overlapping critical sections', async () => {
  const target = await tempAuthPath();
  let active = 0;
  let maxActive = 0;
  let starts = 0;

  const run = () =>
    withRefreshFileLock(
      target,
      async () => {
        starts += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 30));
        active -= 1;
        return starts;
      },
      { retries: 40, retryDelayMs: () => 5 },
    );

  const [a, b] = await Promise.all([run(), run()]);
  expect(starts).toBe(2);
  expect(maxActive).toBe(1);
  expect([a, b].sort()).toStrictEqual([1, 2]);
});

test('ELOCKED retries are capped then throw with Claude code', async () => {
  const target = await tempAuthPath();
  const lockPath = refreshLockPathFor(target);
  await mkdir(lockPath);
  onTestFinished(async () => {
    await rm(lockPath, { recursive: true, force: true });
  });

  const delays: number[] = [];
  await expect(
    withRefreshFileLock(
      target,
      async () => 'never',
      {
        retries: REFRESH_LOCK_MAX_RETRIES,
        retryDelayMs: () => {
          delays.push(1);
          return 0;
        },
      },
    ),
  ).rejects.toMatchObject({ code: REFRESH_LOCK_ELOCKED, file: target });
  expect(delays).toHaveLength(REFRESH_LOCK_MAX_RETRIES);
});

test('in-process latch still singleflights when wrapped around the file lock', async () => {
  const target = await tempAuthPath();
  const latch = createRefreshLatch<number>();
  let starts = 0;
  const work = () =>
    latch.run(() =>
      withRefreshFileLock(
        target,
        async () => {
          starts += 1;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return starts;
        },
        { retryDelayMs: () => 5 },
      ),
    );

  const [a, b, c] = await Promise.all([work(), work(), work()]);
  expect(starts).toBe(1);
  expect([a, b, c]).toStrictEqual([1, 1, 1]);
});

test('a stale lock directory is removed and the section runs', async () => {
  const target = await tempAuthPath();
  const lockPath = refreshLockPathFor(target);
  await mkdir(lockPath);
  const abandoned = new Date(Date.now() - 60_000);
  await utimes(lockPath, abandoned, abandoned);
  const options = { staleMs: 1_000, retryDelayMs: () => 0 };
  await expect(withRefreshFileLock(target, async () => 'ran', options)).resolves.toBe('ran');
});

test('default retry delay stays in Claude 1000..2000 ms range', () => {
  using _spy = vi.spyOn(Math, 'random').mockReturnValue(0.25);
  expect(defaultRefreshLockRetryDelayMs()).toBe(1250);
});
