import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { addWorktree, planWorktree } from '../src/task/worktree.ts';

const id = '11111111-2222-4333-8444-555555555555';
let root = '';
let repo = '';
let worktrees = '';

const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' }).trim();
const commitFile = (name: string, text: string, message: string) => {
  writeFileSync(join(repo, name), text);
  git('add', name);
  git('commit', '-qm', message);
  return git('rev-parse', 'HEAD');
};

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'worktree-')));
  repo = join(root, 'repo');
  worktrees = join(root, 'worktrees');
  mkdirSync(repo);
  git('init', '-q', '-b', 'main');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('planWorktree', () => {
  test('without a base branch, branches from the parent HEAD commit', () => {
    const head = commitFile('a.txt', 'A', 'first');
    expect(planWorktree(repo, worktrees, id)).toEqual({ path: join(worktrees, id), cwd: join(worktrees, id), branch: `pstack/${id}`, base: 'HEAD', commit: head });
  });

  test('a parent inside a tracked subdirectory runs the child in the same subdirectory of the worktree', () => {
    mkdirSync(join(repo, 'pkg/inner'), { recursive: true });
    writeFileSync(join(repo, 'pkg/inner/x.txt'), 'X');
    git('add', '.');
    git('commit', '-qm', 'pkg');
    expect(planWorktree(join(repo, 'pkg/inner'), worktrees, id).cwd).toBe(join(worktrees, id, 'pkg/inner'));
  });

  test('a subdirectory the base commit lacks runs the child at the worktree root', () => {
    commitFile('a.txt', 'A', 'first');
    mkdirSync(join(repo, 'untracked'));
    expect(planWorktree(join(repo, 'untracked'), worktrees, id).cwd).toBe(join(worktrees, id));
  });

  test('a cloud_base_branch that names a local branch is the base', () => {
    commitFile('a.txt', 'A', 'first');
    git('checkout', '-qb', 'feature');
    const feature = commitFile('a.txt', 'F', 'feature');
    git('checkout', '-q', 'main');
    expect(planWorktree(repo, worktrees, id, 'feature')).toMatchObject({ base: 'feature', commit: feature });
  });

  test('a cloud_base_branch that only exists on origin falls back to origin/<branch>', () => {
    const first = commitFile('a.txt', 'A', 'first');
    git('update-ref', 'refs/remotes/origin/remote-only', first);
    commitFile('a.txt', 'B', 'second');
    expect(planWorktree(repo, worktrees, id, 'remote-only')).toMatchObject({ base: 'origin/remote-only', commit: first });
  });

  test('a cloud_base_branch that resolves nowhere fails, naming both refs it tried', () => {
    commitFile('a.txt', 'A', 'first');
    expect(() => planWorktree(repo, worktrees, id, 'nope')).toThrow(`cloud_base_branch "nope" names no commit in ${repo}: neither nope nor origin/nope exists. Pass an existing branch or omit cloud_base_branch to start from HEAD.`);
  });

  test('a directory outside any git repository fails', () => {
    const plain = join(root, 'plain');
    mkdirSync(plain);
    expect(() => planWorktree(plain, worktrees, id)).toThrow(`environment "cloud" runs the subagent in its own git worktree, but ${plain} is not inside a git repository. Omit environment to run the subagent here.`);
  });

  test('a repository without commits fails, because HEAD names no commit to branch from', () => {
    expect(() => planWorktree(repo, worktrees, id)).toThrow(`environment "cloud" branches the subagent's worktree from HEAD, but ${repo} has no commits yet.`);
  });
});

describe('addWorktree', () => {
  test('creates the branch at the base commit with only committed files, leaving the parent checkout alone', () => {
    const head = commitFile('a.txt', 'COMMITTED', 'first');
    writeFileSync(join(repo, 'a.txt'), 'DIRTY');
    const worktree = planWorktree(repo, worktrees, id);
    addWorktree(repo, worktree);
    expect([git('rev-parse', `pstack/${id}`), readFileSync(join(worktree.path, 'a.txt'), 'utf8'), readFileSync(join(repo, 'a.txt'), 'utf8'), git('branch', '--show-current')]).toEqual([head, 'COMMITTED', 'DIRTY', 'main']);
  });

  test('reports git failure, such as a branch that already exists', () => {
    commitFile('a.txt', 'A', 'first');
    git('branch', `pstack/${id}`);
    expect(() => addWorktree(repo, planWorktree(repo, worktrees, id))).toThrow(`Could not create the subagent's worktree at ${join(worktrees, id)}: fatal: a branch named 'pstack/${id}' already exists`);
  });
});
