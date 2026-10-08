import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { readonlyDigest } from '../helpers/resource-workflows-doctor-readonly.mjs';

const controls = ['production-report-gather', 'positive-gather', 'positive-afterVerify', 'unapproved-operation', 'extra-input', 'forged-origin', 'forged-evidence', 'wrong-loader', 'wrong-target-settings', 'child-failure', 'deadline', 'ownership-gap', 'no-op-self-assertion', 'stale-loader'];

test('actual Pi scripted readonly controls preserve real loader resources and fail closed on incomplete ownership', { timeout: 180000 }, (t) => {
  const out = realpathSync(mkdtempSync('/tmp/doctor-readonly-runtime-evidence-'));
  const protectedReport = resolve('artifacts/verify-pi-customizations/f016-doctor-capabilities/protected-report.json');
  const protectedDigest = readonlyDigest(readFileSync(protectedReport));
  let roots = [];
  t.after(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });
  execFileSync(process.execPath, [resolve('.pi/skills/verify-pi-customizations/scripts/probe-resource-workflows-doctor-readonly.mjs'), out], { cwd: resolve('.'), env: { ...process.env, F016_READONLY_CONTROLS: controls.join(',') }, timeout: 170000, maxBuffer: 8388608 });
  const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
  roots = summary.summaries.map((item) => item.root);
  assert.deepEqual(summary.summaries.map((item) => item.name), controls);
  assert.equal(summary.actualPiVersion, '1.1.0');
  assert.equal(summary.genuineCompliance, false);
  assert.ok(summary.summaries.every((item) => item.verdict === 'failed' && item.genuineCompliance === false));
  assert.equal(readonlyDigest(readFileSync(protectedReport)), protectedDigest);
});
