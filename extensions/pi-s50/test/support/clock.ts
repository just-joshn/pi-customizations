import type { Clock } from '../../src/orchestrator/clock.ts';

export function fixedClock(start = '2026-10-07T00:00:00.000Z'): Clock {
  let tick = 0;
  const counters = new Map<string, number>();
  const base = Date.parse(start);
  return {
    now: () => new Date(base + 1000 * tick++).toISOString(),
    id: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}-${next}`;
    },
  };
}
