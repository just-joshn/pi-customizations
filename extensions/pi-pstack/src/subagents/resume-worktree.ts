import { stat, utimes } from 'node:fs/promises';

import type { TaskRecord } from '../worker-records.ts';
import { verifiedWorktree } from './worktree.ts';

export async function validateResumeWorktree(record: TaskRecord): Promise<void> {
  if (!record.spawnedWithWorktree) return;
  if (record.worktreeCleanlyRemoved) throw new Error('Cannot resume this isolated agent: its worktree was cleanly removed. Start a new Agent with worktree isolation.');
  const { worktreePath: path, worktreeBranch: branch, worktreeRepoRoot: repoRoot } = record;
  if (!path || !branch || !repoRoot) throw new Error('Cannot resume this isolated agent: its worktree is not recorded for this isolated agent. Start a new Agent with worktree isolation.');
  const directory = await stat(path).catch((error) => {
    throw new Error(`Cannot resume this agent right now: its worktree could not be verified (${String(error)}). Re-run once git can answer.`);
  });
  if (!directory.isDirectory() || record.cwd !== path || !(await verifiedWorktree({ path, branch, repoRoot }))) {
    throw new Error('Cannot resume this agent right now: its worktree could not be verified (git identity does not match the recorded binding). Re-run once git can answer.');
  }
  try {
    const now = new Date();
    await utimes(path, now, now);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : String(error);
    const reason = code === 'ENOENT' || code === 'ENOTDIR' ? 'vanished between verification and the resume' : code;
    throw new Error(`Cannot resume this agent: its worktree could not be touched (${reason}). Re-run once the directory is accessible.`);
  }
}
