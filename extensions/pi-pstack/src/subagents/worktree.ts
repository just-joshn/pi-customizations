import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const git = promisify(execFile);

export type AgentWorktree = Readonly<{ path: string; branch: string; repoRoot: string; baseCommit: string }>;
export type WorktreeOutcome = Readonly<{ kept: false }> | Readonly<{ kept: true; path: string; branch: string }>;

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
  const exclude = join(repoRoot, await run(repoRoot, ['rev-parse', '--git-path', 'info/exclude']));
  const entry = '.pi/worktrees/';
  const current = await readFile(exclude, 'utf8').catch(() => '');
  if (!current.split('\n').includes(entry)) {
    await mkdir(join(exclude, '..'), { recursive: true });
    await appendFile(exclude, `${current && !current.endsWith('\n') ? '\n' : ''}${entry}\n`);
  }
}

export async function createWorktree(cwd: string, agentId: string): Promise<AgentWorktree> {
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

export async function finalizeWorktree(worktree: AgentWorktree): Promise<WorktreeOutcome> {
  const identity = await realpath(worktree.path).catch(() => undefined);
  if (!identity || identity !== worktree.path) return { kept: true, path: worktree.path, branch: worktree.branch };
  const head = await run(worktree.path, ['rev-parse', 'HEAD']);
  const dirty = await run(worktree.path, ['status', '--porcelain']);
  if (head !== worktree.baseCommit || dirty) return { kept: true, path: worktree.path, branch: worktree.branch };
  await run(worktree.repoRoot, ['worktree', 'remove', '--force', worktree.path]);
  await run(worktree.repoRoot, ['branch', '-D', worktree.branch]);
  return { kept: false };
}
