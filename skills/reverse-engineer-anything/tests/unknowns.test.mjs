import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createEnvelope } from '../scripts/lib/envelope.mjs';
import { openStore } from '../scripts/lib/store.mjs';

const tempStore = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'rea-unk-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return openStore({ dir });
};

const evidence = (authority, confidence, sha) =>
  createEnvelope({
    operation: 'analyze_javascript_application',
    predicateType: 'rea.javascript-application-analysis',
    subject: { name: 'app', digest: { sha256: sha.repeat(64) }, format: 'directory', architecture: null, local_path: '/tmp/app' },
    normalizedResult: { graph: { nodes: [], edges: [] } },
    confidence,
    authority,
    limitations: ['Static only.'],
    locations: [{ kind: 'artifact-path', path: '/tmp/app' }],
  });

const question = 'Which code path writes the settings file?';

test('UNK-001: recorded unknown carries requirements and revision 1', async (t) => {
  const store = await tempStore(t);
  const staticRecord = await store.retain(evidence('shipped-artifact', 'derived', 'a'));
  const recorded = await store.recordUnknown({
    question,
    severity: 'high',
    domain: 'storage',
    required_authority: 'static-relationship-inference',
    required_confidence: 'high',
    recommended_probes: ['trace writes from the main entrypoint'],
    supporting_evidence_ids: [staticRecord.evidence_id],
  });
  assert.match(recorded.head.unknown_id, /^unk_[0-9a-f]{64}$/);
  assert.equal(recorded.head.status, 'unresolved');
  assert.equal(recorded.head.revision, 1);
  assert.deepEqual(recorded.head.recommended_probes, ['trace writes from the main entrypoint']);
  assert.deepEqual(recorded.head.supporting_evidence_ids, [staticRecord.evidence_id]);
  const listed = await store.listUnknowns({});
  assert.equal(listed.length, 1);
  const audit = await store.auditUnknowns();
  assert.equal(audit.unresolved, 1);
  assert.equal(audit.bySeverity.high, 1);
  await assert.rejects(
    () => store.recordUnknown({ question, severity: 'high', domain: 'storage' }),
    (error) => error.code === 'revision_conflict',
  );
  await assert.rejects(
    () => store.recordUnknown({ question: 'A different question with a dangling citation.', severity: 'high', domain: 'x', supporting_evidence_ids: [`ev_${'0'.repeat(64)}`] }),
    (error) => error.details.issues[0].reason === 'not_found',
  );
});

test('UNK-002: stale revision conflicts instead of overwriting', async (t) => {
  const store = await tempStore(t);
  const recorded = await store.recordUnknown({ question, severity: 'medium', domain: 'storage' });
  const updated = await store.updateUnknown(recorded.head.unknown_id, 1, { status: 'blocked' });
  assert.equal(updated.head.revision, 2);
  assert.equal(updated.head.status, 'blocked');
  await assert.rejects(
    () => store.updateUnknown(recorded.head.unknown_id, 1, { status: 'unresolved' }),
    (error) => error.code === 'revision_conflict' && error.details.current_revision === 2,
  );
  assert.equal(updated.revisions.length, 2, 'revisions are appended, never replaced');
  assert.deepEqual(updated.revisions[1], updated.head);
});

test('UNK-003: resolution is refused without qualifying evidence', async (t) => {
  const store = await tempStore(t);
  const weak = await store.retain(evidence('shipped-artifact', 'derived', 'b'));
  const strong = await store.retain(evidence('static-relationship-inference', 'derived', 'c'));
  const recorded = await store.recordUnknown({
    question,
    severity: 'high',
    domain: 'storage',
    required_authority: 'static-relationship-inference',
    required_confidence: 'derived',
  });
  await assert.rejects(
    () => store.updateUnknown(recorded.head.unknown_id, 1, { status: 'resolved', resolution: { statement: 'It writes in main.', evidence_ids: [weak.evidence_id] } }),
    (error) => error.code === 'revision_conflict' && error.details.unmet.some((entry) => entry.requirement === 'required_authority'),
  );
  await assert.rejects(
    () => store.updateUnknown(recorded.head.unknown_id, 1, { status: 'resolved', resolution: { statement: 'No evidence cited.' } }),
    (error) => error.details.unmet.some((entry) => entry.requirement === 'evidence'),
  );
  const resolved = await store.updateUnknown(recorded.head.unknown_id, 1, {
    status: 'resolved',
    resolution: { statement: 'The main entrypoint writes it in one literal call.', evidence_ids: [strong.evidence_id] },
  });
  assert.equal(resolved.head.status, 'resolved');
  const verification = await store.verifyUnknownResolution(recorded.head.unknown_id);
  assert.equal(verification.qualified, true);
  const audit = await store.auditUnknowns();
  assert.equal(audit.unresolved, 0);
});

test('UNK-004: an unknown survives an export and import round trip', async (t) => {
  const store = await tempStore(t);
  await store.recordUnknown({ question, severity: 'low', domain: 'storage' });
  const path = join(store.root, 'bundle.json');
  await store.exportBundle(path, {});
  const other = await tempStore(t);
  await other.importBundle(path);
  const heads = await other.listUnknowns({});
  assert.equal(heads.length, 1);
  assert.equal(heads[0].question, question);
});
