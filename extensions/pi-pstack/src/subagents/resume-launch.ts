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

export async function finalizeRecordedWorktree(record: TaskRecord, keptAlive: boolean): Promise<Partial<TaskRecord>> {
  const worktree = recordedWorktree(record);
  if (!worktree) return {};
  const outcome = keptAlive ? ({ kept: true, path: worktree.path, branch: worktree.branch } as const) : await finalizeWorktree(worktree);
  return outcome.kept ? { worktreeCleanlyRemoved: false, worktreePath: outcome.path, worktreeBranch: outcome.branch } : { worktreeCleanlyRemoved: true };
}

type ResumeContext = Readonly<{ env: NodeJS.ProcessEnv; flags: string | undefined; keepsAlive: (id: string) => boolean }>;

export function resumeLaunch(record: TaskRecord, ctx: ExtensionContext, { env, flags, keepsAlive }: ResumeContext): AgentLaunch | undefined {
  const flagAgents = flags === undefined ? undefined : parseJsonAgents(flags, ctx.cwd);
  const definition = discoverAgents({ root: ctx.cwd, env, ...(flagAgents ? { flagAgents } : {}) }).activeAgents.find((agent) => agent.agentType === record.persona);
  if (!definition) return undefined;
  return { definition, description: record.description ?? '', depth: record.depth ?? 1, onSettled: (finished) => finalizeRecordedWorktree(finished, keepsAlive(finished.id)) };
}
