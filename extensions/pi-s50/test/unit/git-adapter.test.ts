import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { changedPaths, ensureWorktree, isDirty, remoteHead, remoteUrl, revision, topLevel } from '../../src/adapters/git.ts';
import { localShell } from '../../src/adapters/shell.ts';

async function repository() {
  const path = await mkdtemp(join(tmpdir(), 's50-git-'));
  onTestFinished(() => rm(path, { recursive: true, force: true }));
  const shell = localShell(path, undefined);
  expect((await shell('git', ['init', '-q'])).exitCode).toBe(0);
  expect((await shell('git', ['config', 'user.name', 'S50 Test'])).exitCode).toBe(0);
  expect((await shell('git', ['config', 'user.email', 's50@example.invalid'])).exitCode).toBe(0);
  return { path, shell };
}

test('revision reports the git failure before the first commit', async () => {
  const { shell } = await repository();
  await expect(revision(shell)).rejects.toThrow('git rev-parse HEAD failed:');
});

test('remote URL is absent until an origin is configured', async () => {
  const { shell } = await repository();
  expect(await remoteUrl(shell)).toBeNull();
  expect((await shell('git', ['remote', 'add', 'origin', 'https://example.invalid/repo.git'])).exitCode).toBe(0);
  expect(await remoteUrl(shell)).toBe('https://example.invalid/repo.git');
});

test('changed paths distinguish identical revisions from a committed file change', async () => {
  const { shell, path } = await repository();
  expect(await isDirty(shell)).toBe(false);
  expect((await shell('git', ['commit', '--allow-empty', '-qm', 'initial'])).exitCode).toBe(0);
  const initial = await revision(shell);
  expect(await changedPaths(shell, initial, initial)).toEqual([]);
  await writeFile(join(path, 'export.txt'), 'CSV\n');
  expect(await isDirty(shell)).toBe(true);
  expect((await shell('git', ['add', 'export.txt'])).exitCode).toBe(0);
  expect((await shell('git', ['commit', '-qm', 'export'])).exitCode).toBe(0);
  expect(await changedPaths(shell, initial, await revision(shell))).toEqual(['export.txt']);
  expect(await isDirty(shell)).toBe(false);
  expect(await topLevel(shell)).toMatch(/s50-git-/);
});

test('worktree creation is repeatable and refuses an existing different branch', async () => {
  const { shell } = await repository();
  expect((await shell('git', ['commit', '--allow-empty', '-qm', 'initial'])).exitCode).toBe(0);
  await ensureWorktree(shell, 'work', 'export');
  await ensureWorktree(shell, 'work', 'export');
  await expect(ensureWorktree(shell, 'work', 'download')).rejects.toThrow('worktree work is checked out on another branch');
});

test.for(['', 'not-a-commit\tHEAD\n'])('remote head rejects invalid output $0', async (stdout) => {
  await expect(remoteHead(async () => ({ stdout, stderr: '', exitCode: 0 }), 'owner/repo')).rejects.toThrow('returned no commit');
});

test('remote head returns a validated commit from the git boundary', async () => {
  expect(await remoteHead(async () => ({ stdout: `${'a'.repeat(40)}\tHEAD\n`, stderr: '', exitCode: 0 }), 'owner/repo')).toBe('a'.repeat(40));
});
