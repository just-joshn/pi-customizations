import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { mappedCwd, resolveCloudBase } from '../src/cloud/checkout.ts';

const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function repo(onTestFinished: (fn: () => void) => void, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'pstack-checkout-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  git(root, 'remote', 'add', 'origin', root);
  return root;
}

test("the parent's directory maps to the same directory in the clone", ({ onTestFinished }) => {
  const clone = repo(onTestFinished, { README: 'x' });
  mkdirSync(join(clone, 'pkg'));
  writeFileSync(join(clone, 'pkg', 'file'), 'x');
  git(clone, 'add', '.');
  git(clone, 'commit', '-q', '-m', 'pkg');
  expect(mappedCwd(join(clone, 'pkg'), clone, git(clone, 'rev-parse', 'HEAD'))).toBe(join(clone, 'pkg'));
});

test('the clone root is the cwd when the pushed commit has a file where the parent has a directory', ({ onTestFinished }) => {
  const clone = repo(onTestFinished, { sub: 'a file, not a directory' });
  const local = mkdtempSync(join(tmpdir(), 'pstack-checkout-local-'));
  onTestFinished(() => rmSync(local, { recursive: true, force: true }));
  git(local, 'init', '-q');
  mkdirSync(join(local, 'sub'));
  expect(mappedCwd(join(local, 'sub'), clone, git(clone, 'rev-parse', 'HEAD'))).toBe(clone);
});

test('cloud_base_branch names one branch; a ref pattern that matches a pushed branch is refused', async ({ onTestFinished }) => {
  const root = repo(onTestFinished, { file: 'x' });
  git(root, 'branch', 'feature-one');
  await expect(resolveCloudBase(root, 'feature-one')).resolves.toMatchObject({ branch: 'feature-one' });
  await expect(resolveCloudBase(root, 'feature-*')).rejects.toThrow('cloud_base_branch "feature-*" is not a valid branch name.');
});
