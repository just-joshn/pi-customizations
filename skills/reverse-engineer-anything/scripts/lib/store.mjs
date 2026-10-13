import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { evidenceId, unknownId } from './canonical.mjs';
import { fail, invalidInput } from './errors.mjs';
import { readJsonFile, readJsonOrNull, writeJsonAtomic } from './store-io.mjs';
import { auditUnknowns, importUnknownRecord, listUnknowns, recordUnknown, unknownRecords, updateUnknown, verifyUnknownResolution } from './unknowns.mjs';

const LEDGER_SCHEMA = 'pi-rea.ledger.v1';
const BUNDLE_SCHEMA = 'pi-rea.bundle.v1';
const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 10000;
const LOCK_RETRY_MS = 20;
const EVIDENCE_ID = /^ev_[0-9a-f]{64}$/;

function assertEvidenceId(id) {
  if (typeof id !== 'string' || !EVIDENCE_ID.test(id)) {
    throw invalidInput('A malformed evidence id was supplied.', [{ path: ['evidence_id'], reason: 'invalid_value', message: 'evidence ids look like ev_ followed by 64 hex characters' }]);
  }
  return id;
}

async function exists(path) {
  return access(path, constants.F_OK).then(
    () => true,
    () => false,
  );
}

/** Resolve the session's directories and create them, reusing the current session when none is named. */
async function openSessionPaths({ dir, sessionId }) {
  const root = resolve(dir);
  const existing = await readJsonOrNull(join(root, 'current.json'));
  const session = sessionId ?? existing?.session ?? `s_${randomUUID()}`;
  const sessionDir = join(root, 'sessions', session);
  const paths = { root, session, sessionDir, evidenceDir: join(sessionDir, 'evidence'), unknownDir: join(sessionDir, 'unknowns'), ledgerPath: join(sessionDir, 'ledger.json') };
  await mkdir(paths.evidenceDir, { recursive: true });
  await mkdir(paths.unknownDir, { recursive: true });
  if (sessionId === null && existing?.session !== session) await writeJsonAtomic(join(root, 'current.json'), { session });
  return paths;
}

function indexEntry(record, repeatCount) {
  return {
    evidence_id: record.evidence_id,
    operation: record.operation,
    predicate_type: record.predicate_type,
    subject_sha256: record.subject?.digest?.sha256 ?? null,
    local_path: record.subject?.local_path ?? null,
    created_at: new Date().toISOString(),
    repeat_count: repeatCount,
  };
}

const byId = (left, right) => (left.evidence_id < right.evidence_id ? -1 : 1);

/** The ledger is derived state: it can always be rebuilt from the evidence records. */
async function rebuildLedger(paths) {
  const files = (await readdir(paths.evidenceDir)).filter((name) => name.endsWith('.json'));
  const records = [];
  for (const file of files) {
    const record = await readJsonFile(join(paths.evidenceDir, file));
    records.push(indexEntry(record, 1));
  }
  records.sort(byId);
  return { schema: LEDGER_SCHEMA, session: paths.session, rebuilt_at: new Date().toISOString(), records };
}

async function readLedger(paths) {
  try {
    const ledger = await readJsonOrNull(paths.ledgerPath);
    if (ledger === null || !Array.isArray(ledger.records)) return rebuildLedger(paths);
    return ledger;
  } catch {
    return rebuildLedger(paths);
  }
}

/**
 * Serialize the read-modify-write of the ledger. Evidence files are immutable
 * and content-addressed so they never conflict, but two writers that both read
 * an index and then write it would lose one entry; the lock closes that window.
 * A lock older than the stale window is treated as abandoned by a crashed run.
 */
