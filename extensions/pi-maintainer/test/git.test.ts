import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { dirtyFiles, type GitRunner, isGitRepo } from '../src/git.ts';

interface GitResult {
  readonly code: number;
  readonly stdout: string;
}

function fakeGit(results: readonly GitResult[]): GitRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    exec: async (args) => {
      calls.push([...args]);
      const index = Math.min(calls.length - 1, results.length - 1);
      return results[index] ?? { code: 1, stdout: '' };
    },
  };
}

function runGit(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' });
}

interface ScratchRepo {
  readonly root: string;
  readonly subdir: string;
}

function makeScratchRepo(): ScratchRepo {
  const dir = mkdtempSync(join(tmpdir(), 'maintainer-git-'));
  runGit(dir, ['init', '-q']);
  runGit(dir, ['config', 'user.email', 'maintainer@example.invalid']);
  runGit(dir, ['config', 'user.name', 'Maintainer Test']);
  writeFileSync(join(dir, 'a.py'), 'a = 1\n');
  writeFileSync(join(dir, 'b.py'), 'b = 1\n');
  writeFileSync(join(dir, 'c.py'), 'c = 1\n');
  runGit(dir, ['add', '.']);
  runGit(dir, ['commit', '-qm', 'init']);
  const subdir = join(dir, 'sub');
  mkdirSync(subdir);
  return { root: runGit(dir, ['rev-parse', '--show-toplevel']).trim(), subdir };
}

function mutateRepo(repo: ScratchRepo): void {
  writeFileSync(join(repo.root, 'staged.py'), 'staged = 1\n');
  runGit(repo.root, ['add', 'staged.py']);
  writeFileSync(join(repo.root, 'b.py'), 'b = 2\n');
  rmSync(join(repo.root, 'c.py'));
  writeFileSync(join(repo.root, 'untracked.txt'), 'not tracked\n');
}

function realGit(cwd: string): GitRunner {
  return {
    exec: async (args) => {
      try {
        return { code: 0, stdout: runGit(cwd, args) };
      } catch (error: unknown) {
        const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 1;
        return { code: status, stdout: '' };
      }
    },
  };
}

describe('isGitRepo', () => {
  test('is true when the repository resolves', async () => {
    const git = fakeGit([{ code: 0, stdout: '/repo\n' }]);
    expect(await isGitRepo(git)).toBe(true);
    expect(git.calls).toEqual([['rev-parse', '--show-toplevel']]);
  });

  test('is false outside a repository', async () => {
    const git = fakeGit([{ code: 128, stdout: '' }]);
    expect(await isGitRepo(git)).toBe(false);
  });
});

describe('dirtyFiles', () => {
  test('requests the cached and unstaged tracked diffs in order', async () => {
    const git = fakeGit([
      { code: 0, stdout: '/repo\n' },
      { code: 0, stdout: 'staged.py\n' },
      { code: 0, stdout: 'b.py\n' },
    ]);
    expect(await dirtyFiles(git)).toEqual(['/repo/staged.py', '/repo/b.py']);
    expect(git.calls).toEqual([
      ['rev-parse', '--show-toplevel'],
      ['diff', '--name-only', '--cached'],
      ['diff', '--name-only'],
    ]);
  });

  test('dedupes a file that is both staged and modified, first seen first', async () => {
    const git = fakeGit([
      { code: 0, stdout: '/repo\n' },
      { code: 0, stdout: 'both.py\n' },
      { code: 0, stdout: 'both.py\nlater.py\n' },
    ]);
    expect(await dirtyFiles(git)).toEqual(['/repo/both.py', '/repo/later.py']);
  });

  test('returns nothing when the repository root cannot be resolved', async () => {
    const git = fakeGit([{ code: 128, stdout: '' }]);
    expect(await dirtyFiles(git)).toEqual([]);
    expect(git.calls.length).toBe(1);
  });

  test('uses the diff that succeeded when one command fails', async () => {
    const git = fakeGit([
      { code: 0, stdout: '/repo\n' },
      { code: 1, stdout: '' },
      { code: 0, stdout: 'b.py\n' },
    ]);
    expect(await dirtyFiles(git)).toEqual(['/repo/b.py']);
  });
});

describe('dirtyFiles in a scratch repository', () => {
  test('lists the staged, modified, and deleted tracked files but not the untracked one', async () => {
    const repo = makeScratchRepo();
    mutateRepo(repo);
    const files = await dirtyFiles(realGit(repo.root));
    expect(files).toEqual([join(repo.root, 'staged.py'), join(repo.root, 'b.py'), join(repo.root, 'c.py')]);
    expect(files.some((file) => file.endsWith('untracked.txt'))).toBe(false);
  });

  test('keeps repository-root paths when the working directory is a subdirectory', async () => {
    const repo = makeScratchRepo();
    mutateRepo(repo);
    const files = await dirtyFiles(realGit(repo.subdir));
    expect(files).toEqual([join(repo.root, 'staged.py'), join(repo.root, 'b.py'), join(repo.root, 'c.py')]);
  });
});
