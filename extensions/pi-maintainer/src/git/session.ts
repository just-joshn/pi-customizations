import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import ignoreImport, { type Ignore } from 'ignore';
import type { ExecOutcome, Host } from '../core/host.ts';
import { type GitRun, normalizeRepoPath } from './cli.ts';

const createIgnore = ignoreImport as unknown as () => Ignore;

export interface GitPolicySettings {
  readonly autoCommits: boolean;
  readonly dirtyCommits: boolean;
  readonly gitCommitVerify: boolean;
  readonly attributeAuthor: boolean | null;
  readonly attributeCommitter: boolean | null;
  readonly attributeCommitMessageAuthor: boolean;
  readonly attributeCommitMessageCommitter: boolean;
  readonly attributeCoAuthoredBy: boolean;
  readonly commitPrompt: string | null;
  readonly aiderIgnore: string | null;
  readonly subtreeOnly: boolean;
  readonly commitLanguage: string | null;
}

export interface CreateGitPolicyOptions {
  readonly host: Host;
  readonly cwd: string;
  readonly settings: GitPolicySettings;
  /**
   * Pre-validated root from startup. `null` disables the port. When omitted, discover from `cwd`.
   */
  readonly repoRoot?: string | null;
  /** Injected commit-message models. When absent, commits use a short fallback message. */
  readonly generateCommitMessage?: (request: { readonly system: string; readonly user: string }) => Promise<string | null>;
  readonly run?: GitRun;
  readonly sessionCommitHashes?: Set<string>;
}

/** Everything the git operations share for one discovered repository. */
export interface GitSession {
  readonly root: string;
  readonly host: Host;
  readonly options: CreateGitPolicyOptions;
  readonly sessionHashes: Set<string>;
  readonly run: GitRun;
}

/** `aider.args.resolve_aiderignore_path`: absolute stays absolute; relative joins the git root when present. */
export function resolveAiderIgnorePath(path: string, gitRoot?: string | null): string {
  if (isAbsolute(path)) return path;
  if (gitRoot) return join(gitRoot, path);
  return path;
}

function aiderIgnorePath(root: string, configured: string | null): string {
  return configured ? resolveAiderIgnorePath(configured, root) : join(root, '.aiderignore');
}

function loadAiderIgnore(root: string, configured: string | null): Ignore | null {
  const path = aiderIgnorePath(root, configured);
  if (!existsSync(path)) return null;
  try {
    return createIgnore().add(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function git(s: GitSession, args: readonly string[], signal?: AbortSignal, env?: Readonly<Record<string, string>>): Promise<ExecOutcome> {
  return s.run(args, { ...(signal ? { signal } : {}), ...(env ? { env } : {}) });
}

export function normalize(s: GitSession, path: string): string {
  return normalizeRepoPath(s.root, path);
}

/** Trimmed stderr, falling back to stdout, for git error notices. */
export function gitError(outcome: ExecOutcome): string {
  return outcome.stderr.trim() || outcome.stdout.trim();
}

export function outsideSubtree(s: GitSession, normalized: string): boolean {
  if (!s.options.settings.subtreeOnly) return false;
  const cwdRel = normalizeRepoPath(s.root, s.options.cwd);
  if (cwdRel === '.' || cwdRel === '') return false;
  return normalized !== cwdRel && !normalized.startsWith(`${cwdRel}/`);
}

export function isAiderIgnored(s: GitSession, normalized: string): boolean {
  const aider = loadAiderIgnore(s.root, s.options.settings.aiderIgnore);
  return aider?.ignores(normalized) ?? false;
}

export async function listTracked(s: GitSession, signal?: AbortSignal): Promise<Set<string>> {
  const listed = await git(s, ['ls-files', '--cached'], signal);
  if (listed.code !== 0) {
    s.host.error(`Unable to list files in git repo: ${gitError(listed)}`);
    return new Set();
  }
  const files = new Set<string>();
  for (const line of listed.stdout.split('\n')) {
    if (!line) continue;
    const normalized = normalize(s, line);
    if (isAiderIgnored(s, normalized) || outsideSubtree(s, normalized)) continue;
    files.add(normalized);
  }
  return files;
}

export async function pathInRepo(s: GitSession, path: string, signal?: AbortSignal): Promise<boolean> {
  const tracked = await listTracked(s, signal);
  return tracked.has(normalize(s, path));
}

export async function isDirty(s: GitSession, path?: string, signal?: AbortSignal): Promise<boolean> {
  if (path !== undefined) {
    if (!(await pathInRepo(s, path, signal))) return true;
    const status = await git(s, ['status', '--porcelain', '--', normalize(s, path)], signal);
    return status.code === 0 && status.stdout.trim().length > 0;
  }
  const status = await git(s, ['status', '--porcelain', '--untracked-files=no'], signal);
  return status.code === 0 && status.stdout.trim().length > 0;
}

/** Attached branch with at least one commit. Detached HEAD and unborn branches are false. */
async function branchHasCommits(s: GitSession, signal?: AbortSignal): Promise<boolean> {
  const symbolic = await git(s, ['symbolic-ref', '-q', 'HEAD'], signal);
  if (symbolic.code !== 0) return false;
  const head = await git(s, ['rev-parse', '--verify', 'HEAD'], signal);
  return head.code === 0;
}

async function diffText(s: GitSession, args: readonly string[], signal?: AbortSignal): Promise<string> {
  const diff = await git(s, args, signal);
  if (diff.code === 0) return diff.stdout;
  s.host.error(`Unable to diff: ${gitError(diff)}`);
  return '';
}

export async function diffsFor(s: GitSession, fnames: readonly string[] = [], signal?: AbortSignal): Promise<string> {
  let diffs = '';
  for (const fname of fnames) {
    if (!(await pathInRepo(s, fname, signal))) diffs += `Added ${fname}\n`;
  }
  const named = fnames.map((fname) => normalize(s, fname));
  if (await branchHasCommits(s, signal)) return diffs + (await diffText(s, ['diff', 'HEAD', '--', ...named], signal));
  diffs += await diffText(s, ['diff', '--cached', '--', ...named], signal);
  return diffs + (await diffText(s, ['diff', '--', ...named], signal));
}

export function diffCommits(s: GitSession, fromCommit: string, toCommit: string, signal?: AbortSignal): Promise<string> {
  return diffText(s, ['diff', '--color=never', fromCommit, toCommit], signal);
}
