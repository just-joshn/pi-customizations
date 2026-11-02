import { expect, onTestFinished, test } from 'vitest';
import { createRefreshLatch } from '../src/refresh-latch.ts';

test('concurrent run calls share one attempt', async () => {
  const latch = createRefreshLatch<number>();
  let starts = 0;
  const work = () =>
    new Promise<number>((resolve) => {
      starts += 1;
      setTimeout(() => resolve(starts), 20);
    });
  const [a, b, c] = await Promise.all([latch.run(work), latch.run(work), latch.run(work)]);
  expect(starts).toBe(1);
  expect([a, b, c]).toStrictEqual([1, 1, 1]);
});

test('a later run starts a new attempt after the first settles', async () => {
  const latch = createRefreshLatch<number>();
  let starts = 0;
  const work = async () => {
    starts += 1;
    return starts;
  };
  await expect(latch.run(work)).resolves.toBe(1);
  await expect(latch.run(work)).resolves.toBe(2);
  expect(starts).toBe(2);
});

test('a failed attempt rejects its caller without an unhandled rejection', async () => {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', record);
  onTestFinished(() => {
    process.off('unhandledRejection', record);
  });
  const latch = createRefreshLatch<number>();

  await expect(latch.run(async () => Promise.reject(new Error('refresh failed')))).rejects.toThrow('refresh failed');
  await new Promise((resolve) => setImmediate(resolve));

  expect(unhandled).toStrictEqual([]);
  await expect(latch.run(async () => 2)).resolves.toBe(2);
});
