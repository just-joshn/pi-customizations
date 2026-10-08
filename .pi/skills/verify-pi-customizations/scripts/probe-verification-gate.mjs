import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

test('default verification schedules both source-contract regression suites', () => {
  const result = spawnSync('make', ['-C', REPO_ROOT, '-n', 'verify'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const recipes = result.stdout.split('\n').filter((line) => line.includes('node --test'));
  for (const probe of ['probe-f009-followup.mjs', 'probe-f009-contract-guard.mjs']) {
    assert.ok(recipes.some((line) => line.includes(probe)), `default verification does not schedule ${probe}`);
  }
});
