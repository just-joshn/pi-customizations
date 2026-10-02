import { expect, test } from 'vitest';
import { SubagentLimiter } from '../src/subagents/limiter.ts';

const limiter = (maxConcurrent = 2, maxDepth = 4) => new SubagentLimiter({ maxConcurrent, maxDepth });

test('a spawn at the concurrent limit is rejected with the model-visible text', () => {
  const pool = limiter(1);
  expect(pool.tryAcquire({ kind: 'spawn', depth: 0 }).ok).toBe(true);
  expect(pool.tryAcquire({ kind: 'spawn', depth: 0 })).toEqual({ ok: false, limit: 'concurrent', message: 'Maximum concurrent agent limit of 1 reached. Wait for existing agents to complete before spawning new ones.' });
});

test('a resume at the limit uses the em dash text with no agent id', () => {
  const pool = limiter(1);
  pool.tryAcquire({ kind: 'spawn', depth: 0 });
  expect(pool.tryAcquire({ kind: 'resume' })).toEqual({ ok: false, limit: 'concurrent', message: 'Cannot resume agent \u2014 all 1 concurrent agent slots are in use. Try again after an active agent completes.' });
});

test('a spawn from the depth limit is rejected', () => {
  expect(limiter(5, 4).tryAcquire({ kind: 'spawn', depth: 4 })).toEqual({ ok: false, limit: 'depth', message: 'Maximum sub-agent depth of 4 reached. Complete this task without spawning further sub-agents.' });
});

test('a spawn below the depth limit passes and a resume ignores depth', () => {
  const pool = limiter(5, 4);
  expect(pool.tryAcquire({ kind: 'spawn', depth: 3 }).ok).toBe(true);
  expect(pool.tryAcquire({ kind: 'resume' }).ok).toBe(true);
});

test('depth is checked before concurrency', () => {
  const pool = limiter(1, 1);
  pool.tryAcquire({ kind: 'spawn', depth: 0 });
  expect(pool.tryAcquire({ kind: 'spawn', depth: 1 })).toMatchObject({ ok: false, limit: 'depth' });
});

test('releasing a slot frees it and a second release changes nothing', () => {
  const pool = limiter(1);
  const first = pool.tryAcquire({ kind: 'spawn', depth: 0 });
  if (!first.ok) throw new Error(first.message);
  first.release();
  first.release();
  const second = pool.tryAcquire({ kind: 'spawn', depth: 0 });
  expect(second.ok).toBe(true);
  expect(pool.info()).toEqual({ maxConcurrent: 1, maxDepth: 4, active: 1 });
  expect(pool.tryAcquire({ kind: 'spawn', depth: 0 }).ok).toBe(false);
});

test('a rejected acquire holds no slot', () => {
  const pool = limiter(1);
  pool.tryAcquire({ kind: 'spawn', depth: 0 });
  pool.tryAcquire({ kind: 'spawn', depth: 0 });
  expect(pool.info().active).toBe(1);
});
