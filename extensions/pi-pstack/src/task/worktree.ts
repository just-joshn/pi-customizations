// The worktree driver of an environment "cloud" agent: a git worktree on this host on a new branch, used when no
// container engine is available. Records and transcripts stay keyed on the parent workspace, never on the worktree.
import { execFile, execFileSync } from 'node:child_process';
import { join } from 'node:path';

import type { WorktreeMachine } from '../cloud/machine.ts';

function git(dir: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** undefined when git ran and exited non-zero; a git that cannot start still throws. */
function tryGit(dir: string, args: readonly string[]): string | undefined {
  try {
    return git(dir, args);
  } catch (error) {
    if (typeof (error as { status?: unknown }).status === 'number') return undefined;
    throw error;
  }
}

const commitOf = (dir: string, ref: string) => tryGit(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);

function resolveBase(cwd: string, baseBranch: string | undefined): { base: string; commit: string } {
  if (baseBranch === undefined) {
    const commit = commitOf(cwd, 'HEAD');
    if (commit === undefined) throw new Error(`environment "cloud" branches the subagent's worktree from HEAD, but ${cwd} has no commits yet.`);
    return { base: 'HEAD', commit };
  }
  // Cursor's cloud workers start from the pushed branch, so the remote-tracking ref wins over a local branch that may be
  // behind it. A local-only branch or any other ref still works when no origin ref of that name exists.
  for (const base of [`origin/${baseBranch}`, baseBranch]) {
    const commit = commitOf(cwd, base);
    if (commit !== undefined) return { base, commit };
  }
  throw new Error(`cloud_base_branch "${baseBranch}" names no commit in ${cwd}: neither origin/${baseBranch} nor ${baseBranch} exists. Pass an existing branch or omit cloud_base_branch to start from HEAD.`);
}

/** Resolves where a cloud agent will run without changing anything, so a bad base fails before any side effect. */
export function planWorktree(cwd: string, worktreesDir: string, agentId: string, baseBranch?: string): WorktreeMachine {
  const prefix = tryGit(cwd, ['rev-parse', '--show-prefix'])?.replace(/\/$/, '');
  if (prefix === undefined) throw new Error(`environment "cloud" runs the subagent in its own git worktree, but ${cwd} is not inside a git repository. Omit environment to run the subagent here.`);
  const { base, commit } = resolveBase(cwd, baseBranch);
  const path = join(worktreesDir, agentId);
  const inBase = prefix !== '' && tryGit(cwd, ['cat-file', '-e', `${commit}:${prefix}`]) !== undefined;
  return { driver: 'worktree', path, cwd: inBase ? join(path, prefix) : path, branch: `pstack/${agentId}`, base, commit };
}

/** Creates the worktree and its branch. Nothing here removes them: the parent merges the branch, and worktree-cleanup prunes. */
export function addWorktree(repoDir: string, worktree: WorktreeMachine, signal: AbortSignal | undefined): Promise<void> {
  // A checkout can run hooks and filters for a long time, so it runs off the event loop and stops with the Task call.
  const args = ['-C', repoDir, 'worktree', 'add', '--quiet', '-b', worktree.branch, worktree.path, worktree.commit];
  return new Promise((resolve, reject) => {
    execFile('git', args, { encoding: 'utf8', ...(signal === undefined ? {} : { signal }) }, (error, _stdout, stderr) => {
      if (error === null) resolve();
      else if (signal?.aborted === true) reject(new Error(`Stopped creating the subagent's worktree at ${worktree.path}.`));
      else reject(new Error(`Could not create the subagent's worktree at ${worktree.path}: ${(stderr || error.message).trim()}`));
    });
  });
}
