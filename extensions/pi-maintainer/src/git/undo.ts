import type { GitPolicy } from '../feature.ts';
import { type GitSession, git, isDirty } from './session.ts';

type UndoResult = Awaited<ReturnType<GitPolicy['undo']>>;
type Refusal = Extract<UndoResult, { kind: 'refused' }>;

const refuse = (message: string): Refusal => ({ kind: 'refused', message });

interface LastCommit {
  readonly head: string;
  readonly hash: string;
  readonly message: string;
}

async function lastCommit(s: GitSession, signal?: AbortSignal): Promise<LastCommit | Refusal> {
  const head = await git(s, ['rev-parse', 'HEAD'], signal);
  if (head.code !== 0) return refuse('No git repository found.');
  const parents = await git(s, ['rev-list', '--parents', '-n', '1', 'HEAD'], signal);
  const parts = parents.stdout.trim().split(/\s+/);
  if (parts.length < 2) return refuse('This is the first commit in the repository. Cannot undo.');
  if (parts.length > 2) return refuse(`The last commit ${parts[0]} has more than 1 parent, can't undo.`);
  const hash = (await git(s, ['rev-parse', '--short', 'HEAD'], signal)).stdout.trim();
  const message = (await git(s, ['log', '-1', '--pretty=%s'], signal)).stdout.trim() || '(unknown)';
  if (!s.sessionHashes.has(hash)) return refuse('The last commit was not made by aider in this chat session.');
  return { head: head.stdout.trim(), hash, message };
}

async function fileRefusal(s: GitSession, files: readonly string[], signal?: AbortSignal): Promise<Refusal | null> {
  for (const fname of files) {
    if (await isDirty(s, fname, signal)) return refuse(`The file ${fname} has uncommitted changes. Please stash them before undoing.`);
    const inParent = await git(s, ['cat-file', '-e', `HEAD~1:${fname}`], signal);
    if (inParent.code !== 0) return refuse(`The file ${fname} was not in the repository in the previous commit. Cannot undo safely.`);
  }
  return null;
}

async function pushedRefusal(s: GitSession, head: string, signal?: AbortSignal): Promise<Refusal | null> {
  const branchName = (await git(s, ['rev-parse', '--abbrev-ref', 'HEAD'], signal)).stdout.trim();
  if (!branchName || branchName === 'HEAD') return null;
  const remote = await git(s, ['rev-parse', `origin/${branchName}`], signal);
  return remote.code === 0 && remote.stdout.trim() === head ? refuse('The last commit has already been pushed to the origin. Undoing is not possible.') : null;
}

/** Check out each file from HEAD~1; on any failure, report what was and wasn't restored. */
async function restoreFiles(s: GitSession, files: readonly string[], signal?: AbortSignal): Promise<string | null> {
  const restored: string[] = [];
  const unrestored: string[] = [];
  for (const filePath of files) {
    const checkout = await git(s, ['checkout', 'HEAD~1', '--', filePath], signal);
    (checkout.code === 0 ? restored : unrestored).push(filePath);
  }
  if (unrestored.length === 0) return null;
  const error = `Error restoring ${unrestored[0] ?? 'file'}, aborting undo.`;
  s.host.error(error);
  s.host.output('Restored files:');
  for (const file of new Set(restored)) s.host.output(`  ${file}`);
  s.host.output('Unable to restore files:');
  for (const file of new Set(unrestored)) s.host.output(`  ${file}`);
  return error;
}

export async function undoLastCommit(s: GitSession, signal?: AbortSignal): Promise<UndoResult> {
  const last = await lastCommit(s, signal);
  if ('kind' in last) return last;
  const files = (await git(s, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], signal)).stdout.split('\n').filter(Boolean);
  const refusal = (await fileRefusal(s, files, signal)) ?? (await pushedRefusal(s, last.head, signal));
  if (refusal) return refusal;
  const restoreError = await restoreFiles(s, files, signal);
  if (restoreError) return { kind: 'failed', error: restoreError };
  const reset = await git(s, ['reset', '--soft', 'HEAD~1'], signal);
  if (reset.code !== 0) return { kind: 'failed', error: reset.stderr.trim() || 'reset failed' };
  s.sessionHashes.delete(last.hash);
  const nowHash = (await git(s, ['rev-parse', '--short', 'HEAD'], signal)).stdout.trim();
  const nowMessage = (await git(s, ['log', '-1', '--pretty=%s'], signal)).stdout.trim() || '(unknown)';
  return { kind: 'removed', hash: last.hash, message: last.message, nowAt: { hash: nowHash, message: nowMessage } };
}
