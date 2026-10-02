import type { SessionManager } from '@earendil-works/pi-coding-agent';

type Entry = ReturnType<SessionManager['getBranch']>[number];

export type RestoredContext = Readonly<{ agentId: string | undefined; depth: number }>;

function lastData(branch: readonly Entry[], customType: string): unknown {
  const entry = branch.findLast((candidate) => candidate.type === 'custom' && candidate.customType === customType);
  return entry?.type === 'custom' ? entry.data : undefined;
}

/** Reads the identity a child session saved with saveChildContext. */
export function restoredContext(branch: readonly Entry[]): RestoredContext {
  const depth = lastData(branch, 'pstack-agent-depth');
  const identity = lastData(branch, 'pstack-agent-identity');
  return { agentId: typeof identity === 'string' ? identity : undefined, depth: typeof depth === 'number' && Number.isSafeInteger(depth) && depth > 0 ? depth : 0 };
}
