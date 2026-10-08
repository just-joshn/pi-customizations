import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runGuiSdkNoBoot } from './probe-resource-workflows-gui-no-boot.mjs';

test('actual SDK tools preserve the original Seatbelt and reject GUI authority forgery without boot', { timeout: 30000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'gui-sdk-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const report = await runGuiSdkNoBoot({ repoRoot: process.cwd(), root, out: join(root, 'protected') });
  assert.equal(report.verdict, 'FAILED');
  assert.equal(report.noBoot, true);
  assert.equal(report.profileBefore, report.profileAfter);
  assert.equal(report.sdkInvocations.every(record => record.passed), true, JSON.stringify(report.sdkInvocations));
  for (const name of ['symlink-sealed-broker-write', 'malformed-json', 'oversized-request']) assert.ok(report.sdkInvocations.some(record => record.name === name && record.passed), name);
  assert.ok(report.sdkInvocations.length >= 24);
  assert.equal(report.lease.state, 'held');
  assert.deepEqual(report.lease.calls, []);
  assert.equal(JSON.parse(readFileSync(join(root, 'protected', 'gui-no-boot.json'), 'utf8')).noBoot, true);
});
