import type { SessionManager } from '@earendil-works/pi-coding-agent';

type Entry = ReturnType<SessionManager['getBranch']>[number];

export type RestoredContext = Readonly<{
  appendedPrompt: string | undefined;
  inheritedDefinitions: string | undefined;
  agentId: string | undefined;
  ownWorktree: string | undefined;
  depth: number;
  allowedAgentTypes: string[] | undefined;
  invalidScope: boolean;
}>;

function lastData(branch: readonly Entry[], customType: string): unknown {
  const entry = branch.findLast((candidate) => candidate.type === 'custom' && candidate.customType === customType);
  return entry?.type === 'custom' ? entry.data : undefined;
}

function text(data: unknown): string | undefined {
  return typeof data === 'string' ? data : undefined;
}

/** Reads the identity and policy a child session saved with saveChildContext. */
export function restoredContext(branch: readonly Entry[]): RestoredContext {
  const depth = lastData(branch, 'pstack-agent-depth');
  const scope = lastData(branch, 'pstack-agent-allowed-types');
  const valid = Array.isArray(scope) && scope.every((name) => typeof name === 'string');
  const unscoped = scope === null || scope === undefined;
  return {
    appendedPrompt: text(lastData(branch, 'pstack-append-subagent-system-prompt')),
    inheritedDefinitions: text(lastData(branch, 'pstack-agent-definition-overrides')),
    agentId: text(lastData(branch, 'pstack-agent-identity')),
    ownWorktree: text(lastData(branch, 'pstack-agent-worktree')),
    depth: typeof depth === 'number' && Number.isSafeInteger(depth) && depth > 0 ? depth : 0,
    allowedAgentTypes: unscoped ? undefined : valid ? [...scope] : [],
    invalidScope: !unscoped && !valid,
  };
}
