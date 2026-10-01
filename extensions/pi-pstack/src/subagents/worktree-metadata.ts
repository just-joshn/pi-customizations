import type { TaskRecord } from '../worker-records.ts';
import type { AgentWorktree } from './worktree.ts';

export type LaunchProvenance = Readonly<{ requestedIsolation?: 'worktree' | 'remote'; parentAgentId?: string; worktree?: AgentWorktree }>;

function worktreeFields(worktree: AgentWorktree): Partial<TaskRecord> {
  return {
    spawnedWithWorktree: true,
    worktreeCleanlyRemoved: false,
    worktreePath: worktree.path,
    worktreeBranch: worktree.branch,
    worktreeRepoRoot: worktree.repoRoot,
    worktreeBaseCommit: worktree.baseCommit,
  };
}

export function provenanceFields(launch: LaunchProvenance | undefined): Partial<TaskRecord> {
  if (!launch) return {};
  return {
    ...(launch.requestedIsolation ? { requestedIsolation: launch.requestedIsolation } : {}),
    ...(launch.parentAgentId ? { parentAgentId: launch.parentAgentId } : {}),
    ...(launch.worktree ? worktreeFields(launch.worktree) : {}),
  };
}
