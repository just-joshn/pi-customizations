import { stat, utimes } from 'node:fs/promises';
import { relative } from 'node:path';

import type { TaskRecord } from '../worker-records.ts';
import { ResumeError } from './resume-errors.ts';
import { verifiedWorktree } from './worktree.ts';

function inside(path: string, root: string): boolean {
  const offset = relative(root, path);
  return offset === '' || (!offset.startsWith('..') && !offset.startsWith('/'));
}

async function validateInherited(record: TaskRecord, inherited: string): Promise<void> {
  const fenced = (reason: string) => new ResumeError('permanent', `This agent cannot be resumed: its worktree ${reason}, and the fallback directory is not covered by the session's isolation fences.`);
  const directory = await stat(inherited).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw fenced('no longer exists');
    throw new ResumeError('transient', `Cannot resume this agent: its worktree could not be examined (${error.code ?? String(error)}). Re-run once the directory is accessible.`);
  });
  if (!directory.isDirectory()) throw fenced('exists but is not a directory');
  if (!inside(record.cwd, inherited)) throw new ResumeError('permanent', `This agent cannot be resumed: its directory ${record.cwd} is outside its inherited worktree ${inherited}.`);
}

async function touch(path: string): Promise<void> {
  try {
    const now = new Date();
    await utimes(path, now, now);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : String(error);
    const reason = code === 'ENOENT' || code === 'ENOTDIR' ? 'vanished between verification and the resume' : code;
    throw new ResumeError('transient', `Cannot resume this agent: its worktree could not be touched (${reason}). Re-run once the directory is accessible.`);
  }
}

async function validateOwn(record: TaskRecord): Promise<void> {
  if (record.worktreeCleanlyRemoved) throw new ResumeError('permanent', 'Cannot resume this isolated agent: its worktree was cleanly removed. Start a new Agent with worktree isolation.');
  const { worktreePath: path, worktreeBranch: branch, worktreeRepoRoot: repoRoot } = record;
  if (!path || !branch || !repoRoot) throw new ResumeError('permanent', 'Cannot resume this isolated agent: its worktree is not recorded for this isolated agent. Start a new Agent with worktree isolation.');
  if (path === repoRoot) throw new ResumeError('permanent', `This agent cannot be resumed: its recorded worktree ${path} is the shared checkout, not an agent worktree.`);
  const directory = await stat(path).catch((error) => {
    throw new ResumeError('transient', `Cannot resume this agent right now: its worktree could not be verified (${String(error)}). Re-run once git can answer.`);
  });
  if (!directory.isDirectory() || record.cwd !== path || !(await verifiedWorktree({ path, branch, repoRoot }))) {
    throw new ResumeError('transient', 'Cannot resume this agent right now: its worktree could not be verified (git identity does not match the recorded binding). Re-run once git can answer.');
  }
  await touch(path);
}

export async function validateResumeWorktree(record: TaskRecord): Promise<void> {
  if (record.spawnedWithWorktree) return validateOwn(record);
  if (record.inheritedWorktreePath) return validateInherited(record, record.inheritedWorktreePath);
}
