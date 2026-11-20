/** Git worktree isolation: a worker edits its own checkout, which is kept only when it left work behind. */

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as path from 'node:path';

import { CONFIG_DIR_NAME } from '@earendil-works/pi-coding-agent';

const SLUG_BYTES = 3;

export type WorktreeOutcome = { kept: false } | { kept: true; worktreePath: string; branch: string; changedFiles: string[]; commits: number };

export interface SubagentWorktree {
  worktreePath: string;
  branch: string;
  baseCommit: string;
  /** Removes the worktree and its branch when the worker left nothing, and keeps both when it did. */
  finalize: () => Promise<WorktreeOutcome>;
}

function git(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', [...args], { cwd, encoding: 'utf8', windowsHide: true }, (error, stdout) => {
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve(stdout);
    });
  });
}

const slugFor = (agentName: string): string => `subagent-${agentName.replace(/[^a-zA-Z0-9_-]/g, '-')}-${randomBytes(SLUG_BYTES).toString('hex')}`;

async function inspectAndClean(repoRoot: string, worktreePath: string, branch: string, baseCommit: string): Promise<WorktreeOutcome> {
  const changedFiles = (await git(worktreePath, ['status', '--porcelain'])).split('\n').filter((line) => line.trim() !== '');
  const commits = Number((await git(worktreePath, ['rev-list', '--count', 'HEAD', `^${baseCommit}`])).trim());
  if (changedFiles.length > 0 || commits > 0) return { kept: true, worktreePath, branch, changedFiles, commits };
  await git(repoRoot, ['worktree', 'remove', '--force', worktreePath]);
  await git(repoRoot, ['branch', '-D', branch]);
  return { kept: false };
}

// When git cannot say what the worker left, the checkout stays: deleting it could lose work.
const createFinalizer = (repoRoot: string, worktreePath: string, branch: string, baseCommit: string) => (): Promise<WorktreeOutcome> =>
  inspectAndClean(repoRoot, worktreePath, branch, baseCommit).catch((): WorktreeOutcome => ({ kept: true, worktreePath, branch, changedFiles: [], commits: 0 }));

/** Creates a worktree on a new branch at the current commit of the repository that holds `baseCwd`. Throws outside a git repository. */
export async function prepareSubagentWorktree(baseCwd: string, agentName: string): Promise<SubagentWorktree> {
  const [repoRoot, baseCommit] = await Promise.all([git(baseCwd, ['rev-parse', '--show-toplevel']), git(baseCwd, ['rev-parse', 'HEAD'])])
    .then((outputs) => outputs.map((output) => output.trim()))
    .catch((error: unknown) => {
      throw new Error(`Worktree isolation needs a git repository with a commit, and ${baseCwd} has none.`, { cause: error });
    });
  if (!repoRoot || !baseCommit) throw new Error(`Worktree isolation could not read the repository at ${baseCwd}.`);
  const slug = slugFor(agentName);
  const worktreePath = path.join(repoRoot, CONFIG_DIR_NAME, 'worktrees', slug);
  const branch = `worktree/${slug}`;
  await git(repoRoot, ['worktree', 'add', '--no-track', '-b', branch, worktreePath, 'HEAD']);
  return { worktreePath, branch, baseCommit, finalize: createFinalizer(repoRoot, worktreePath, branch, baseCommit) };
}

/** The line a report carries when its worktree was kept. */
export const worktreeNote = (outcome: Extract<WorktreeOutcome, { kept: true }>): string => `Worktree kept: ${outcome.worktreePath} (branch ${outcome.branch})`;
