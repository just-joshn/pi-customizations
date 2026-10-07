import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { ensureWorktree } from '../../src/adapters/git.ts';
import { localShell } from '../../src/adapters/shell.ts';
import { git, tempRepo } from './repo.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(): string {
  const cwd = tempRepo();
  dirs.push(cwd);
  return cwd;
}

test.fails('a worktree whose directory was deleted is recreated', async () => {
  const cwd = repo();
  const shell = localShell(cwd, undefined);
  await ensureWorktree(shell, '.s50/worktrees/a', 's50/r1/a');
  rmSync(join(cwd, '.s50'), { recursive: true, force: true });
  await ensureWorktree(shell, '.s50/worktrees/a', 's50/r2/a');
  expect([existsSync(join(cwd, '.s50/worktrees/a/src/export/csv.ts')), git(join(cwd, '.s50/worktrees/a'), 'branch', '--show-current')]).toEqual([true, 's50/r2/a']);
});

test.fails('a sibling checkout with the same suffix is not reused', async () => {
  const cwd = repo();
  const shell = localShell(cwd, undefined);
  git(cwd, 'worktree', 'add', '-q', '-b', 'other', join(cwd, 'pkg/.s50/worktrees/a'));
  await ensureWorktree(shell, '.s50/worktrees/a', 's50/r1/a');
  expect(existsSync(join(cwd, '.s50/worktrees/a/src/export/csv.ts'))).toBe(true);
});
