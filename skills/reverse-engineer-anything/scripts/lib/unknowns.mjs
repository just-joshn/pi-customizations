import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { normalizeQuestion, unknownId } from './canonical.mjs';
import { invalidInput, revisionConflict } from './errors.mjs';
import { writeJsonAtomic } from './store-io.mjs';

const SEVERITIES = new Set(['low', 'medium', 'high']);
const UNKNOWN_ID = /^unk_[0-9a-f]{64}$/;

/** An id from a bundle or a CLI argument is data, so it must not be able to name a path. */
export function assertUnknownId(id) {
  if (typeof id !== 'string' || !UNKNOWN_ID.test(id)) {
    throw invalidInput('A malformed unknown id was supplied.', [{ path: ['unknown_id'], reason: 'invalid_value', message: 'unknown ids look like unk_ followed by 64 hex characters' }]);
  }
  return id;
}
const STATUSES = new Set(['unresolved', 'resolved', 'blocked', 'not_applicable']);

/** Serialize unknown writes with the same lock the ledger uses, when the store offers one. */
const locked = (store, work) => (typeof store.withLock === 'function' ? store.withLock(work) : work());

/** An unknown records what the evidence cannot answer, not what the analyst guesses. */
export async function recordUnknown(store, input) {
  return locked(store, () => recordUnknownUnlocked(store, input));
}

async function recordUnknownUnlocked(store, input) {
  const question = String(input.question ?? '').trim();
  const issues = [];
  if (question === '') issues.push({ path: ['question'], reason: 'required', message: 'an unknown needs the question it stands for' });
  if (!SEVERITIES.has(input.severity)) issues.push({ path: ['severity'], reason: 'invalid_value', message: `severity must be one of ${[...SEVERITIES].join(', ')}` });
  if (typeof input.domain !== 'string' || input.domain.trim() === '') issues.push({ path: ['domain'], reason: 'required', message: 'an unknown needs a domain' });
  if (issues.length > 0) throw invalidInput('The unknown is not well formed.', issues);

  const id = unknownId(question);
  const dir = await store.unknownDir();
  const path = join(dir, `${id}.json`);
  const existing = await readUnknownFile(path);
  if (existing !== null) {
    throw revisionConflict('That question is already recorded.', {
      unknown_id: id,
      revision: existing.head.revision,
      action: 'Update the existing unknown with its current revision instead of recording it again.',
    });
  }

  await assertEvidenceExists(store, [...(input.supporting_evidence_ids ?? []), ...(input.contradicting_evidence_ids ?? [])]);
  const head = {
    unknown_id: id,
    question,
    normalized_question: normalizeQuestion(question),
    severity: input.severity,
    domain: input.domain,
    required_authority: input.required_authority ?? null,
    required_confidence: input.required_confidence ?? null,
    required_environment: input.required_environment ?? null,
    recommended_probes: [...(input.recommended_probes ?? [])],
    relationships: [...(input.relationships ?? [])],
    supporting_evidence_ids: [...(input.supporting_evidence_ids ?? [])],
    contradicting_evidence_ids: [...(input.contradicting_evidence_ids ?? [])],
    resolution: null,
    status: 'unresolved',
    revision: 1,
    updated_at: new Date().toISOString(),
  };
  const record = { unknown_id: id, head, revisions: [head] };
  await writeJsonAtomic(path, record);
  return record;
}

/**
 * Append one immutable full-state revision. A stale writer fails instead of
 * overwriting newer analysis, so two investigators cannot silently clobber one
 * another's conclusion.
 */
export async function updateUnknown(store, id, expectedRevision, patch) {
  return locked(store, () => updateUnknownUnlocked(store, id, expectedRevision, patch));
}

async function updateUnknownUnlocked(store, id, expectedRevision, patch) {
  assertUnknownId(id);
  const dir = await store.unknownDir();
  const path = join(dir, `${id}.json`);
  const record = await readUnknownFile(path);
  if (record === null) throw invalidInput('No unknown has that id.', [{ path: ['unknown_id'], reason: 'not_found', message: `unknown id: ${id}` }]);
  if (record.head.revision !== expectedRevision) {
    throw revisionConflict('The unknown changed since it was read.', {
      unknown_id: id,
      expected_revision: expectedRevision,
      current_revision: record.head.revision,
      action: 'Re-read the unknown and retry with its current revision.',
    });
  }
  if (!STATUSES.has(patch.status)) throw invalidInput('The update has an unknown status.', [{ path: ['status'], reason: 'invalid_value', message: `status must be one of ${[...STATUSES].join(', ')}` }]);

  const resolution = patch.status === 'resolved' ? (patch.resolution ?? null) : null;
  if (patch.status === 'resolved') {
    if (!resolution || typeof resolution.statement !== 'string' || resolution.statement.trim() === '') {
      throw invalidInput('A resolution needs the statement it establishes.', [{ path: ['resolution', 'statement'], reason: 'required', message: 'resolution.statement is required' }]);
    }
    const cited = resolution.evidence_ids ?? [];
    const unmet = await unmetRequirements(store, record.head, cited);
    if (unmet.length > 0) {
      throw revisionConflict('The cited evidence does not meet the unknown’s requirements.', {
        unknown_id: id,
        action: 'Cite evidence whose authority and confidence match the recorded requirement, or leave the unknown unresolved.',
        unmet,
      });
    }
  }

  await assertEvidenceExists(store, [...(patch.supporting_evidence_ids ?? record.head.supporting_evidence_ids), ...(patch.contradicting_evidence_ids ?? record.head.contradicting_evidence_ids)]);
  const head = {
    ...record.head,
    severity: patch.severity ?? record.head.severity,
    required_authority: patch.required_authority ?? record.head.required_authority,
    required_confidence: patch.required_confidence ?? record.head.required_confidence,
    required_environment: patch.required_environment ?? record.head.required_environment,
    recommended_probes: [...(patch.recommended_probes ?? record.head.recommended_probes)],
    relationships: [...(patch.relationships ?? record.head.relationships)],
    supporting_evidence_ids: [...(patch.supporting_evidence_ids ?? record.head.supporting_evidence_ids)],
    contradicting_evidence_ids: [...(patch.contradicting_evidence_ids ?? record.head.contradicting_evidence_ids)],
    resolution,
    status: patch.status,
    revision: record.head.revision + 1,
    updated_at: new Date().toISOString(),
  };
  const updated = { unknown_id: id, head, revisions: [...record.revisions, head] };
  await writeJsonAtomic(path, updated);
  return updated;
}

