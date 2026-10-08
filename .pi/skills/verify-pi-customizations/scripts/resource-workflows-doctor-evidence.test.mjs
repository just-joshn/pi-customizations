import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { createDoctorEvidence, doctorAnswers } from '../helpers/resource-workflows-doctor-evidence.mjs';

function fixture(t) {
  const root = realpathSync(mkdtempSync('/tmp/doctor-unit-owned-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const out = realpathSync(mkdtempSync('/tmp/doctor-unit-artifacts-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const settings = join(root, 'settings.json');
  writeFileSync(settings, '{}');
  const skill = join(root, 'skills/unused');
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, 'SKILL.md'), 'Fixture skill.');
  return { root, targets: [settings, join(root, 'skills'), join(root, 'missing.json')], out, settings };
}

test('unknown consent methods return denial instead of undefined fallback', () => {
  let decisions = [];
  const answers = doctorAnswers({
    records: () => [{ type: 'fixture' }],
    onDecision: (decision) => {
      decisions = [...decisions, decision];
    },
  });
  assert.deepEqual(
    ['confirm', 'select', 'input', 'editor', 'unexpected'].map((method) => answers[method]({ method, id: method, options: ['approve'] })),
    [false, null, null, null, null],
  );
  assert.deepEqual(decisions[0], {
    request: { method: 'confirm', id: 'confirm', options: ['approve'] },
    answer: false,
    index: 1,
    decision: 'deny-or-cancel',
    usedDefault: false,
    expectedResponse: { type: 'extension_ui_response', id: 'confirm', confirmed: false },
    deliveryProven: false,
  });
});
test('default denial policy never invents approval', () => {
  assert.equal(doctorAnswers().confirm({ id: 'request', method: 'confirm' }), false);
});
test('owned evidence preserves identity changes when bytes are restored', (t) => {
  const local = fixture(t);
  const observer = createDoctorEvidence(local);
  t.after(() => observer.close());
  writeFileSync(local.settings, '{"changed":true}');
  writeFileSync(local.settings, '{}');
  const report = observer.checkpoint('report', 'Actual prose report.');
  assert.deepEqual(
    report.journal.boundaryChanges.map((entry) => entry.path),
    [local.settings],
  );
  assert.equal(report.journal.complete, false);
  assert.equal(report.identities.find((item) => item.path === local.settings).sha256, report.initial.find((item) => item.path === local.settings).sha256);
  assert.equal(JSON.parse(readFileSync(report.path, 'utf8')).text, 'Actual prose report.');
  const final = observer.checkpoint('final');
  assert.deepEqual(final.journal.boundaryChanges, []);
  assert.throws(() => observer.checkpoint('report'), /each once/);
  assert.throws(() => observer.checkpoint('invalid'), /report and final/);
});
test('write edit shell and unscoped calls remain in the journal', (t) => {
  const local = fixture(t);
  const records = [
    { type: 'message_end' },
    { type: 'tool_execution_start', toolName: 'write', toolCallId: 'write1', args: { path: local.settings } },
    { type: 'tool_execution_start', toolName: 'edit', toolCallId: 'edit1', args: { path: local.settings } },
    { type: 'tool_execution_start', toolName: 'bash', toolCallId: 'shell1', args: { command: 'touch settings.json' } },
    { type: 'tool_execution_start', toolName: 'write', toolCallId: 'outside', args: { path: '/not-owned/file' } },
    { type: 'tool_execution_start', toolName: 'edit', toolCallId: 'missing-path', args: {} },
  ];
  const observer = createDoctorEvidence({ ...local, records: () => records });
  t.after(() => observer.close());
  const report = observer.checkpoint('report', 'Report.');
  assert.deepEqual(
    report.journal.calls.map((entry) => entry.kind),
    ['write', 'edit', 'bash', 'unscoped', 'unknown'],
  );
  assert.deepEqual(report.journal.unknownCalls, ['shell1', 'outside', 'missing-path']);
  assert.equal(report.index, 5);
});
test('unowned paths and protected files are rejected', (t) => {
  const local = fixture(t);
  assert.throws(() => createDoctorEvidence({ ...local, targets: ['/not-owned/file'] }), /explicitly owned/);
  assert.throws(() => createDoctorEvidence({ ...local, targets: [] }), /explicitly owned/);
  assert.throws(() => createDoctorEvidence({ ...local, out: join(local.root, 'evidence') }), /outside the writable attempt root/);
  assert.throws(() => createDoctorEvidence({ ...local, targets: [join(local.root, 'auth.json')] }), /explicitly owned/);
  writeFileSync(join(local.root, 'skills/models.json'), '{}');
  assert.throws(() => createDoctorEvidence(local), /authentication or model files/);
});
test('symlink targets never escape fixture ownership', (t) => {
  const local = fixture(t);
  symlinkSync('/etc/hosts', join(local.root, 'skills/link'));
  assert.throws(() => createDoctorEvidence(local), /Unowned Doctor evidence path/);
});
test('notification wait is bounded and rejects closure instead of inventing an event', async (t) => {
  const local = fixture(t);
  const observer = createDoctorEvidence(local);
  t.after(() => observer.close());
  await assert.rejects(observer.waitForNotification(join(local.root, 'missing.json'), 5), /deadline/);
  const pending = observer.waitForNotification(join(local.root, 'missing.json'), 5000);
  observer.close();
  await assert.rejects(pending, /closed/);
  await assert.rejects(observer.waitForNotification(local.settings, 5), /closed/);
});

test('notification wait rejects unowned paths and extended deadlines', async (t) => {
  const local = fixture(t);
  const observer = createDoctorEvidence(local);
  t.after(() => observer.close());
  await assert.rejects(observer.waitForNotification('/outside', 5), /target/);
  for (const ms of [0, 5001, NaN]) await assert.rejects(observer.waitForNotification(local.settings, ms), /bounded/);
});

test('owned file notifications remain supplemental and cannot assert completeness', async (t) => {
  const local = fixture(t);
  const observer = createDoctorEvidence(local);
  t.after(() => observer.close());
  const observed = observer.waitForNotification(local.settings, 5000);
  writeFileSync(local.settings, '{"changed":true}');
  await observed;
  const report = observer.checkpoint('report', 'Report.');
  assert.equal(
    report.journal.events.some((event) => event.path === local.settings),
    true,
  );
  assert.equal(report.journal.complete, false);
});
