import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { ReaError } from '../src/contract/errors.ts';
import { canonicalJson, createEvidence, type EvidenceDraft, evidenceSummaryEntry, isEvidenceRecord, verifyEvidenceIdentity } from '../src/session/evidence.ts';
import { emptyBundle, parseBundle, serializeBundle, validateBundle } from '../src/session/evidence-ledger.ts';
import { unknownMutationEvidence } from '../src/session/unknown-mutation-evidence.ts';
import { capture, readFixture } from './support/fixtures.ts';

const draft = (overrides: Partial<EvidenceDraft> = {}): EvidenceDraft => ({
  subject: { name: 'fixture', digest: { sha256: 'b'.repeat(64) }, format: 'mach-o', architecture: 'arm64', local_path: '/tmp/fixture' },
  provider: { id: 'native-macos', name: 'macOS native inspection utilities', version: null },
  analysis_profile: null,
  predicate_type: 'rea.analysis',
  operation: 'inspect_plist',
  parameters: { path: '/tmp/fixture' },
  raw_result: null,
  normalized_result: { format: 'xml', value: { ProductVersion: '1' } },
  confidence: 'observed',
  authority: 'shipped-artifact',
  environment: null,
  limitations: [],
  locations: [],
  evidence_links: [],
  ...overrides,
});

test('KERN-006: an Evidence identifier is content-addressed and stable', () => {
  const first = createEvidence(draft());
  const second = createEvidence(draft());
  expect(first.evidence_id).toMatch(/^ev_[a-f0-9]{64}$/);
  expect(first.evidence_id).toBe(second.evidence_id);
  expect(verifyEvidenceIdentity(first)).toBe(true);
});

test('KERN-044: a reference-produced bundle is refused by the identity check', () => {
  const reference = readFixture<{ records: Record<string, unknown>[] }>('evidence-bundle-export.json');
  const { error } = validateBundle(reference);
  expect(error).toContain('Evidence semantic identifier does not match its record');
});

test('KERN-006: any recorded fact changes the identifier', () => {
  const base = createEvidence(draft()).evidence_id;
  const changes: Partial<EvidenceDraft>[] = [
    { operation: 'inspect_macho' },
    { confidence: 'inferred' },
    { authority: 'analyst-inference' },
    { limitations: ['bounded search'] },
    { normalized_result: { format: 'xml', value: { ProductVersion: '2' } } },
    { subject: { name: 'other', digest: { sha256: 'c'.repeat(64) }, format: 'elf', architecture: 'x86_64', local_path: null } },
  ];
  for (const change of changes) {
    expect(createEvidence(draft(change)).evidence_id).not.toBe(base);
  }
});

test('KERN-006: structural validation rejects records that are not canonical Evidence', () => {
  const record = createEvidence(draft());
  expect(isEvidenceRecord(record)).toBe(true);
  expect(isEvidenceRecord({ ...record, evidence_id: 'ev_not-hex' })).toBe(false);
  expect(isEvidenceRecord({ ...record, predicate_type: 'unknown' })).toBe(false);
  expect(isEvidenceRecord({ ...record, limitations: [1] })).toBe(false);
  expect(isEvidenceRecord({ ...record, provider: { id: 'x' } })).toBe(false);
  expect(isEvidenceRecord(null)).toBe(false);
  expect(isEvidenceRecord({ ...record, subject: null })).toBe(true);
});