/** Full unknown records (head plus its immutable revision chain), for a bundle. */
export async function unknownRecords(store) {
  const dir = await store.unknownDir();
  const names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  const records = [];
  for (const name of names) {
    const record = await readUnknownFile(join(dir, name));
    if (record !== null) records.push(record);
  }
  return records;
}

/** Restore one exported unknown record. An existing record with the same id is left alone. */
export async function importUnknownRecord(store, record) {
  assertUnknownId(record.unknown_id);
  const dir = await store.unknownDir();
  const path = join(dir, `${record.unknown_id}.json`);
  const existing = await readUnknownFile(path);
  if (existing !== null) return false;
  await writeJsonAtomic(path, record);
  return true;
}

export async function listUnknowns(store, filter = {}) {
  const dir = await store.unknownDir();
  const names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  const records = [];
  for (const name of names) {
    const record = await readUnknownFile(join(dir, name));
    if (record !== null) records.push(record);
  }
  return records
    .map((record) => record.head)
    .filter((head) => (filter.status ? head.status === filter.status : true))
    .filter((head) => (filter.severity ? head.severity === filter.severity : true))
    .filter((head) => (filter.domain ? head.domain === filter.domain : true));
}

export async function auditUnknowns(store) {
  const heads = await listUnknowns(store, {});
  const unresolved = heads.filter((head) => head.status === 'unresolved' || head.status === 'blocked');
  return {
    total: heads.length,
    unresolved: unresolved.length,
    bySeverity: {
      high: unresolved.filter((head) => head.severity === 'high').length,
      medium: unresolved.filter((head) => head.severity === 'medium').length,
      low: unresolved.filter((head) => head.severity === 'low').length,
    },
    heads: unresolved.map((head) => ({
      unknown_id: head.unknown_id,
      question: head.question,
      severity: head.severity,
      domain: head.domain,
      required_authority: head.required_authority,
      required_confidence: head.required_confidence,
      recommended_probes: head.recommended_probes,
    })),
  };
}

export async function verifyUnknownResolution(store, id) {
  assertUnknownId(id);
  const dir = await store.unknownDir();
  const record = await readUnknownFile(join(dir, `${id}.json`));
  if (record === null) throw invalidInput('No unknown has that id.', [{ path: ['unknown_id'], reason: 'not_found', message: `unknown id: ${id}` }]);
  if (record.head.status !== 'resolved') return { unknown_id: id, qualified: false, reason: `status is ${record.head.status}` };
  const unmet = await unmetRequirements(store, record.head, record.head.resolution?.evidence_ids ?? []);
  return { unknown_id: id, qualified: unmet.length === 0, unmet };
}

async function unmetRequirements(store, head, evidenceIds) {
  const unmet = [];
  if (evidenceIds.length === 0) unmet.push({ requirement: 'evidence', message: 'the resolution cites no evidence' });
  for (const id of evidenceIds) {
    const record = await store.get(id);
    if (head.required_authority !== null && record.authority !== head.required_authority) {
      unmet.push({ requirement: 'required_authority', evidence_id: id, expected: head.required_authority, actual: record.authority });
    }
    if (head.required_confidence !== null && record.confidence !== head.required_confidence) {
      unmet.push({ requirement: 'required_confidence', evidence_id: id, expected: head.required_confidence, actual: record.confidence });
    }
  }
  return unmet;
}

async function assertEvidenceExists(store, ids) {
  const missing = [];
  for (const id of ids) {
    if (!(await store.has(id))) missing.push(id);
  }
  if (missing.length > 0)
    throw invalidInput(
      'The cited evidence is not retained in this session.',
      missing.map((id) => ({ path: ['evidence_ids'], reason: 'not_found', message: `unknown evidence id: ${id}` })),
    );
}

async function readUnknownFile(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}
