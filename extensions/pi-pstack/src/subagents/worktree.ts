import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { validateId } from './identifiers.ts';

const git = promisify(execFile);

export type AgentWorktree = Readonly<{ path: string; branch: string; repoRoot: string; baseCommit: string }>;
export type WorktreeOutcome =
  | Readonly<{ kept: false; branchCleanupError?: string }>
  | Readonly<{ kept: true; path: string; branch?: string }>;

async function run(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await git('git', [...args], { cwd });
  return stdout.trim();
}

export async function repositoryRoot(cwd: string): Promise<string | undefined> {
  try {
    return await realpath(await run(cwd, ['rev-parse', '--show-toplevel']));
  } catch {
    return undefined;
  }
}

async function excludeWorktrees(repoRoot: string): Promise<void> {
  const exclude = resolve(repoRoot, await run(repoRoot, ['rev-parse', '--git-path', 'info/exclude']));
  const entry = '.pi/worktrees/';
  const current = await readFile(exclude, 'utf8').catch(() => '');
  if (!current.split('\n').includes(entry)) {
    await mkdir(join(exclude, '..'), { recursive: true });
    await appendFile(exclude, `${current && !current.endsWith('\n') ? '\n' : ''}${entry}\n`);
  }
}

export async function createWorktree(cwd: string, agentId: string): Promise<AgentWorktree> {
  validateId(agentId);
  const repoRoot = await repositoryRoot(cwd);
  if (!repoRoot) {
    throw new Error('Cannot create agent worktree: not in a git repository and no WorktreeCreate hooks are configured. Configure WorktreeCreate/WorktreeRemove hooks in settings.json to use worktree isolation');
  }
  await excludeWorktrees(repoRoot);
  const path = join(repoRoot, '.pi', 'worktrees', `agent-${agentId}`);
  const branch = `worktree-agent-${agentId}`;
  await mkdir(join(repoRoot, '.pi', 'worktrees'), { recursive: true });
  await run(repoRoot, ['worktree', 'add', '-b', branch, path, 'HEAD']);
  const baseCommit = await run(path, ['rev-parse', 'HEAD']);
  return { path: await realpath(path), branch, repoRoot, baseCommit };
}

export async function verifiedWorktree(worktree: Pick<AgentWorktree, 'path' | 'branch' | 'repoRoot'>): Promise<boolean> {
  try {
    if ((await realpath(worktree.path)) !== worktree.path) return false;
    if ((await repositoryRoot(worktree.path)) !== worktree.path) return false;
    const common = await realpath(resolve(worktree.path, await run(worktree.path, ['rev-parse', '--git-common-dir'])));
    const owner = await realpath(resolve(worktree.repoRoot, await run(worktree.repoRoot, ['rev-parse', '--git-common-dir'])));
    if (common !== owner) return false;
    return (await run(worktree.path, ['symbolic-ref', '--short', 'HEAD'])) === worktree.branch;
  } catch {
    return false;
  }
}

export async function finalizeWorktree(worktree: AgentWorktree): Promise<WorktreeOutcome> {
  if (!(await verifiedWorktree(worktree))) return { kept: true, path: worktree.path, branch: worktree.branch };
  const kept = { kept: true, path: worktree.path, branch: worktree.branch } as const;
  const head = await run(worktree.path, ['rev-parse', 'HEAD']);
  const changes = await run(worktree.path, ['status', '--porcelain', '--ignored', '--untracked-files=all']);
  if (head !== worktree.baseCommit || changes) return kept;
  try {
    await run(worktree.repoRoot, ['worktree', 'remove', worktree.path]);
  } catch {
    return kept;
  }
  try {
    await run(worktree.repoRoot, ['branch', '-D', worktree.branch]);
    return { kept: false };
  } catch (error) {
    return { kept: false, branchCleanupError: `Worktree was removed, but branch '${worktree.branch}' remains: ${String(error)}` };
  }
}
