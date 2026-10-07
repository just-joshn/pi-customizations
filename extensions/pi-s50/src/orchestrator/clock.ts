import { randomUUID } from 'node:crypto';

export type Clock = { readonly now: () => string; readonly id: (prefix: string) => string };

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
  id: (prefix) => `${prefix}-${randomUUID().slice(0, 8)}`,
};

export function fixedClock(start = '2026-10-07T00:00:00.000Z'): Clock {
  let tick = 0;
  let counter = 0;
  const base = Date.parse(start);
  return {
    now: () => new Date(base + 1000 * tick++).toISOString(),
    id: (prefix) => `${prefix}-${++counter}`,
  };
}
