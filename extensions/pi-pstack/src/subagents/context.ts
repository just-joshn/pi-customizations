import { AsyncLocalStorage } from 'node:async_hooks';

export const depthStore = new AsyncLocalStorage<number>();

export function currentDepth(): number {
  return depthStore.getStore() ?? 0;
}
