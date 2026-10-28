import type { CommitContext, GitPolicy } from '../feature.ts';
import { findGitRoot } from '../settings/config-files.ts';
import { createGitRun } from './cli.ts';
import { commitFiles } from './commit.ts';
import { effectiveDirtyCommits } from './options.ts';
import { type CreateGitPolicyOptions, diffCommits, diffsFor, type GitSession, git, gitError, isAiderIgnored, isDirty, listTracked, normalize, outsideSubtree, pathInRepo } from './session.ts';
import { undoLastCommit } from './undo.ts';

export { type CreateGitPolicyOptions, type GitPolicySettings, resolveAiderIgnorePath } from './session.ts';

const disabledPolicy: GitPolicy = {
  repoRoot: () => null,
  trackedFiles: async () => null,
  needToAdd: async () => false,
  isGitIgnored: async () => false,
  isIgnored: async () => false,
  addsGitignoredFiles: () => false,
  stageNewFile: async () => {},
  isDirty: async () => false,
  needsDirtyCommit: async () => false,
  dirtyCommit: async () => ({ kind: 'disabled' }),
  autoCommit: async () => ({ kind: 'disabled' }),
  undo: async () => ({ kind: 'disabled' }),
  getDiffs: async () => '',
  diffCommits: async () => '',
  commitDirty: async () => ({ kind: 'disabled' }),
  noteMessageCheckpoint: async () => {},
  diffForDisplay: async () => ({ kind: 'disabled' }),
};

function contextText(context: CommitContext): string {
  return context.kind === 'linter' ? 'Ran the linter' : context.text;
}

/** Path queries and staging: what is tracked, ignored, or dirty. */
function pathMethods(s: GitSession, dirtyCommits: boolean) {
  return {
    repoRoot: () => s.root,
    trackedFiles: async () => [...(await listTracked(s))].sort(),
    needToAdd: async (path: string) => !(await pathInRepo(s, path)),
    isGitIgnored: async (path: string) => (await git(s, ['check-ignore', '-q', '--', normalize(s, path)])).code === 0,
    isIgnored: async (path: string) => {
      const normalized = normalize(s, path);
      return outsideSubtree(s, normalized) || isAiderIgnored(s, normalized);
    },
    addsGitignoredFiles: () => s.options.settings.addGitignoreFiles,
    stageNewFile: async (absPath: string) => {
      if (!s.options.settings.autoCommits) return;
      const added = await git(s, ['add', '--', absPath]);
      if (added.code !== 0) s.host.error(`Unable to add ${absPath}: ${gitError(added)}`);
    },
    isDirty: (path?: string, signal?: AbortSignal) => isDirty(s, path, signal),
    needsDirtyCommit: async (path: string) => {
      if (!dirtyCommits || !(await isDirty(s, path))) return false;
      s.host.output(`Committing ${path} before applying edits.`);
      return true;
    },
  } satisfies Partial<GitPolicy>;
}

/** Dirty, automatic, and manual commits. */
function commitMethods(s: GitSession, dirtyCommits: boolean) {
  return {
    dirtyCommit: async (paths, signal) => {
      if (!dirtyCommits) return { kind: 'disabled' };
      if (paths.size === 0) return { kind: 'unnecessary' };
      const result = await commitFiles(s, { fnames: [...paths], context: null, aiderEdits: false, signal });
      if (result.kind === 'failed') return { kind: 'failed', error: result.error };
      if (result.kind === 'unchanged' || result.kind === 'disabled') return { kind: 'unnecessary' };
      return { kind: 'protected' };
    },
    autoCommit: async (paths, context, signal) => {
      if (!s.options.settings.autoCommits) return { kind: 'disabled' };
      const fnames = [...paths].filter((path): path is string => path !== null);
      if (fnames.length === 0) return { kind: 'unchanged' };
      return commitFiles(s, { fnames, context: contextText(context), aiderEdits: true, signal });
    },
    commitDirty: async (message, signal) => {
      const forcedMessage = message?.trim() ? message : undefined;
      const result = await commitFiles(s, { fnames: null, context: null, aiderEdits: false, signal, forcedMessage });
      if (result.kind === 'unchanged') s.host.warning('No more changes to commit.');
      return result;
    },
    undo: (signal) => undoLastCommit(s, signal),
  } satisfies Partial<GitPolicy>;
}

/** Diffs, including the per-message display baseline. */
function diffMethods(s: GitSession) {
  const messageHeads: string[] = [];
  return {
    getDiffs: async (fnames = [], signal) => diffsFor(s, fnames, signal),
    diffCommits: async (fromCommit, toCommit, signal) => diffCommits(s, fromCommit, toCommit, signal),
    noteMessageCheckpoint: async (sha, signal) => {
      if (sha) {
        messageHeads.push(sha);
        return;
      }
      const head = await git(s, ['rev-parse', 'HEAD'], signal);
      if (head.code === 0) messageHeads.push(head.stdout.trim());
    },
    diffForDisplay: async (signal) => {
      const head = await git(s, ['rev-parse', 'HEAD'], signal);
      if (head.code !== 0) return { kind: 'error', message: 'Unable to get current commit. The repository might be empty.' };
      const currentHead = head.stdout.trim();
      const baseline = messageHeads.length < 2 ? `${currentHead}^` : (messageHeads[messageHeads.length - 2] ?? `${currentHead}^`);
      if (!baseline || baseline === currentHead) return { kind: 'warning', message: 'No changes to display since the last message.' };
      return { kind: 'diff', baseline, text: await diffCommits(s, baseline, 'HEAD', signal) };
    },
  } satisfies Partial<GitPolicy>;
}

export function createGitPolicy(options: CreateGitPolicyOptions): GitPolicy {
  const root = options.repoRoot !== undefined ? options.repoRoot : findGitRoot(options.cwd);
  if (root === null) return disabledPolicy;
  const session: GitSession = {
    root,
    host: options.host,
    options,
    sessionHashes: options.sessionCommitHashes ?? new Set<string>(),
    run: options.run ?? createGitRun(options.host, root),
  };
  const dirtyCommits = effectiveDirtyCommits(options.settings.autoCommits, options.settings.dirtyCommits);
  return { ...pathMethods(session, dirtyCommits), ...commitMethods(session, dirtyCommits), ...diffMethods(session) };
}
