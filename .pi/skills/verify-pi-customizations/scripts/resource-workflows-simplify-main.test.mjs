import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { recordSimplifySession } from '../helpers/resource-workflows-simplify-recording.mjs';

test('failed recorder initialization closes its broker and removes its capability', async () => {
  const root = mkdtempSync('/tmp/f016-simplify-init-');
  try {
    const cwd = join(root, 'workspace');
    const out = join(root, 'artifacts');
    mkdirSync(join(cwd, '.git'), { recursive: true });
    mkdirSync(out);
    writeFileSync(join(cwd, '.git/config'), '[core]\n repositoryformatversion = 0\n');
    const cleanup = { cwd, out, profile: join(root, 'missing-profile'), session: { close: async () => {} } };
    await assert.rejects(recordSimplifySession({ cleanup, root, packagePath: '.' }), { code: 'ENOENT' });
    assert.equal(existsSync(join(root, 'simplify.sock')), false);
    assert.equal(existsSync(join(out, 'recording-capability')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('public MAIN records actual native and lowercase simplify execution and rejects unsafe controls', { timeout: 300000 }, () => {
  const parent = resolve('artifacts/verify-pi-customizations/f016-simplify-main');
  mkdirSync(parent, { recursive: true });
  const out = mkdtempSync(`${parent}/test-`);
  const result = spawnSync(process.execPath, ['.pi/skills/verify-pi-customizations/scripts/probe-resource-workflows-simplify-main.mjs', out], { encoding: 'utf8', timeout: 290000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
  assert.equal(summary.version, '1.1.0');
  assert.equal(summary.scriptedControl, true);
  assert.equal(summary.genuineCompliance, false);
  assert.equal(summary.verdict, 'failed');
  assert.equal(summary.outcomes.length, 12);
  for (const result of summary.outcomes) {
    assert.equal(result.status.eligible, result.expected, result.name);
    assert.equal(result.status.verdict, 'failed', result.name);
  }
});
