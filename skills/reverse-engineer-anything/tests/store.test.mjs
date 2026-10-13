import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createEnvelope } from '../scripts/lib/envelope.mjs';
import { openStore } from '../scripts/lib/store.mjs';

const subject = { name: 'fixture.zip', digest: { sha256: 'a'.repeat(64) }, format: 'zip', architecture: null, local_path: '/tmp/fixture.zip' };

const record = (overrides = {}) =>
  createEnvelope({
    operation: 'inspect_artifact',
    predicateType: 'rea.artifact-inventory',
    subject,
    parameters: { integrity_policy: 'fail' },
    normalizedResult: { format: 'zip', collections: { occurrences: [] }, ...overrides },
    confidence: 'derived',
    authority: 'shipped-artifact',
    limitations: ['Inventory only.'],
    locations: [{ kind: 'artifact-path', path: '/tmp/fixture.zip' }],
  });

const tempStore = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'rea-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return openStore({ dir });
};

test('STORE-001: evidence lands on disk before reporting', async (t) => {
  const store = await tempStore(t);
  const envelope = record();
  const retained = await store.retain(envelope);
  const path = join(store.sessionDir, 'evidence', `${envelope.evidence_id}.json`);
  assert.equal(
    await access(path).then(
      () => true,
      () => false,
    ),
    true,
  );
  assert.equal(retained.evidence_id, envelope.evidence_id);
  const onDisk = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(onDisk.limitations, ['Inventory only.']);
  const ledger = JSON.parse(readFileSync(join(store.sessionDir, 'ledger.json'), 'utf8'));
  assert.equal(ledger.records.length, 1);
  assert.equal(ledger.records[0].repeat_count, 1);
});

test('STORE-002: identical analysis does not duplicate records', async (t) => {
  const store = await tempStore(t);
  const first = await store.retain(record());
  const second = await store.retain(record());
  assert.equal(first.evidence_id, second.evidence_id);
  assert.equal(second.deduplicated, true);
  assert.equal(second.repeat_count, 2);
  const listed = await store.list({});
  assert.equal(listed.length, 1);
  const ledger = JSON.parse(readFileSync(join(store.sessionDir, 'ledger.json'), 'utf8'));
  assert.equal(ledger.records.length, 1);
  assert.equal(ledger.records[0].repeat_count, 2);
});

test('STORE-003: interrupted write leaves the previous record intact', async (t) => {
  const store = await tempStore(t);
  const retained = await store.retain(record());
  writeFileSync(join(store.sessionDir, 'ledger.json'), '{"schema":"pi-rea.ledger.v1","records":');
  const ledger = await store.ledger();
  assert.equal(ledger.records.length, 1, 'a corrupt index is rebuilt from the evidence directory');
  assert.equal(ledger.records[0].evidence_id, retained.evidence_id);
  const again = await store.retain(record());
  assert.equal(again.evidence_id, retained.evidence_id);
});

test('STORE-004: bundle export is byte-stable and import validates digests', async (t) => {
  const store = await tempStore(t);
  await store.retain(record());
  const first = join(store.root, 'one.json');
  const second = join(store.root, 'two.json');
  await store.exportBundle(first, { stable: true });
  await store.exportBundle(second, { stable: true });
  assert.equal(readFileSync(first, 'utf8'), readFileSync(second, 'utf8'), 'a stable export of an unchanged session is byte-identical');
  await assert.rejects(
    () => store.exportBundle(first, {}),
    (error) => error.code === 'invalid_request',
  );

  const other = await tempStore(t);
  const imported = await other.importBundle(first);
  assert.equal(imported.imported, 1);
  const again = await other.importBundle(first);
  assert.equal(again.imported, 0);
  assert.equal(again.skipped, 1);

  const bundle = JSON.parse(readFileSync(first, 'utf8'));
  bundle.records[0].normalized_result.format = 'tampered';
  const tampered = join(store.root, 'tampered.json');
  writeFileSync(tampered, JSON.stringify(bundle));
  await assert.rejects(
    () => other.importBundle(tampered),
    (error) => error.code === 'evidence_integrity_mismatch' && error.details.expected !== undefined,
  );
});

