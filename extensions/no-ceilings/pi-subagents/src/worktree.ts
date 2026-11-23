import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
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
  readonly signal?: AbortSignal;
}

export type CreateWorktreeResult = { readonly ok: true; readonly worktree: SubagentWorktree } | { readonly ok: false; readonly aborted?: boolean; readonly error: string };

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

function realPath(target: string): string {
  return existsSync(target) ? realpathSync(target) : resolve(target);
}

function nearestExistingDirectory(candidate: string, root: string): string {
  if (!existsSync(root)) {
    return candidate;
  }
  const resolvedRoot = resolve(root);
  let current = resolve(candidate);
  while (!existsSync(current)) {
    if (current === resolvedRoot) {
      return root;
    }
    const parent = dirname(current);
    if (parent === current || relative(resolvedRoot, parent).startsWith('..') || isAbsolute(relative(resolvedRoot, parent))) {
      return root;
    }
    current = parent;
  }
  return current === resolvedRoot ? root : current;
}

export function resolveWorktreeChildCwd(worktree: Pick<SubagentWorktree, 'repoRoot' | 'path'>, parentCwd: string): string {
  const inside = relative(realPath(worktree.repoRoot), realPath(parentCwd));
  const mapped = inside === '' || (!inside.startsWith('..') && !isAbsolute(inside)) ? join(worktree.path, inside) : worktree.path;
  return nearestExistingDirectory(mapped, worktree.path);
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
  if (request.signal?.aborted) {
    return { ok: false, aborted: true, error: 'Worktree creation was cancelled.' };
  }
  const names = buildWorktreeNames(request.description, randomBytes(RANDOM_SUFFIX_BYTES).toString('hex'), request.branchPrefix);
  const root = resolveWorktreeRoot(request);
  const worktreePath = join(root, names.slug);
  const worktree: SubagentWorktree = { repoRoot, path: worktreePath, branch: names.branch, baseRef };
  mkdirSync(root, { recursive: true });
  const added = await git(repoRoot, ['worktree', 'add', '--no-track', '-b', names.branch, worktreePath, baseRef]);
  if (!added.ok) {
    return { ok: false, ...(request.signal?.aborted ? { aborted: true } : {}), error: `Cannot isolate worktree: ${added.stderr.trim() || 'git worktree add failed'}` };
  }
  if (request.signal?.aborted) {
    await discardSubagentWorktree(worktree);
    return { ok: false, aborted: true, error: 'Worktree creation was cancelled.' };
  }
  return { ok: true, worktree };
}

/** Removes a worktree created for a run that was cancelled before it started, including its branch. */
export async function discardSubagentWorktree(worktree: SubagentWorktree): Promise<void> {
  if (existsSync(worktree.path)) {
    await git(worktree.repoRoot, ['worktree', 'remove', '--force', worktree.path]);
  }
  await git(worktree.repoRoot, ['branch', '-D', worktree.branch]);
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
