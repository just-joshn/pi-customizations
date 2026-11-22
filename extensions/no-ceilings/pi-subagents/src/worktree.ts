import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { type SubagentWorktree, WORKTREE_SLUG_CHARS, WORKTREE_SUFFIX_CHARS, ZERO } from './types.ts';

const execFileAsync = promisify(execFile);

const GIT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const DIFF_STAT_MAX_CHARS = 4000;
const SLUG_SEPARATOR = '-';
const NON_SLUG_CHARS = /[^a-z0-9]+/g;
const EDGE_SEPARATORS = /^-+|-+$/g;
const FALLBACK_SLUG = 'subagent';
const WORKTREES_DIR_NAME = 'worktrees';
const RANDOM_SUFFIX_BYTES = 2;

export interface WorktreeRequest {
  readonly cwd: string;
  readonly description: string;
  readonly agentId: string;
  readonly sessionDir: string | undefined;
  readonly root: string | undefined;
  readonly branchPrefix: string;
}

export type CreateWorktreeResult = { readonly ok: true; readonly worktree: SubagentWorktree } | { readonly ok: false; readonly error: string };

interface GitResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

async function git(cwd: string, args: readonly string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['-C', cwd, ...args], { maxBuffer: GIT_MAX_BUFFER_BYTES });
    return { ok: true, stdout, stderr };
  } catch (error) {
    const stderr = error instanceof Error ? error.message : String(error);
    return { ok: false, stdout: '', stderr };
  }
}

export function slugifyWorktreeLabel(description: string): string {
  const slug = description.toLowerCase().replace(NON_SLUG_CHARS, SLUG_SEPARATOR).replace(EDGE_SEPARATORS, '').slice(ZERO, WORKTREE_SLUG_CHARS).replace(EDGE_SEPARATORS, '');
  return slug.length > ZERO ? slug : FALLBACK_SLUG;
}

export function buildWorktreeNames(description: string, randomSuffix: string, branchPrefix: string): { readonly slug: string; readonly branch: string } {
  const slug = `${slugifyWorktreeLabel(description)}-${randomSuffix.slice(ZERO, WORKTREE_SUFFIX_CHARS)}`;
  return { slug, branch: `${branchPrefix}/${slug}` };
}

export function resolveWorktreeRoot(request: Pick<WorktreeRequest, 'root' | 'sessionDir'>): string {
  if (request.root !== undefined) {
    return request.root;
  }
  if (request.sessionDir !== undefined && request.sessionDir.trim().length > ZERO) {
    return join(request.sessionDir, WORKTREES_DIR_NAME);
  }
  return join(tmpdir(), 'pi-subagents-worktrees');
}

async function readRepoRoot(cwd: string): Promise<string | undefined> {
  const result = await git(cwd, ['rev-parse', '--show-toplevel']);
  const root = result.stdout.trim();
  return result.ok && root.length > ZERO ? root : undefined;
}

async function readHeadRef(repoRoot: string): Promise<string | undefined> {
  const result = await git(repoRoot, ['rev-parse', 'HEAD']);
  const head = result.stdout.trim();
  return result.ok && head.length > ZERO ? head : undefined;
}

/** Creates a git worktree on its own branch so a subagent can edit files without racing the parent. */
export async function createSubagentWorktree(request: WorktreeRequest): Promise<CreateWorktreeResult> {
  const repoRoot = await readRepoRoot(request.cwd);
  if (repoRoot === undefined) {
    return { ok: false, error: `Cannot isolate worktree: ${request.cwd} is not inside a git repository.` };
  }
  const baseRef = await readHeadRef(repoRoot);
  if (baseRef === undefined) {
    return { ok: false, error: 'Cannot isolate worktree: the repository has no commit to branch from.' };
  }
  const names = buildWorktreeNames(request.description, randomBytes(RANDOM_SUFFIX_BYTES).toString('hex'), request.branchPrefix);
  const root = resolveWorktreeRoot(request);
  const worktreePath = join(root, names.slug);
  mkdirSync(root, { recursive: true });
  const added = await git(repoRoot, ['worktree', 'add', '--no-track', '-b', names.branch, worktreePath, baseRef]);
  if (!added.ok) {
    return { ok: false, error: `Cannot isolate worktree: ${added.stderr.trim() || 'git worktree add failed'}` };
  }
  return { ok: true, worktree: { repoRoot, path: worktreePath, branch: names.branch, baseRef } };
}

/** A short parent-facing summary of what the isolated run changed. */
export async function summarizeWorktreeDiff(worktree: SubagentWorktree): Promise<string> {
  const stat = await git(worktree.path, ['diff', '--stat', worktree.baseRef]);
  const status = await git(worktree.path, ['status', '--porcelain']);
  const statText = stat.ok ? stat.stdout.trim() : '';
  const statusText = status.ok ? status.stdout.trim() : '';
  const body = [statText, statusText === '' ? '' : `untracked or staged:\n${statusText}`].filter((part) => part.length > ZERO).join('\n\n');
  return body.slice(ZERO, DIFF_STAT_MAX_CHARS);
}

/** Removes the worktree directory. The branch stays so the parent can review and merge it. */
export async function removeSubagentWorktree(worktree: SubagentWorktree): Promise<{ readonly ok: boolean; readonly error?: string }> {
  if (!existsSync(worktree.path)) {
    return { ok: true };
  }
  const removed = await git(worktree.repoRoot, ['worktree', 'remove', worktree.path]);
  if (removed.ok) {
    return { ok: true };
  }
  return { ok: false, error: removed.stderr.trim() || 'git worktree remove failed' };
}
