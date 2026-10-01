import type { RefusalCounter } from './types.ts';

export type SubagentStatsSnapshot = Readonly<{
  spawned: number;
  completed: number;
  failed: number;
  killed: number;
  max_depth: number;
  refused: Readonly<Record<RefusalCounter, number>>;
}>;

export type SubagentStatsDelta = SubagentStatsSnapshot;

const empty: SubagentStatsSnapshot = { spawned: 0, completed: 0, failed: 0, killed: 0, max_depth: 0, refused: { depth_limit: 0, concurrency_limit: 0, budget: 0 } };

export class SubagentStats {
  private current: SubagentStatsSnapshot = empty;

  snapshot(): SubagentStatsSnapshot {
    return structuredClone(this.current);
  }

  spawn(depth: number): void {
    this.current = { ...this.current, spawned: this.current.spawned + 1, max_depth: Math.max(this.current.max_depth, depth) };
  }

  merge(change: SubagentStatsDelta): void {
    const current = this.current;
    this.current = {
      spawned: current.spawned + change.spawned,
      completed: current.completed + change.completed,
      failed: current.failed + change.failed,
      killed: current.killed + change.killed,
      max_depth: Math.max(current.max_depth, change.max_depth),
      refused: {
        depth_limit: current.refused.depth_limit + change.refused.depth_limit,
        concurrency_limit: current.refused.concurrency_limit + change.refused.concurrency_limit,
        budget: current.refused.budget + change.refused.budget,
      },
    };
  }

  refuse(counter: RefusalCounter): void {
    this.current = { ...this.current, refused: { ...this.current.refused, [counter]: this.current.refused[counter] + 1 } };
  }

  settle(status: 'settled' | 'failed' | 'interrupted', abortTelemetry?: string): void {
    if (status === 'interrupted' && abortTelemetry === 'permission_stop_sync') return;
    const key = status === 'settled' ? 'completed' : status === 'failed' ? 'failed' : 'killed';
    this.current = { ...this.current, [key]: this.current[key] + 1 };
  }

  reset(): void {
    this.current = empty;
  }
}
