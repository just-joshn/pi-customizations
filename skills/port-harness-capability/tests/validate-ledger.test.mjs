import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { deriveVerdict, main, renderMarkdown, validateLedger } from '../scripts/validate-ledger.mjs';

function makeRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'ledger-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'cmd.test.ts'), '');
  return root;
}

const req = (overrides = {}) => ({
  id: 'CAP-001',
  sourceBehavior: '/foo prints bar',
  evidence: 'docs/foo.md',
  piMapping: 'extension command /foo',
  acceptanceTest: 'cmd.test.ts::prints bar',
  status: 'VERIFIED',
  ...overrides,
});

const ledger = (requirements, verdict) => ({ capability: 'foo', requirements, verdict });

function sink() {
  const chunks = [];
  return { write: (text) => chunks.push(text), text: () => chunks.join('') };
}

test('accepts a fully verified ledger and reports counts', (t) => {
  const result = validateLedger(ledger([req()], 'VERIFIED'), makeRoot(t));
  assert.deepEqual(result.errors, []);
  assert.equal(result.verdict, 'VERIFIED');
  assert.equal(result.counts.VERIFIED, 1);
});

test('rejects a VERIFIED verdict when any requirement is inconclusive', (t) => {
  const reqs = [req(), req({ id: 'CAP-002', status: 'INCONCLUSIVE', gap: 'source not runnable' })];
  const result = validateLedger(ledger(reqs, 'VERIFIED'), makeRoot(t));
  assert.deepEqual(result.errors, ['verdict must be "INCONCLUSIVE" for these statuses, found "VERIFIED"']);
});

for (const testCase of [
  { name: 'NOT VERIFIED dominates', statuses: ['VERIFIED', 'INCONCLUSIVE', 'NOT VERIFIED'], expected: 'NOT VERIFIED' },
  { name: 'INCONCLUSIVE beats VERIFIED', statuses: ['VERIFIED', 'INCONCLUSIVE'], expected: 'INCONCLUSIVE' },
  { name: 'NOT APPLICABLE does not block', statuses: ['VERIFIED', 'NOT APPLICABLE'], expected: 'VERIFIED' },
  { name: 'only NOT APPLICABLE proves nothing', statuses: ['NOT APPLICABLE'], expected: 'INCONCLUSIVE' },
]) {
  const { statuses, expected } = testCase;
  test(`derives verdict: ${testCase.name}`, () => {
    assert.equal(deriveVerdict(statuses.map((status) => ({ status }))), expected);
  });
}

test('rejects VERIFIED whose acceptance test file does not exist', (t) => {
  const result = validateLedger(ledger([req({ acceptanceTest: 'missing.test.ts' })], 'VERIFIED'), makeRoot(t));
  assert.deepEqual(result.errors, ['CAP-001: acceptanceTest file not found: missing.test.ts']);
});

test('rejects acceptance test paths that escape the root', (t) => {
  const result = validateLedger(ledger([req({ acceptanceTest: '../../etc/passwd' })], 'VERIFIED'), makeRoot(t));
  assert.deepEqual(result.errors, ['CAP-001: acceptanceTest path escapes root: ../../etc/passwd']);
});

test('rejects VERIFIED without an acceptance test', (t) => {
  const result = validateLedger(ledger([req({ acceptanceTest: '' })], 'VERIFIED'), makeRoot(t));
  assert.deepEqual(result.errors, ['CAP-001: VERIFIED requires acceptanceTest']);
});

test('rejects VERIFIED that still records a gap', (t) => {
  const result = validateLedger(ledger([req({ gap: 'partial' })], 'VERIFIED'), makeRoot(t));
  assert.deepEqual(result.errors, ['CAP-001: VERIFIED must not record a gap']);
});

test('requires a gap for NOT VERIFIED and a reason for NOT APPLICABLE', (t) => {
  const reqs = [req({ status: 'NOT VERIFIED' }), req({ id: 'CAP-002', status: 'NOT APPLICABLE' })];
  const result = validateLedger(ledger(reqs, 'NOT VERIFIED'), makeRoot(t));
  assert.deepEqual(result.errors, ['CAP-001: NOT VERIFIED requires gap', 'CAP-002: NOT APPLICABLE requires reason']);
});

