import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { TaskRecord } from '../worker-records.ts';
import type { AgentLaunch } from '../worker-support.ts';
import { discoverAgents } from './definitions.ts';
import { parseJsonAgents } from './json-definitions.ts';
import { type AgentWorktree, finalizeWorktree } from './worktree.ts';

function recordedWorktree(record: TaskRecord): AgentWorktree | undefined {
  const { worktreePath: path, worktreeBranch: branch, worktreeRepoRoot: repoRoot, worktreeBaseCommit: baseCommit } = record;
  if (!record.spawnedWithWorktree || record.worktreeCleanlyRemoved || !path || !branch || !repoRoot || !baseCommit) return undefined;
  return { path, branch, repoRoot, baseCommit };
}

export async function finalizeRecordedWorktree(record: TaskRecord): Promise<Partial<TaskRecord>> {
  const worktree = recordedWorktree(record);
  if (!worktree) return {};
  const outcome = await finalizeWorktree(worktree);
  return outcome.kept ? { worktreeCleanlyRemoved: false, worktreePath: outcome.path, worktreeBranch: outcome.branch } : { worktreeCleanlyRemoved: true };
}

export function resumeLaunch(record: TaskRecord, ctx: ExtensionContext, env: NodeJS.ProcessEnv, flags: string | undefined): AgentLaunch | undefined {
  const flagAgents = flags === undefined ? undefined : parseJsonAgents(flags, ctx.cwd);
  const definition = discoverAgents({ root: ctx.cwd, env, ...(flagAgents ? { flagAgents } : {}) }).activeAgents.find((agent) => agent.agentType === record.persona);
  if (!definition) return undefined;
  return { definition, description: record.description ?? '', depth: record.depth ?? 1, onSettled: finalizeRecordedWorktree };
}
