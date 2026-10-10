import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import ignoreImport, { type Ignore } from 'ignore';
import type { Host } from '../core/host.ts';
import type { CommitContext, CommitResult, GitPolicy } from '../feature.ts';
import { findGitRoot } from '../settings/config-files.ts';
import { createGitRun, normalizeRepoPath, type GitRun } from './cli.ts';
import { buildCommitMessageRequest, normalizeCommitMessage } from './commit-message.ts';
import { effectiveDirtyCommits } from './options.ts';

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

function aiderIgnorePath(root: string, configured: string | null): string {
  return configured ? resolve(root, configured) : join(root, '.aiderignore');
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

function contextText(context: CommitContext): string {
  return context.kind === 'linter' ? 'Ran the linter' : context.text;
}

export function createGitPolicy(options: CreateGitPolicyOptions): GitPolicy {
  const discovered = options.repoRoot !== undefined ? options.repoRoot : findGitRoot(options.cwd);
  const host = options.host;
  const autoCommits = options.settings.autoCommits;
  const dirtyCommits = effectiveDirtyCommits(autoCommits, options.settings.dirtyCommits);
  const sessionHashes = options.sessionCommitHashes ?? new Set<string>();
  if (discovered === null) {
    return {
      repoRoot: () => null,
      trackedFiles: async () => null,
      needToAdd: async () => false,
      isGitIgnored: async () => false,
      stageNewFile: async () => {},
      needsDirtyCommit: async () => false,
      dirtyCommit: async () => ({ kind: 'disabled' }),
      autoCommit: async () => ({ kind: 'disabled' }),
      undo: async () => ({ kind: 'disabled' }),
    };
  }
  const root: string = discovered;

  const run = options.run ?? createGitRun(host, root);
  const normalize = (path: string) => normalizeRepoPath(root, path);

  async function git(args: readonly string[], signal?: AbortSignal, env?: Readonly<Record<string, string>>) {
    return run(args, { ...(signal ? { signal } : {}), ...(env ? { env } : {}) });
  }

  async function pathInRepo(path: string, signal?: AbortSignal): Promise<boolean> {
    const tracked = await listTracked(signal);
    return tracked.has(normalize(path));
  }

  async function listTracked(signal?: AbortSignal): Promise<Set<string>> {
    const listed = await git(['ls-files', '--cached'], signal);
    if (listed.code !== 0) {
      host.error(`Unable to list files in git repo: ${listed.stderr.trim() || listed.stdout.trim()}`);
      return new Set();
    }
    const aider = loadAiderIgnore(root, options.settings.aiderIgnore);
    const files = new Set<string>();
    for (const line of listed.stdout.split('\n')) {
      if (!line) continue;
      const normalized = normalize(line);
      if (aider?.ignores(normalized)) continue;
      if (options.settings.subtreeOnly) {
        const cwdRel = normalizeRepoPath(root, options.cwd);
        if (cwdRel !== '.' && cwdRel !== '' && normalized !== cwdRel && !normalized.startsWith(`${cwdRel}/`)) continue;
      }
      files.add(normalized);
    }
    return files;
  }

  async function isDirty(path: string, signal?: AbortSignal): Promise<boolean> {
    if (!(await pathInRepo(path, signal))) return true;
    const status = await git(['status', '--porcelain', '--', normalize(path)], signal);
    return status.code === 0 && status.stdout.trim().length > 0;
  }

  async function diffsFor(fnames: readonly string[], signal?: AbortSignal): Promise<string> {
    let diffs = '';
    for (const fname of fnames) {
      if (!(await pathInRepo(fname, signal))) diffs += `Added ${fname}\n`;
    }
    const named = fnames.map(normalize);
    const head = await git(['rev-parse', '--verify', 'HEAD'], signal);
    const args = head.code === 0 ? (['diff', 'HEAD', '--', ...named] as const) : (['diff', '--', ...named] as const);
    const diff = await git(args, signal);
    if (diff.code === 0) diffs += diff.stdout;
    const cached = await git(['diff', '--cached', '--', ...named], signal);
    if (cached.code === 0) diffs += cached.stdout;
    return diffs;
  }

  async function resolveCommitMessage(fnames: readonly string[], context: string | null, signal?: AbortSignal): Promise<string> {
    const diffs = await diffsFor(fnames, signal);
    const request = buildCommitMessageRequest(diffs, context, {
      commitPrompt: options.settings.commitPrompt,
      userLanguage: options.settings.commitLanguage,
    });
    if (options.generateCommitMessage) {
      const generated = await options.generateCommitMessage(request);
      if (generated) return normalizeCommitMessage(generated) || '(no commit message provided)';
    }
    return context?.trim() ? normalizeCommitMessage(context.split('\n')[0] ?? context).slice(0, 72) || 'Update files' : 'Update files';
  }

  async function commitFiles(fnames: readonly string[], context: string | null, aiderEdits: boolean, signal?: AbortSignal): Promise<CommitResult> {
    if (!autoCommits && aiderEdits) return { kind: 'disabled' };
    const diffs = await diffsFor(fnames, signal);
    if (!diffs.trim()) return { kind: 'unchanged' };
    let message = await resolveCommitMessage(fnames, context, signal);
    const attributeAuthor = options.settings.attributeAuthor;
    const attributeCommitter = options.settings.attributeCommitter;
    const attributeCoAuthoredBy = options.settings.attributeCoAuthoredBy;
    const authorExplicit = attributeAuthor !== null;
    const committerExplicit = attributeCommitter !== null;
    const effectiveAuthor = attributeAuthor === null ? true : attributeAuthor;
    const effectiveCommitter = attributeCommitter === null ? true : attributeCommitter;
    const prefix = aiderEdits && (options.settings.attributeCommitMessageAuthor || options.settings.attributeCommitMessageCommitter);
    if (prefix) message = `aider: ${message}`;
    let full = message;
    if (aiderEdits && attributeCoAuthoredBy) {
      full = `${message}\n\nCo-authored-by: aider (unknown-model) <aider@aider.chat>`;
    }
    const useAuthor = aiderEdits && effectiveAuthor && (!attributeCoAuthoredBy || authorExplicit);
    const useCommitter = effectiveCommitter && (!(aiderEdits && attributeCoAuthoredBy) || committerExplicit);
    for (const fname of fnames) {
      const abs = resolve(root, fname);
      const added = await git(['add', '--', abs], signal);
      if (added.code !== 0) host.error(`Unable to add ${fname}: ${added.stderr.trim() || added.stdout.trim()}`);
    }
    const name = await git(['config', '--get', 'user.name'], signal);
    const baseName = name.stdout.trim() || 'User';
    const attributed = `${baseName} (aider)`;
    const env: Record<string, string> = {};
    if (useCommitter) env['GIT_COMMITTER_NAME'] = attributed;
    if (useAuthor) env['GIT_AUTHOR_NAME'] = attributed;
    const commitArgs = ['commit', '-m', full];
    if (!options.settings.gitCommitVerify) commitArgs.push('--no-verify');
    commitArgs.push('--', ...fnames.map((fname) => resolve(root, fname)));
    const committed = await git(commitArgs, signal, Object.keys(env).length ? env : undefined);
    if (committed.code !== 0) {
      const error = committed.stderr.trim() || committed.stdout.trim() || 'commit failed';
      host.error(`Unable to commit: ${error}`);
      return { kind: 'failed', error };
    }
    const hashOut = await git(['rev-parse', '--short', 'HEAD'], signal);
    const hash = hashOut.stdout.trim();
    sessionHashes.add(hash);
    host.output(`Commit ${hash} ${message}`);
    return { kind: 'committed', hash, message };
  }

  return {
    repoRoot: () => root,
    trackedFiles: async () => [...(await listTracked())].sort(),
    needToAdd: async (path) => !(await pathInRepo(path)),
    isGitIgnored: async (path) => {
      const check = await git(['check-ignore', '-q', '--', normalize(path)]);
      return check.code === 0;
    },
    stageNewFile: async (absPath) => {
      if (!autoCommits) return;
      const added = await git(['add', '--', absPath]);
      if (added.code !== 0) host.error(`Unable to add ${absPath}: ${added.stderr.trim() || added.stdout.trim()}`);
    },
    needsDirtyCommit: async (path) => {
      if (!dirtyCommits) return false;
      if (!(await isDirty(path))) return false;
      host.output(`Committing ${path} before applying edits.`);
      return true;
    },
    dirtyCommit: async (paths, signal) => {
      if (!dirtyCommits) return { kind: 'disabled' };
      if (paths.size === 0) return { kind: 'unnecessary' };
      const result = await commitFiles([...paths], null, false, signal);
      if (result.kind === 'failed') return { kind: 'failed', error: result.error };
      if (result.kind === 'unchanged' || result.kind === 'disabled') return { kind: 'unnecessary' };
      return { kind: 'protected' };
    },
    autoCommit: async (paths, context, signal) => {
      if (!autoCommits) return { kind: 'disabled' };
      const fnames = [...paths].filter((path): path is string => path !== null);
      if (fnames.length === 0) return { kind: 'unchanged' };
      return commitFiles(fnames, contextText(context), true, signal);
    },
    undo: async (signal) => {
      const head = await git(['rev-parse', 'HEAD'], signal);
      if (head.code !== 0) return { kind: 'refused', message: 'No git repository found.' };
      const parents = await git(['rev-list', '--parents', '-n', '1', 'HEAD'], signal);
      const parts = parents.stdout.trim().split(/\s+/);
      if (parts.length < 2) return { kind: 'refused', message: 'This is the first commit in the repository. Cannot undo.' };
      if (parts.length > 2) return { kind: 'refused', message: `The last commit ${parts[0]} has more than 1 parent, can't undo.` };
      const short = await git(['rev-parse', '--short', 'HEAD'], signal);
      const hash = short.stdout.trim();
      const msgOut = await git(['log', '-1', '--pretty=%s'], signal);
      const message = msgOut.stdout.trim() || '(unknown)';
      if (!sessionHashes.has(hash)) {
        return { kind: 'refused', message: 'The last commit was not made by aider in this chat session.' };
      }
      const changed = await git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], signal);
      const files = changed.stdout.split('\n').filter(Boolean);
      for (const fname of files) {
        if (await isDirty(fname, signal)) {
          return { kind: 'refused', message: `The file ${fname} has uncommitted changes. Please stash them before undoing.` };
        }
        const inParent = await git(['cat-file', '-e', `HEAD~1:${fname}`], signal);
        if (inParent.code !== 0) {
          return { kind: 'refused', message: `The file ${fname} was not in the repository in the previous commit. Cannot undo safely.` };
        }
      }
      const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], signal);
      const branchName = branch.stdout.trim();
      if (branchName && branchName !== 'HEAD') {
        const remote = await git(['rev-parse', `origin/${branchName}`], signal);
        if (remote.code === 0 && remote.stdout.trim() === head.stdout.trim()) {
          return { kind: 'refused', message: 'The last commit has already been pushed to the origin. Undoing is not possible.' };
        }
      }
      const restored = new Set<string>();
      const unrestored = new Set<string>();
      for (const filePath of files) {
        const checkout = await git(['checkout', 'HEAD~1', '--', filePath], signal);
        if (checkout.code === 0) restored.add(filePath);
        else unrestored.add(filePath);
      }
      if (unrestored.size > 0) {
        const failed = [...unrestored][0] ?? 'file';
        host.error(`Error restoring ${failed}, aborting undo.`);
        host.output('Restored files:');
        for (const file of restored) host.output(`  ${file}`);
        host.output('Unable to restore files:');
        for (const file of unrestored) host.output(`  ${file}`);
        return { kind: 'failed', error: `Error restoring ${failed}, aborting undo.` };
      }
      const reset = await git(['reset', '--soft', 'HEAD~1'], signal);
      if (reset.code !== 0) return { kind: 'failed', error: reset.stderr.trim() || 'reset failed' };
      sessionHashes.delete(hash);
      const nowHash = (await git(['rev-parse', '--short', 'HEAD'], signal)).stdout.trim();
      const nowMessage = (await git(['log', '-1', '--pretty=%s'], signal)).stdout.trim() || '(unknown)';
      return { kind: 'removed', hash, message, nowAt: { hash: nowHash, message: nowMessage } };
    },
  };
}
