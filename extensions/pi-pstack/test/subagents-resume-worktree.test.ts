import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { validateResumeWorktree } from '../src/subagents/resume-worktree.ts';
import { createWorktree } from '../src/subagents/worktree.ts';
import type { TaskRecord } from '../src/worker-records.ts';

vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, utimes: vi.fn(actual.utimes) };
});

let repo = '';
beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'resume-worktree-')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo });
  git('init', '-q');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(repo, 'tracked'), 'base');
  git('add', '.');
  git('commit', '-qm', 'base');
});
afterEach(() => {
  vi.clearAllMocks();
  rmSync(repo, { recursive: true, force: true });
});

async function isolatedRecord(): Promise<TaskRecord> {
  const worktree = await createWorktree(repo, 'resume');
  return {
    id: 'resume',
    persona: 'general-purpose',
    cwd: worktree.path,
    readonly: false,
    sessionFile: 'session.jsonl',
    outputFile: 'output.txt',
    status: 'settled',
    output: '',
    spawnedWithWorktree: true,
    worktreeCleanlyRemoved: false,
    worktreePath: worktree.path,
    worktreeBranch: worktree.branch,
    worktreeRepoRoot: worktree.repoRoot,
  };
}

test('[G6-20] verified resume touches the real retained directory', async () => {
  const record = await isolatedRecord();
  await validateResumeWorktree(record);
  expect(vi.mocked(utimes).mock.calls).toEqual([[record.worktreePath, expect.any(Date), expect.any(Date)]]);
});

test.each([
  ['EACCES', 'EACCES'],
  ['ENOENT', 'vanished between verification and the resume'],
  ['ENOTDIR', 'vanished between verification and the resume'],
])('[G6-20] directory touch failure %s has an explicit resume refusal', async (code, reason) => {
  const record = await isolatedRecord();
  vi.mocked(utimes).mockRejectedValueOnce(Object.assign(new Error('touch failed'), { code }));
  await expect(validateResumeWorktree(record)).rejects.toThrow(`Cannot resume this agent: its worktree could not be touched (${reason}). Re-run once the directory is accessible.`);
});

test('[G6-20] missing binding is refused without touching any directory', async () => {
  const record = await isolatedRecord();
  await expect(validateResumeWorktree({ ...record, worktreePath: undefined })).rejects.toThrow('is not recorded for this isolated agent');
  expect(vi.mocked(utimes).mock.calls).toEqual([]);
});
