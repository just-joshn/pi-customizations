import type { TaskRecord } from '../worker-records.ts';
import type { AgentCheckout } from './worktree-hooks.ts';

export type LaunchProvenance = Readonly<{ requestedIsolation?: 'worktree' | 'remote'; parentAgentId?: string; worktree?: AgentCheckout }>;

function worktreeFields(worktree: AgentCheckout): Partial<TaskRecord> {
  const binding = 'hookBased' in worktree ? { worktreeHookBased: true } : { worktreeBranch: worktree.branch, worktreeRepoRoot: worktree.repoRoot, worktreeBaseCommit: worktree.baseCommit };
  return { spawnedWithWorktree: true, worktreeCleanlyRemoved: false, worktreePath: worktree.path, ...binding };
}

export function provenanceFields(launch: LaunchProvenance | undefined): Partial<TaskRecord> {
  if (!launch) return {};
  return {
    ...(launch.requestedIsolation ? { requestedIsolation: launch.requestedIsolation } : {}),
    ...(launch.parentAgentId ? { parentAgentId: launch.parentAgentId } : {}),
    ...(launch.worktree ? worktreeFields(launch.worktree) : {}),
  };
}
