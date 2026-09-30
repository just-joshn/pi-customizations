import type { RefusalCounter } from './types.ts';

export type SubagentStatsSnapshot = Readonly<{
  spawned: number;
  completed: number;
  failed: number;
  killed: number;
  max_depth: number;
  refused: Readonly<Record<RefusalCounter, number>>;
}>;

const empty: SubagentStatsSnapshot = { spawned: 0, completed: 0, failed: 0, killed: 0, max_depth: 0, refused: { depth_limit: 0, concurrency_limit: 0, budget: 0 } };

export class SubagentStats {
  private current: SubagentStatsSnapshot = empty;

  snapshot(): SubagentStatsSnapshot {
    return this.current;
  }

  spawn(depth: number): void {
    this.current = { ...this.current, spawned: this.current.spawned + 1, max_depth: Math.max(this.current.max_depth, depth) };
  }

  refuse(counter: RefusalCounter): void {
    this.current = { ...this.current, refused: { ...this.current.refused, [counter]: this.current.refused[counter] + 1 } };
  }

  settle(status: 'settled' | 'failed' | 'interrupted'): void {
    const key = status === 'settled' ? 'completed' : status === 'failed' ? 'failed' : 'killed';
    this.current = { ...this.current, [key]: this.current[key] + 1 };
  }

  reset(): void {
    this.current = empty;
  }
}
