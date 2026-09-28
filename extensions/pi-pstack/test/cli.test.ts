import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const verificationDeadlineMs = 180000;
const archiveDeadlineMs = 30000;
const run = (script: string, args: string[] = []) => execFileSync(process.execPath, [join(root, 'scripts', script), ...args], { encoding: 'utf8', timeout: verificationDeadlineMs, stdio: 'pipe' });

// bun pm pack drops a file named .gitignore even when the manifest names it,
// and carries every other tracked file the manifest declares.
const packerOmissions = ['upstream/.gitignore'];

const pack = (directory: string) => basename(execFileSync('bun',
  ['pm', 'pack', '--quiet', '--destination', directory],
  { cwd: root, encoding: 'utf8', timeout: archiveDeadlineMs }).trim());

const packedPaths = (directory: string, archive: string) =>
  new Set(
    execFileSync('tar', ['-tzf', join(directory, archive)], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map((entry) => entry.replace(/^package\//, '')),
  );

const declaredPaths = () =>
  execFileSync('git', ['ls-files', '--', ...JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).files], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

test('the shipped resource checker verifies both source inventories and generated resources', () => {
  expect(run('resources.mjs')).toBe('Verified 187 upstream files and 205 generated resources.\n');
});

test('preserved helper behavior and its aggregate coverage pass without changing source files', () => {
  const output = run('verify-upstream.mjs');
  expect(output).toMatch(/Upstream coverage includes 7 imported helper files/);
  expect(output).toMatch(/watch-pr\/render.ts/);
  const linesCoverage = Number(output.match(/lines: \d+\/\d+ \(([\d.]+)%\)/)?.[1]);
  expect(linesCoverage).toBeGreaterThanOrEqual(80);
  expect(run('resources.mjs')).toBe('Verified 187 upstream files and 205 generated resources.\n');
});

test('the packed distribution loads in the actual Pi CLI and shuts down cleanly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-package-'));
  try {
    const archive = pack(directory);
    expect(archive).toMatch(/^pi-pstack-[^/]+\.tgz$/);
    execFileSync('tar', ['-xzf', join(directory, archive), '-C', directory], { timeout: archiveDeadlineMs });
    expect(run('verify-cli.mjs', [join(directory, 'package')])).toBe('Verified installed Pi CLI package loading, RPC commands, status, mode off, and orderly shutdown without model calls.\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the packed distribution ships every tracked file the manifest declares', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-inventory-'));
  try {
    const packed = packedPaths(directory, pack(directory));
    const missing = declaredPaths()
      .filter((path) => !packed.has(path))
      .sort();
    expect(missing).toEqual([...packerOmissions].sort());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
