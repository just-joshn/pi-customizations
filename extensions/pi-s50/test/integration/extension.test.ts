import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverAndLoadExtensions, type ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';

const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));

async function tempDir(prefix: string, onTestFinished: (fn: () => Promise<void>) => void): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// Pi loads the package through jiti; a copy keeps the checkout's src/index.ts out of the loader cache.
async function loadPackage(onTestFinished: (fn: () => Promise<void>) => void) {
  const [cwd, agentDir, packageDir] = await Promise.all(['s50-cwd-', 's50-agent-', 's50-package-'].map((prefix) => tempDir(prefix, onTestFinished)));
  if (cwd === undefined || agentDir === undefined || packageDir === undefined) throw new Error('temp dirs missing');
  await Promise.all(['package.json', 'src', 'skills'].map((entry) => cp(join(PACKAGE_DIR, entry), join(packageDir, entry), { recursive: true })));
  return discoverAndLoadExtensions([packageDir], cwd, agentDir);
}

test('Pi registers exactly one s50 command with one s50 tool', async ({ onTestFinished }) => {
  const { errors, extensions } = await loadPackage(onTestFinished);
  expect(errors).toStrictEqual([]);
  expect(extensions).toHaveLength(1);
  const [loaded] = extensions;
  expect([...(loaded?.commands.keys() ?? [])]).toStrictEqual(['s50']);
  expect([...(loaded?.tools.keys() ?? [])]).toStrictEqual(['s50']);
  expect(loaded?.tools.get('s50')?.definition.annotations).toStrictEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
});

test('the s50 tool reports no run in a fresh repository', async ({ onTestFinished }) => {
  const { extensions } = await loadPackage(onTestFinished);
  const tool = extensions[0]?.tools.get('s50')?.definition;
  if (tool === undefined) throw new Error('s50 tool not registered');
  const repo = await tempDir('s50-repo-', onTestFinished);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo });
  git('init', '-q', '-b', 'main');
  await writeFile(join(repo, 'readme.md'), '# repo\n');
  git('add', '-A');
  git('-c', 'user.email=s50@example.test', '-c', 'user.name=s50', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init');
  const ctx = { cwd: repo } satisfies Pick<ExtensionToolContext, 'cwd'>;
  // The tool reads only ctx.cwd, so the partial context is enough.
  await expect(tool.execute('call-1', { argv: ['status'] }, undefined, undefined, ctx as ExtensionToolContext)).rejects.toThrow(/^no run in \.s50\/\n$/);
});

test('the s50 skill frontmatter names s50 with a Use when trigger', async () => {
  const text = await readFile(join(PACKAGE_DIR, 'skills/s50/SKILL.md'), 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  const frontmatter = match?.[1] ?? '';
  const body = match?.[2] ?? '';
  expect(/^name: (.+)$/m.exec(frontmatter)?.[1]).toBe('s50');
  expect(/^description: (.+)$/m.exec(frontmatter)?.[1]).toContain('Use when');
  expect(body.split('\n').length).toBeLessThanOrEqual(80);
});
