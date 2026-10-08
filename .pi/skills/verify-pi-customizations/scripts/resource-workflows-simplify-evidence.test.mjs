import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { collectSimplifyEvidence } from '../helpers/resource-workflows-simplify-evidence.mjs';

for (const [name, input] of [
  ['missing input', undefined],
  ['empty records', { records: [] }],
  ['null records', { records: null }],
  ['wrong records type', { records: 'not records' }],
  ['null entry', { records: [null] }],
  ['malformed observation collection', { records: [], parentToolObservations: {} }],
]) {
  test(`${name} cannot establish review evidence`, () => {
    assert.deepEqual(collectSimplifyEvidence(input), { reviewers: [], orderingComplete: false, firstEditAt: null });
  });
}

test('Pi 1.1 native and lowercase collection controls prove positives and reject observed writes', { timeout: 240000 }, () => {
  const parent = resolve('artifacts/verify-pi-customizations/f016-simplify-collection');
  mkdirSync(parent, { recursive: true });
  const out = mkdtempSync(`${parent}/test-`);
  const result = spawnSync(process.execPath, ['.pi/skills/verify-pi-customizations/scripts/probe-resource-workflows-simplify-collection.mjs', out], { encoding: 'utf8', timeout: 230000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const summary = JSON.parse(readFileSync(`${out}/summary.json`, 'utf8'));
  assert.equal(summary.version, '1.1.0');
  assert.equal(summary.scriptedControl, true);
  assert.equal(summary.genuineCompliance, false);
  assert.equal(summary.outcomes.length, 8);
  for (const name of ['native-clean', 'native-diff', 'lowercase-clean', 'lowercase-diff', 'native-ls']) {
    const evidence = summary.outcomes.find((item) => item.name === name).evidence;
    assert.equal(evidence.reviewers.length, 4);
    assert.equal(evidence.orderingComplete, true);
    assert.equal(
      evidence.reviewers.every((item) => item.owned && item.readonly && item.successful),
      true,
    );
  }
  assert.equal(summary.outcomes.find((item) => item.name === 'parent-write').evidence.orderingComplete, false);
  assert.equal(summary.outcomes.find((item) => item.name === 'native-unobserved-shell').evidence.orderingComplete, false);
  assert.equal(
    summary.outcomes.find((item) => item.name === 'lowercase-child-write').evidence.reviewers.every((item) => item.readonly === false),
    true,
  );
});