test('KERN-006: a registry mutation records the reference provider, predicate and limitations', () => {
  const mutation = unknownMutationEvidence('record', {
    question: 'Which tool produced the plist value?',
    severity: 'low',
    domain: 'fixture',
    required_authority: 'analyst-inference',
    required_confidence: 'inferred',
    required_environment: null,
    recommended_probes: [],
    relationships: [],
    supporting_evidence_ids: [],
    contradicting_evidence_ids: [],
  });
  const reference = capture('pass5', 'get_evidence_bundle--mutation-evidence').response.result?.structuredContent as {
    result: { records: Record<string, unknown>[] };
  };
  const expected = reference.result.records[0] as Record<string, unknown>;
  expect(Object.keys(mutation).toSorted()).toStrictEqual(Object.keys(expected).toSorted());
  expect(mutation.provider).toStrictEqual(expected['provider']);
  expect(mutation.predicate_type).toBe('rea.residual-unknown-mutation');
  expect(mutation.operation).toBe('record_unknown');
  expect(mutation.parameters).toStrictEqual(expected['parameters']);
  expect(mutation.normalized_result).toStrictEqual({
    action: 'record',
    question: 'Which tool produced the plist value?',
    required_authority: 'analyst-inference',
    required_confidence: 'inferred',
  });
  expect(mutation.confidence).toBe(expected['confidence']);
  expect(mutation.authority).toBe(expected['authority']);
  expect(mutation.limitations).toStrictEqual(expected['limitations']);
  expect(mutation.locations).toStrictEqual([]);
  expect(mutation.evidence_links).toStrictEqual([]);
});

test('KERN-007: the summary projection carries the reference fields', () => {
  const summaryCapture = capture('pass2', 'get_evidence_bundle--after-analysis').response.result?.structuredContent as {
    result: { records: Record<string, unknown>[] };
  };
  const firstSummarised = summaryCapture.result.records[0];
  if (firstSummarised === undefined) throw new Error('the reference summary capture has no records');
  const referenceKeys = Object.keys(firstSummarised).toSorted();
  const summary = evidenceSummaryEntry(createEvidence(draft()));
  expect(Object.keys(summary).toSorted()).toStrictEqual(referenceKeys);
  expect(summary.retention).toBe('complete-record');
  expect(summary.native_dossier.available).toBe(false);
});

test('KERN-008: a bundle round-trips through canonical serialization', () => {
  const record = createEvidence(draft());
  const bundle = { ...emptyBundle(), records: [record], providers: [{ id: record.provider.id, name: record.provider.name, version: null }] };
  const text = serializeBundle(bundle);
  expect(text).toBe(canonicalJson(bundle));
  const parsed = parseBundle(text);
  expect(parsed.records).toStrictEqual([record]);
  expect(verifyEvidenceIdentity(parsed.records[0] as typeof record)).toBe(true);
});

test('KERN-008: a tampered pi-rea bundle is rejected before the ledger changes', async ({ onTestFinished }) => {
  const own = createEvidence(draft());
  const bundle = { ...emptyBundle(), records: [own] };
  const tampered = structuredClone(bundle);
  const record = tampered.records[0] as { normalized_result: Record<string, unknown> };
  record.normalized_result['tampered'] = true;
  const { error } = validateBundle(tampered);
  expect(error).toContain('Evidence semantic identifier does not match its record');
  expect(validateBundle(bundle).error).toBeUndefined();

  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-bundle-'));
  onTestFinished(async () => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'tampered.json');
  await writeFile(path, JSON.stringify(tampered));
  let thrown: unknown;
  try {
    parseBundle(await readFile(path, 'utf8'));
  } catch (error_) {
    thrown = error_;
  }
  expect(thrown).toBeInstanceOf(ReaError);
  expect((thrown as ReaError).payload.code).toBe('evidence_integrity_mismatch');
  expect((thrown as ReaError).payload.category).toBe('integrity_mismatch');
  expect((thrown as ReaError).payload.details).toStrictEqual({ reason: 'Evidence bundle validation failed' });
});

test('KERN-008: a bundle with an unknown top-level field is rejected', () => {
  expect(validateBundle({ records: [], unexpected: [] }).error).toContain('unsupported fields');
  expect(validateBundle('not an object').error).toBe('bundle must be an object');
  expect(validateBundle({ records: [{}] }).error).toContain('records.0');
  expect(validateBundle({ records: 'nope' }).error).toBe('records must be an array');
  expect(validateBundle({ artifacts: [1] }).error).toBe('artifacts.0 must be an object');
});

test('KERN-008: invalid JSON reports an integrity failure rather than a parse error', () => {
  expect(() => parseBundle('{')).toThrowError(/not valid JSON/);
});