test('rejects duplicate ids, bad ids, unknown statuses, and missing fields', (t) => {
  const reqs = [req(), req(), req({ id: 'bad' }), req({ id: 'CAP-003', status: 'DONE', evidence: '' })];
  const { errors } = validateLedger(ledger(reqs, 'VERIFIED'), makeRoot(t));
  assert.deepEqual(errors, ['duplicate id: CAP-001', 'requirements[2]: id must match /^[A-Z][A-Z0-9]*-[0-9]{3,}$/', 'CAP-003: missing evidence', 'CAP-003: status must be one of VERIFIED, NOT VERIFIED, INCONCLUSIVE, NOT APPLICABLE']);
});

for (const testCase of [
  { name: 'null ledger', input: null, expected: 'ledger must be a JSON object' },
  { name: 'array ledger', input: [], expected: 'ledger must be a JSON object' },
  { name: 'no capability', input: { requirements: [] }, expected: 'missing capability' },
  { name: 'empty requirements', input: { capability: 'x', requirements: [] }, expected: 'requirements must be a non-empty array' },
  { name: 'non-object requirement', input: { capability: 'x', requirements: [null] }, expected: 'requirements[0]: must be an object' },
]) {
  const { input, expected } = testCase;
  test(`rejects malformed input: ${testCase.name}`, () => {
    assert.deepEqual(validateLedger(input, tmpdir()).errors, [expected]);
  });
}

test('renders the parity table with escaped cells and gap or reason', () => {
  const table = renderMarkdown(ledger([req({ sourceBehavior: 'a|b' }), req({ id: 'CAP-002', status: 'NOT APPLICABLE', reason: 'no TUI' })]));
  assert.match(table, /^\| Requirement ID \|/);
  assert.match(table, /a\\\|b/);
  assert.match(table, /\| NOT APPLICABLE \| no TUI \|$/);
});

test('CLI prints verdict JSON and exits 0 for a valid ledger', (t) => {
  const root = makeRoot(t);
  const file = join(root, 'ledger.json');
  writeFileSync(file, JSON.stringify(ledger([req()], 'VERIFIED')));
  const out = sink();
  assert.equal(main([file], out, sink()), 0);
  assert.deepEqual(JSON.parse(out.text()), { verdict: 'VERIFIED', counts: { VERIFIED: 1, 'NOT VERIFIED': 0, INCONCLUSIVE: 0, 'NOT APPLICABLE': 0 } });
});

test('CLI renders markdown with --markdown and honours --root', (t) => {
  const root = makeRoot(t);
  const file = join(tmpdir(), `ledger-${process.pid}.json`);
  t.after(() => rmSync(file, { force: true }));
  writeFileSync(file, JSON.stringify(ledger([req()], 'VERIFIED')));
  const out = sink();
  assert.equal(main([file, '--root', root, '--markdown'], out, sink()), 0);
  assert.match(out.text(), /\| CAP-001 \|/);
});

test('CLI exits 1 with errors on stderr for an invalid ledger', (t) => {
  const root = makeRoot(t);
  const file = join(root, 'ledger.json');
  writeFileSync(file, JSON.stringify(ledger([req()], 'INCONCLUSIVE')));
  const err = sink();
  assert.equal(main([file], sink(), err), 1);
  assert.match(err.text(), /^error: verdict must be "VERIFIED"/);
});

for (const testCase of [
  { name: 'no args', argv: [] },
  { name: 'two files', argv: ['a.json', 'b.json'] },
  { name: 'dangling --root', argv: ['a.json', '--root'] },
]) {
  const { argv } = testCase;
  test(`CLI exits 2 on usage error: ${testCase.name}`, () => {
    const err = sink();
    assert.equal(main(argv, sink(), err), 2);
    assert.match(err.text(), /^usage:/);
  });
}

test('CLI exits 2 for unreadable or non-JSON ledger', (t) => {
  const root = makeRoot(t);
  const file = join(root, 'bad.json');
  writeFileSync(file, '{not json');
  const err = sink();
  assert.equal(main([file], sink(), err), 2);
  assert.match(err.text(), /^cannot read ledger/);
  assert.equal(main([join(root, 'absent.json')], sink(), sink()), 2);
});
