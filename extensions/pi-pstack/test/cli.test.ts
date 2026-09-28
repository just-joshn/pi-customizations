import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const verificationDeadlineMs = 180000;
const archiveDeadlineMs = 30000;
const run = (script: string, args: string[] = []) => execFileSync(process.execPath,
  [join(root, 'scripts', script), ...args], { encoding: 'utf8', timeout: verificationDeadlineMs, stdio: 'pipe' });

test('the shipped resource checker verifies both source inventories and generated resources', () => {
  expect(run('resources.mjs')).toBe('Verified 187 upstream files and 205 generated resources.\n');
});

test('preserved helper behavior and its aggregate coverage pass without changing source files', () => {
  const output = run('verify-upstream.mjs');
  expect(output).toMatch(/Upstream coverage includes 7 imported helper files/);
  expect(output).toMatch(/watch-pr\/render.ts/);
  expect(output).toMatch(/lines: \d+\/\d+ \(/);
  expect(run('resources.mjs')).toBe('Verified 187 upstream files and 205 generated resources.\n');
});

test('the npm distribution loads in the actual Pi CLI and shuts down cleanly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-package-'));
  try {
    const archive = execFileSync('npm', ['pack', '--silent', '--pack-destination', directory],
      { cwd: root, encoding: 'utf8', timeout: archiveDeadlineMs }).trim();
    expect(archive).toMatch(/^pi-pstack-[^/]+\.tgz$/);
    execFileSync('tar', ['-xzf', join(directory, archive), '-C', directory], { timeout: archiveDeadlineMs });
    expect(run('verify-cli.mjs', [join(directory, 'package')])).toBe(
      'Verified installed Pi CLI package loading, RPC commands, status, mode off, and orderly shutdown without model calls.\n',
    );
  } finally { await rm(directory, { recursive: true, force: true }); }
});