test('STORE-003b: concurrent writers lose no index entry', async (t) => {
  const store = await tempStore(t);
  const records = ['a', 'b', 'c', 'd', 'e'].map((seed) =>
    createEnvelope({
      operation: 'inspect_artifact',
      predicateType: 'rea.artifact-inventory',
      subject: { ...subject, digest: { sha256: seed.repeat(64) } },
      parameters: {},
      normalizedResult: { format: 'zip', seed },
      confidence: 'derived',
      authority: 'shipped-artifact',
      limitations: ['Inventory only.'],
      locations: [{ kind: 'artifact-path', path: '/tmp/fixture.zip' }],
    }),
  );
  await Promise.all(records.map((record) => store.retain(record)));
  const ledger = JSON.parse(readFileSync(join(store.sessionDir, 'ledger.json'), 'utf8'));
  assert.equal(ledger.records.length, 5, 'every concurrent writer must appear in the index');
  assert.deepEqual(ledger.records.map((entry) => entry.evidence_id).sort(), records.map((record) => record.evidence_id).sort());
  const listed = await store.list({});
  assert.equal(listed.length, 5);
});

test('STORE-010: a lock held by a live writer is not stolen', async (t) => {
  const store = await tempStore(t);
  const lockPath = join(store.sessionDir, 'ledger.json.lock');
  writeFileSync(lockPath, 'another-writers-token');
  await assert.rejects(
    () => store.retain(record()),
    (error) => error.code === 'resource_constraint' && error.retryable === true && error.details.lock === lockPath,
  );
  assert.equal(readFileSync(lockPath, 'utf8'), 'another-writers-token', 'the holder keeps its lock');
  rmSync(lockPath);
  const retained = await store.retain(record());
  assert.equal(retained.repeat_count, 1, 'the writer proceeds once the lock is released');
});

test('STORE-005: a bundle refuses to overwrite without permission', async (t) => {
  const store = await tempStore(t);
  const target = join(store.root, 'bundle.json');
  await store.exportBundle(target, {});
  await assert.rejects(
    () => store.exportBundle(target, {}),
    (error) => error.category === 'invalid_input',
  );
  await store.exportBundle(target, { overwrite: true });
  assert.ok(readFileSync(target, 'utf8').includes('pi-rea.bundle.v1'));
});

test('STORE-006: readAnyEvidence refuses a session directory', async (t) => {
  const store = await tempStore(t);
  const { readAnyEvidence } = await import('../scripts/lib/store.mjs');
  await assert.rejects(
    () => readAnyEvidence(store.sessionDir),
    (error) => error.category === 'invalid_input',
  );
});

test('STORE-007: a malformed evidence or unknown id cannot name a path', async (t) => {
  const store = await tempStore(t);
  await store.retain(record());
  await assert.rejects(
    () => store.get('ev_../../../../etc/passwd'),
    (error) => error.category === 'invalid_input' && error.details.issues[0].path[0] === 'evidence_id',
  );
  await assert.rejects(
    () => store.get('../../etc/passwd'),
    (error) => error.category === 'invalid_input',
  );
  assert.equal(await store.has('ev_not-an-id'), false);
  await assert.rejects(
    () => store.updateUnknown('../../../../tmp/escape', 1, { status: 'blocked' }),
    (error) => error.category === 'invalid_input',
  );
});

test('STORE-008: a hostile bundle cannot write outside the store', async (t) => {
  const store = await tempStore(t);
  const path = join(store.root, 'hostile.json');
  writeFileSync(
    path,
    JSON.stringify({
      schema: 'pi-rea.bundle.v1',
      records: [],
      unknowns: [{ unknown_id: '../../../../tmp/pi-rea-escape', head: { question: 'x', revision: 1, status: 'unresolved' } }],
    }),
  );
  await assert.rejects(
    () => store.importBundle(path),
    (error) => error.code === 'evidence_integrity_mismatch' || error.category === 'invalid_input',
  );
});

test('STORE-009: concurrent unknown revisions cannot both win', async (t) => {
  const store = await tempStore(t);
  const recorded = await store.recordUnknown({ question: 'Which writer wins?', severity: 'low', domain: 'storage' });
  const results = await Promise.allSettled([
    store.updateUnknown(recorded.head.unknown_id, 1, { status: 'blocked' }),
    store.updateUnknown(recorded.head.unknown_id, 1, { status: 'resolved', resolution: { statement: 'no', evidence_ids: [] } }),
  ]);
  const rejected = results.filter((entry) => entry.status === 'rejected');
  assert.equal(rejected.length, 1, 'exactly one writer may append revision 2');
  assert.equal(rejected[0].reason.code, 'revision_conflict');
  const heads = await store.listUnknowns({});
  assert.equal(heads[0].revision, 2);
});
