import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { createWorktree, finalizeWorktree } from '../src/subagents/worktree.ts';

let repo = '';
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'subagent-wt-safety-')));
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'a@b.c');
  git(repo, 'config', 'user.name', 'n');
  writeFileSync(join(repo, '.gitignore'), '*.env\nbuild/\n');
  writeFileSync(join(repo, 'f.txt'), 'one');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'init');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test.for([
  { name: 'an ignored file', file: 'secret.env' },
  { name: 'an untracked file', file: 'notes.txt' },
])('[C61] finalization keeps a worktree holding $name the child created', async ({ file }) => {
  const worktree = await createWorktree(repo, 'keep1');
  writeFileSync(join(worktree.path, file), 'child work');
  expect(await finalizeWorktree(worktree)).toEqual({ kept: true, path: worktree.path, branch: worktree.branch });
  expect(readFileSync(join(worktree.path, file), 'utf8')).toBe('child work');
  expect(git(repo, 'branch', '--list', worktree.branch)).toContain(worktree.branch);
});

test('[C61] a worktree git refuses to remove is kept instead of force-removed', async () => {
  const worktree = await createWorktree(repo, 'locked1');
  git(repo, 'worktree', 'lock', worktree.path);
  expect(await finalizeWorktree(worktree)).toEqual({ kept: true, path: worktree.path, branch: worktree.branch });
  expect(existsSync(worktree.path)).toBe(true);
});

test('[C61] a clean worktree with no ignored files is still removed', async () => {
  const worktree = await createWorktree(repo, 'clean2');
  expect(await finalizeWorktree(worktree)).toEqual({ kept: false });
  expect(existsSync(worktree.path)).toBe(false);
  expect(git(repo, 'branch', '--list', worktree.branch)).toBe('');
});
