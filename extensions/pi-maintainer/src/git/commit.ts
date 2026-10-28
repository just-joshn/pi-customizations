import { resolve } from 'node:path';

import { BRANDING, coAuthoredBy } from '../branding.ts';
import type { CommitResult } from '../feature.ts';
import { buildCommitMessageRequest, normalizeCommitMessage } from './commit-message.ts';
import { diffsFor, type GitSession, git, gitError } from './session.ts';

export interface CommitRequest {
  readonly fnames: readonly string[] | null;
  readonly context: string | null;
  readonly aiderEdits: boolean;
  readonly signal?: AbortSignal | undefined;
  readonly forcedMessage?: string | undefined;
}

interface Attribution {
  readonly message: string;
  readonly full: string;
  readonly useAuthor: boolean;
  readonly useCommitter: boolean;
}

/** `aider/repo.py:204-210,300-303`: a generated message, or Aider's own placeholder after failure. */
async function resolveCommitMessage(s: GitSession, fnames: readonly string[], context: string | null, signal?: AbortSignal): Promise<string> {
  const diffs = await diffsFor(s, fnames, signal);
  const request = buildCommitMessageRequest(diffs, context, {
    commitPrompt: s.options.settings.commitPrompt,
    userLanguage: s.options.settings.commitLanguage,
  });
  const generated = s.options.generateCommitMessage ? await s.options.generateCommitMessage(request, signal) : null;
  if (generated) return normalizeCommitMessage(generated) || '(no commit message provided)';
  if (s.options.generateCommitMessage) s.host.error('Failed to generate commit message!');
  return '(no commit message provided)';
}

/** Aider's author/committer/co-authored-by rules applied to one commit message. */
function attribute(s: GitSession, base: string, aiderEdits: boolean): Attribution {
  const settings = s.options.settings;
  const { attributeAuthor, attributeCommitter, attributeCoAuthoredBy } = settings;
  const effectiveAuthor = attributeAuthor === null ? true : attributeAuthor;
  const effectiveCommitter = attributeCommitter === null ? true : attributeCommitter;
  const prefix = aiderEdits && (settings.attributeCommitMessageAuthor || settings.attributeCommitMessageCommitter);
  const message = prefix ? `${BRANDING.messagePrefix}${base}` : base;
  const full = aiderEdits && attributeCoAuthoredBy ? `${message}\n\n${coAuthoredBy(s.options.mainModelName?.() ?? 'unknown-model')}` : message;
  return {
    message,
    full,
    useAuthor: aiderEdits && effectiveAuthor && (!attributeCoAuthoredBy || attributeAuthor !== null),
    useCommitter: effectiveCommitter && (!(aiderEdits && attributeCoAuthoredBy) || attributeCommitter !== null),
  };
}

async function stage(s: GitSession, fnames: readonly string[], signal?: AbortSignal): Promise<void> {
  for (const fname of fnames) {
    const added = await git(s, ['add', '--', resolve(s.root, fname)], signal);
    if (added.code !== 0) s.host.error(`Unable to add ${fname}: ${gitError(added)}`);
  }
}

async function attributionEnv(s: GitSession, attribution: Attribution, signal?: AbortSignal): Promise<Record<string, string> | undefined> {
  const name = await git(s, ['config', '--get', 'user.name'], signal);
  const attributed = `${name.stdout.trim() || 'User'}${BRANDING.nameSuffix}`;
  const env: Record<string, string> = {
    ...(attribution.useCommitter ? { GIT_COMMITTER_NAME: attributed } : {}),
    ...(attribution.useAuthor ? { GIT_AUTHOR_NAME: attributed } : {}),
  };
  return Object.keys(env).length ? env : undefined;
}

async function hasChanges(s: GitSession, request: CommitRequest): Promise<boolean> {
  if (request.fnames === null) {
    const status = await git(s, ['status', '--porcelain'], request.signal);
    if (!status.stdout.trim()) return false;
  }
  return (await diffsFor(s, request.fnames ?? [], request.signal)).trim().length > 0;
}

export async function commitFiles(s: GitSession, request: CommitRequest): Promise<CommitResult> {
  const { fnames, aiderEdits, signal, forcedMessage } = request;
  if (!s.options.settings.autoCommits && aiderEdits) return { kind: 'disabled' };
  if (!(await hasChanges(s, request))) return { kind: 'unchanged' };
  const base = forcedMessage !== undefined ? normalizeCommitMessage(forcedMessage) || '(no commit message provided)' : await resolveCommitMessage(s, fnames ?? [], request.context, signal);
  const attribution = attribute(s, base, aiderEdits);
  if (fnames !== null) await stage(s, fnames, signal);
  const env = await attributionEnv(s, attribution, signal);
  const scope = fnames === null ? ['-a'] : ['--', ...fnames.map((fname) => resolve(s.root, fname))];
  const commitArgs = ['commit', '-m', attribution.full, ...(s.options.settings.gitCommitVerify ? [] : ['--no-verify']), ...scope];
  const committed = await git(s, commitArgs, signal, env);
  if (committed.code !== 0) {
    const error = gitError(committed) || 'commit failed';
    s.host.error(`Unable to commit: ${error}`);
    return { kind: 'failed', error };
  }
  const hash = (await git(s, ['rev-parse', '--short', 'HEAD'], signal)).stdout.trim();
  s.sessionHashes.add(hash);
  s.host.output(`Commit ${hash} ${attribution.message}`);
  return { kind: 'committed', hash, message: attribution.message };
}
