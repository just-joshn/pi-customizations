import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = (script: string, args: string[] = []) => execFileSync(process.execPath,
  [join(root, 'scripts', script), ...args], { encoding: 'utf8', timeout: 180000, stdio: 'pipe' });

test('the shipped resource checker verifies both source inventories and generated resources', () => {
  assert.equal(run('resources.mjs'), 'Verified 187 upstream files and 205 generated resources.\n');
});

test('preserved helper behavior and its aggregate coverage pass without changing source files', () => {
  const output = run('verify-upstream.mjs');
  assert.match(output, /Upstream coverage includes 7 imported helper files/);
  assert.match(output, /watch-pr\/render.ts/);
  assert.match(output, /lines: \d+\/\d+ \(/);
  assert.equal(run('resources.mjs'), 'Verified 187 upstream files and 205 generated resources.\n');
});

test('the npm distribution loads in the actual Pi CLI and shuts down cleanly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-package-'));
  try {
    const archive = execFileSync('npm', ['pack', '--silent', '--pack-destination', directory],
      { cwd: root, encoding: 'utf8', timeout: 30000 }).trim();
    assert.match(archive, /^pi-pstack-[^/]+\.tgz$/);
    execFileSync('tar', ['-xzf', join(directory, archive), '-C', directory], { timeout: 30000 });
    assert.equal(run('verify-cli.mjs', [join(directory, 'package')]),
      'Verified installed Pi CLI package loading, RPC commands, status, mode off, and orderly shutdown without model calls.\n');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
