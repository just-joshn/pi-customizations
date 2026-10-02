import { AsyncLocalStorage } from 'node:async_hooks';

import type { SubagentLimiter } from './limiter.ts';

export type SubagentScope = Readonly<{ depth: number; limiter: SubagentLimiter; agentId?: string; registryId?: string; rootSessionId: string }>;

const store = new AsyncLocalStorage<SubagentScope>();

export function currentScope(): SubagentScope | undefined {
  return store.getStore();
}

export function inScope<T>(scope: SubagentScope, run: () => T): T {
  return store.run(scope, run);
}
