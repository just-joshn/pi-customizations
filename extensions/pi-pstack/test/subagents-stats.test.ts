import { expect, test } from 'vitest';
import { SubagentStats } from '../src/subagents/stats.ts';

const empty = { spawned: 0, completed: 0, failed: 0, killed: 0, max_depth: 0, refused: { depth_limit: 0, concurrency_limit: 0, budget: 0 } };

test('statistics retain independent literal snapshots across transitions', () => {
  const stats = new SubagentStats();
  const first = stats.snapshot();
  stats.spawn(1);
  stats.spawn(4);
  stats.refuse('depth_limit');
  stats.refuse('concurrency_limit');
  stats.refuse('budget');
  stats.settle('settled');
  stats.settle('failed');
  stats.settle('interrupted');
  expect(first).toEqual(empty);
  expect(stats.snapshot()).toEqual({ spawned: 2, completed: 1, failed: 1, killed: 1, max_depth: 4, refused: { depth_limit: 1, concurrency_limit: 1, budget: 1 } });
  expect(stats.snapshot()).not.toBe(stats.snapshot());
  expect(stats.snapshot().refused).not.toBe(stats.snapshot().refused);
});

test('reset returns every statistic to zero', () => {
  const stats = new SubagentStats();
  stats.spawn(3);
  stats.refuse('budget');
  stats.settle('failed');
  stats.reset();
  expect(stats.snapshot()).toEqual(empty);
});
