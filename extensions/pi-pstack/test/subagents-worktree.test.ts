import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { createWorktree, finalizeWorktree } from '../src/subagents/worktree.ts';

let repo = '';
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'subagent-wt-')));
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'a@b.c');
  git(repo, 'config', 'user.name', 'n');
  writeFileSync(join(repo, 'f.txt'), 'one');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'init');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test('[G6-14] worktree directory is named agent-<id> and leaves the caller checkout untouched', async () => {
  const worktree = await createWorktree(repo, 'abc123');
  expect(basename(worktree.path)).toBe('agent-abc123');
  expect(worktree.branch).toBe('worktree-agent-abc123');
  expect(git(worktree.path, 'rev-parse', '--show-toplevel')).toBe(worktree.path);
  expect(git(repo, 'status', '--porcelain')).toBe('');
});

test('[G6-18] unchanged worktree is removed and a changed one is kept with path and branch', async () => {
  const clean = await createWorktree(repo, 'clean1');
  expect(await finalizeWorktree(clean)).toEqual({ kept: false });
  expect(existsSync(clean.path)).toBe(false);
  expect(git(repo, 'branch', '--list', clean.branch)).toBe('');

  const edited = await createWorktree(repo, 'edit1');
  writeFileSync(join(edited.path, 'f.txt'), 'two');
  expect(await finalizeWorktree(edited)).toEqual({ kept: true, path: edited.path, branch: edited.branch });
  expect(existsSync(edited.path)).toBe(true);

  const committed = await createWorktree(repo, 'commit1');
  writeFileSync(join(committed.path, 'g.txt'), 'x');
  git(committed.path, 'add', '.');
  git(committed.path, 'commit', '-qm', 'child');
  expect(await finalizeWorktree(committed)).toMatchObject({ kept: true });
});

test('cleanup keeps a checkout whose branch identity changed', async () => {
  const worktree = await createWorktree(repo, 'changed-identity');
  git(worktree.path, 'checkout', '-qb', 'replacement-branch');
  expect(await finalizeWorktree(worktree)).toEqual({ kept: true, path: worktree.path, branch: worktree.branch });
  expect(existsSync(worktree.path)).toBe(true);
  expect(git(worktree.path, 'branch', '--show-current')).toBe('replacement-branch');
});

test('creating isolation from a linked checkout does not pollute that checkout', async () => {
  const parent = await createWorktree(repo, 'parent-linked');
  const nested = await createWorktree(parent.path, 'nested-linked');
  expect(git(parent.path, 'status', '--porcelain')).toBe('');
  expect(await finalizeWorktree(nested)).toEqual({ kept: false });
  expect(await finalizeWorktree(parent)).toEqual({ kept: false });
});

test('[G6-13] outside a git repository the precondition error is exact', async () => {
  const plain = mkdtempSync(join(tmpdir(), 'subagent-plain-'));
  try {
    await expect(createWorktree(plain, 'x')).rejects.toThrow(
      /^Cannot create agent worktree: not in a git repository and no WorktreeCreate hooks are configured\. Configure WorktreeCreate\/WorktreeRemove hooks in settings\.json to use worktree isolation/,
    );
  } finally {
    rmSync(plain, { recursive: true, force: true });
  }
});

test('[G6-12] cwd and worktree isolation are mutually exclusive in admission', async () => {
  const { decideAdmission } = await import('../src/subagents/admission.ts');
  const decision = decideAdmission(
    {
      agents: [{ agentType: 'general-purpose', whenToUse: '' }],
      forkAvailable: false,
      depth: 0,
      depthCap: 3,
      running: 0,
      concurrencyCap: 20,
      concurrencyBypass: false,
      spawnedThisSession: 0,
      spentUsd: 0,
      hasProject: true,
      stopPending: false,
    },
    { description: 'd', prompt: 'p', cwd: '/x', isolation: 'worktree' },
  );
  expect(!decision.ok && decision.refusal.message).toContain('mutually exclusive');
});