async function withLedgerLock(paths, work) {
  const lockPath = `${paths.ledgerPath}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  const token = randomUUID();
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(token, 'utf8');
      try {
        return await work();
      } finally {
        await handle.close();
        await releaseOwnLock(lockPath, token);
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      const { mtimeMs } = await stat(lockPath).catch(() => ({ mtimeMs: Date.now() }));
      if (Date.now() - mtimeMs > LOCK_STALE_MS) {
        await rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() > deadline) throw fail('resource_constraint', 'resource_constraint', 'Another writer is holding the session ledger lock.', { retryable: true, details: { lock: lockPath } });
      await delay(LOCK_RETRY_MS);
    }
  }
}

/** Remove the lock only if this writer still owns it, so a stale takeover cannot free a successor's lock. */
async function releaseOwnLock(lockPath, token) {
  const owner = await readFile(lockPath, 'utf8').catch(() => null);
  if (owner === token) await rm(lockPath, { force: true });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readRecord(paths, id) {
  assertEvidenceId(id);
  const record = await readJsonOrNull(join(paths.evidenceDir, `${id}.json`));
  if (record === null) throw invalidInput('No retained evidence has that id.', [{ path: ['evidence_id'], reason: 'not_found', message: `unknown evidence id: ${id}` }]);
  return record;
}

/** Write the record, then index it. A repeated analysis keeps one record and counts the repeat. */
async function retainRecord(paths, record) {
  return withLedgerLock(paths, () => retainRecordUnlocked(paths, record));
}

async function retainRecordUnlocked(paths, record) {
  const ledger = await readLedger(paths);
  const known = ledger.records.find((entry) => entry.evidence_id === record.evidence_id);
  if (known) {
    const repeated = { ...ledger, updated_at: new Date().toISOString(), records: ledger.records.map((entry) => (entry.evidence_id === record.evidence_id ? { ...entry, repeat_count: entry.repeat_count + 1 } : entry)) };
    await writeJsonAtomic(paths.ledgerPath, repeated);
    return { ...record, repeat_count: known.repeat_count + 1, deduplicated: true };
  }
  await writeJsonAtomic(join(paths.evidenceDir, `${record.evidence_id}.json`), record);
  const updated = { ...ledger, schema: LEDGER_SCHEMA, session: paths.session, updated_at: new Date().toISOString(), records: [...ledger.records, indexEntry(record, 1)].sort(byId) };
  await writeJsonAtomic(paths.ledgerPath, updated);
  return { ...record, repeat_count: 1, deduplicated: false };
}

async function listRecords(paths, filter) {
  const ledger = await readLedger(paths);
  return ledger.records
    .filter((entry) => (filter.operation ? entry.operation === filter.operation : true))
    .filter((entry) => (filter.subjectSha256 ? entry.subject_sha256 === filter.subjectSha256 : true))
    .sort(byId);
}

/** Byte-stable export: records sorted by id, so two exports of an unchanged session match. */
async function exportBundle(paths, path, { overwrite = false, stable = false } = {}) {
  const target = resolve(path);
  if (!overwrite && (await exists(target))) throw invalidInput('Refusing to overwrite an existing bundle.', [{ path: ['path'], reason: 'exists', message: `bundle already exists: ${target}` }]);
  const ledger = await readLedger(paths);
  const records = [];
  for (const entry of [...ledger.records].sort(byId)) records.push(await readRecord(paths, entry.evidence_id));
  const unknowns = await unknownRecords({ unknownDir: async () => paths.unknownDir });
  const bundle = { schema: BUNDLE_SCHEMA, session: paths.session, ...(stable ? {} : { generated_at: new Date().toISOString() }), records, unknowns };
  await writeJsonAtomic(target, bundle);
  return { path: target, recordCount: records.length, unknownCount: unknowns.length };
}

/** Validate every record's content address before writing anything. */
function assertBundleIntegrity(bundle) {
  for (const record of bundle.records ?? []) {
    const expected = evidenceId({ operation: record.operation, parameters: record.parameters, subjectSha256: record.subject?.digest?.sha256, normalizedResult: record.normalized_result });
    if (expected !== record.evidence_id) {
      throw fail('evidence_integrity_mismatch', 'integrity_mismatch', 'Imported evidence failed its content address check.', { details: { evidence_id: record.evidence_id, expected, operation: record.operation } });
    }
  }
}

async function importBundle(paths, path) {
  const target = resolve(path);
  const bundle = await readJsonOrNull(target);
  if (bundle === null) throw invalidInput('No bundle exists at that path.', [{ path: ['path'], reason: 'not_found', message: `no readable bundle: ${target}` }]);
  if (bundle.schema !== BUNDLE_SCHEMA) throw invalidInput('The bundle schema is not supported.', [{ path: ['schema'], reason: 'invalid_value', message: `unsupported bundle schema: ${bundle.schema}` }]);
  assertBundleIntegrity(bundle);
  let imported = 0;
  for (const record of bundle.records ?? []) {
    if (await exists(join(paths.evidenceDir, `${record.evidence_id}.json`))) continue;
    await retainRecord(paths, record);
    imported += 1;
  }
  let importedUnknowns = 0;
  const unknownStore = { unknownDir: async () => paths.unknownDir };
  for (const unknown of bundle.unknowns ?? []) {
    if (!unknown?.unknown_id || !unknown.head) continue;
    if (unknownId(unknown.head.question) !== unknown.unknown_id) {
      throw fail('evidence_integrity_mismatch', 'integrity_mismatch', 'Imported unknown failed its identity check.', { details: { unknown_id: unknown.unknown_id, expected: unknownId(unknown.head.question) } });
    }
    if (await importUnknownRecord(unknownStore, unknown)) importedUnknowns += 1;
  }
  return { path: target, imported, skipped: (bundle.records ?? []).length - imported, importedUnknowns };
}

/**
 * Session memory. Evidence records are immutable and content-addressed; the
 * ledger is derived, so an interrupted run is recoverable.
 */
export async function openStore({ dir, sessionId = null }) {
  const paths = await openSessionPaths({ dir, sessionId });
  const unknownStore = { unknownDir: async () => paths.unknownDir, get: (id) => readRecord(paths, id), has: (id) => exists(join(paths.evidenceDir, `${id}.json`)), withLock: (work) => withLedgerLock(paths, work) };
  return {
    root: paths.root,
    session: paths.session,
    sessionDir: paths.sessionDir,

    retain: (record) => retainRecord(paths, record),
    get: (id) => readRecord(paths, id),
    has: (id) => (EVIDENCE_ID.test(id) ? exists(join(paths.evidenceDir, `${id}.json`)) : Promise.resolve(false)),
    list: (filter = {}) => listRecords(paths, filter),
    ledger: () => readLedger(paths),
    exportBundle: (path, options) => exportBundle(paths, path, options),
    importBundle: (path) => importBundle(paths, path),

    importUnknownRecord: (record) => importUnknownRecord(unknownStore, record),
    unknownRecords: () => unknownRecords(unknownStore),
    recordUnknown: (input) => recordUnknown(unknownStore, input),
    updateUnknown: (id, expectedRevision, patch) => updateUnknown(unknownStore, id, expectedRevision, patch),
    verifyUnknownResolution: (id) => verifyUnknownResolution(unknownStore, id),
    listUnknowns: (filter) => listUnknowns(unknownStore, filter),
    auditUnknowns: () => auditUnknowns(unknownStore),
    unknownDir: () => paths.unknownDir,

    async remove() {
      await rm(paths.sessionDir, { recursive: true, force: true });
    },
  };
}

export const defaultStoreDir = (cwd = process.cwd()) => join(cwd, '.rea');

/** Read-only store access for views: a view may read a record without a session. */
export async function readAnyEvidence(path) {
  const resolved = resolve(path);
  const info = await stat(resolved);
  if (!info.isFile()) throw invalidInput('Views read retained evidence files.', [{ path: ['evidence'], reason: 'invalid_value', message: `not a file: ${resolved}` }]);
  return readJsonFile(resolved);
}

export { readJsonFile, writeJsonAtomic };
