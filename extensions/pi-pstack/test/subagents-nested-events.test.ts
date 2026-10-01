import { expect, test } from 'vitest';
import { childStatsEvents } from '../src/subagents/nested-depth.ts';
import { SubagentStats } from '../src/subagents/stats.ts';

const empty = { spawned: 0, completed: 0, failed: 0, killed: 0, max_depth: 0, refused: { depth_limit: 0, concurrency_limit: 0, budget: 0 } };

test('[G1-13] child snapshots count new transitions once and retain independent streams', () => {
  const parent = new SubagentStats();
  parent.spawn(1);
  const first = childStatsEvents((change) => parent.merge(change));
  const second = childStatsEvents((change) => parent.merge(change));
  const started = { ...empty, spawned: 1, max_depth: 2 };
  first.emit('pstack:subagent-stats', started);
  first.emit('pstack:subagent-stats', started);
  second.emit('pstack:subagent-stats', started);
  first.emit('pstack:subagent-stats', { ...started, completed: 1 });
  second.emit('pstack:subagent-stats', { ...started, failed: 1, refused: { depth_limit: 1, concurrency_limit: 2, budget: 3 } });
  parent.settle('settled');
  expect(parent.snapshot()).toEqual({ spawned: 3, completed: 2, failed: 1, killed: 0, max_depth: 2, refused: { depth_limit: 1, concurrency_limit: 2, budget: 3 } });
});

test('[G1-13] malformed child telemetry cannot change parent counters', () => {
  const parent = new SubagentStats();
  const events = childStatsEvents((change) => parent.merge(change));
  for (const payload of [null, undefined, '', [], { max_depth: 9 }, { ...empty, spawned: -1 }, { ...empty, completed: '1' }, { ...empty, refused: {} }]) events.emit('pstack:subagent-stats', payload);
  expect(parent.snapshot()).toEqual(empty);
});

test('[G1-13] child outcome corrections propagate as counter deltas without reducing maximum depth', () => {
  const parent = new SubagentStats();
  const events = childStatsEvents((change) => parent.merge(change));
  events.emit('pstack:subagent-stats', { ...empty, spawned: 1, completed: 1, max_depth: 3 });
  events.emit('pstack:subagent-stats', { ...empty, spawned: 1, killed: 1, max_depth: 2 });
  expect(parent.snapshot()).toEqual({ ...empty, spawned: 1, killed: 1, max_depth: 3 });
});
