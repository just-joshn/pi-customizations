import { randomUUID } from 'node:crypto';

export type Clock = { readonly now: () => string; readonly id: (prefix: string) => string };

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
  id: (prefix) => `${prefix}-${randomUUID().slice(0, 8)}`,
};
