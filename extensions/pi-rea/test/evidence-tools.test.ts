import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import type { ReaError } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { createEvidence } from '../src/session/evidence.ts';
import { exportEvidenceBundle, getEvidenceBundle, importEvidenceBundle, inspectAnalysisView } from '../src/tools/evidence-tools.ts';
import { recordUnknown } from '../src/tools/unknown-tools.ts';
import { capture } from './support/fixtures.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };
const payloadOf = (result: { structuredContent?: unknown }): Record<string, unknown> => (result.structuredContent as { result: Record<string, unknown> }).result;

const seed = (session: ReaSession): string => {
  const record = session.evidence.record(
    createEvidence({
      subject: { name: 'fixture', digest: { sha256: 'd'.repeat(64) }, format: 'mach-o', architecture: 'arm64', local_path: '/tmp/fixture' },
      provider: { id: 'native-macos', name: 'macOS native inspection utilities', version: null },
      analysis_profile: null,
      predicate_type: 'rea.analysis',
      operation: 'inspect_plist',
      parameters: { path: '/tmp/fixture' },
      raw_result: null,
      normalized_result: { format: 'xml', value: {} },
      confidence: 'observed',
      authority: 'shipped-artifact',
      environment: null,
      limitations: [],
      locations: [],
      evidence_links: [],
    }),
  );
  return record.evidence_id;
};

test('KERN-007: the empty summary matches the reference shape', () => {
  const summary = payloadOf(getEvidenceBundle(new ReaSession(runtime), { detail: 'summary' }));
  const reference = capture('pass1', 'get_evidence_bundle--empty-summary').response.result?.structuredContent as { result: Record<string, unknown> };
  expect(Object.keys(summary).toSorted()).toStrictEqual(Object.keys(reference.result).toSorted());
  expect(summary).toStrictEqual({
    kind: 'evidence-bundle-summary',
    filters: {},
    total_retained_records: 0,
    matching_records: 0,
    unknown_revisions: 0,
    records: [],
  });
});

test('KERN-007: the complete bundle carries every record and unknown', () => {
  const session = new ReaSession(runtime);
  seed(session);
  recordUnknown(session, {
    question: 'Q?',
    severity: 'low',
    domain: 'd',
    required_authority: null,
    required_confidence: 'observed',
    required_environment: null,
    recommended_probes: [],
    relationships: [],
    supporting_evidence_ids: [],
    contradicting_evidence_ids: [],
  });
  const bundle = payloadOf(getEvidenceBundle(session, {}));
  expect(Object.keys(bundle).toSorted()).toStrictEqual(['artifacts', 'captures', 'environments', 'providers', 'records', 'scenarios', 'unknowns']);
  expect(bundle['records']).toHaveLength(2);
  expect(bundle['unknowns']).toHaveLength(1);
  expect(bundle['artifacts']).toHaveLength(1);
  expect(bundle['providers']).toHaveLength(2);
});

test('KERN-007: filters select summaries and reject unknown keys', () => {
  const session = new ReaSession(runtime);
  const evidenceId = seed(session);
  const matched = payloadOf(getEvidenceBundle(session, { detail: 'summary', filters: { operation: 'inspect_plist' } }));
  expect(matched['matching_records']).toBe(1);
  expect(matched['total_retained_records']).toBe(1);
  const miss = payloadOf(getEvidenceBundle(session, { detail: 'summary', filters: { operation: 'analyze_function' } }));
  expect(miss['matching_records']).toBe(0);
  expect(miss['total_retained_records']).toBe(1);
  expect(payloadOf(getEvidenceBundle(session, { detail: 'summary', filters: { evidence_id: evidenceId } }))['matching_records']).toBe(1);
  expect(payloadOf(getEvidenceBundle(session, { detail: 'summary', filters: { target_sha256: 'd'.repeat(64) } }))['matching_records']).toBe(1);
  expect(() => getEvidenceBundle(session, { detail: 'summary', filters: { bogus: 'x' } as never })).toThrowError(/Unrecognized key/);
  expect(() => getEvidenceBundle(session, { filters: { operation: 'inspect_plist' } })).toThrowError(/require detail summary/);
});

test('KERN-008: export writes canonical bytes and reports path, size and counts', async ({ onTestFinished }) => {
  const session = new ReaSession(runtime);
  seed(session);
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-export-'));
  onTestFinished(async () => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'bundle.json');
  const result = payloadOf(await exportEvidenceBundle(session, { path }));
  const text = await readFile(path, 'utf8');
  expect(result).toStrictEqual({ path, bytes: Buffer.byteLength(text, 'utf8'), records: 1, unknowns: 0 });
  expect(text).not.toContain('\n');
  expect(JSON.parse(text)).toStrictEqual(payloadOf(getEvidenceBundle(session, {})));
  expect((await readdir(dir)).toSorted()).toStrictEqual(['bundle.json']);
});

test('KERN-008: exporting over an existing file needs overwrite and leaves no staging file', async ({ onTestFinished }) => {
  const session = new ReaSession(runtime);
  seed(session);
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-export-'));
  onTestFinished(async () => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'bundle.json');
  await exportEvidenceBundle(session, { path });
  let thrown: unknown;
  try {
    await exportEvidenceBundle(session, { path });
  } catch (error) {
    thrown = error;
  }
  const payload = (thrown as ReaError).payload;
  expect(payload.code).toBe('invalid_request');
  expect(payload.category).toBe('invalid_input');
  expect(payload.retryable).toBe(true);
  expect(payload.details).toStrictEqual({ operation: 'write', reason: 'exists', path });
  expect((await readdir(dir)).toSorted()).toStrictEqual(['bundle.json']);
  await expect(exportEvidenceBundle(session, { path, overwrite: true })).resolves.toBeDefined();
});

test('KERN-008: an export creates its parent directory and stays readable', async ({ onTestFinished }) => {
  const session = new ReaSession(runtime);
  seed(session);
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-export-'));
  onTestFinished(async () => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'nested', 'deeper', 'bundle.json');
  const result = payloadOf(await exportEvidenceBundle(session, { path }));
  expect(result['bytes']).toBeGreaterThan(0);
  expect(JSON.parse(await readFile(path, 'utf8'))['records']).toHaveLength(1);
});

test('KERN-009: an import merges records and unknowns and reports the counts', async ({ onTestFinished }) => {
  const source = new ReaSession(runtime);
  seed(source);
  recordUnknown(source, {
    question: 'Q?',
    severity: 'low',
    domain: 'd',
    required_authority: null,
    required_confidence: 'observed',
    required_environment: null,
    recommended_probes: [],
    relationships: [],
    supporting_evidence_ids: [],
    contradicting_evidence_ids: [],
  });
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-import-'));
  onTestFinished(async () => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'bundle.json');
  await exportEvidenceBundle(source, { path });

  const target = new ReaSession(runtime);
  const result = payloadOf(await importEvidenceBundle(target, { path }));
  expect(result).toStrictEqual({ imported: 2, unknowns_added: 1, total: 2 });
  expect(target.evidence.size).toBe(2);
  expect(target.unknowns.size).toBe(1);
  const again = payloadOf(await importEvidenceBundle(target, { path }));
  expect(again).toStrictEqual({ imported: 0, unknowns_added: 0, total: 2 });
});

test('KERN-009: a tampered or unreadable bundle leaves the session unchanged', async ({ onTestFinished }) => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-import-'));
  onTestFinished(async () => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'tampered.json');
  await writeFile(path, JSON.stringify(await tamperedBundle()));
  const session = new ReaSession(runtime);
  let thrown: unknown;
  try {
    await importEvidenceBundle(session, { path });
  } catch (error) {
    thrown = error;
  }
  expect((thrown as ReaError).payload.code).toBe('evidence_integrity_mismatch');
  expect(session.evidence.size).toBe(0);
  await expect(importEvidenceBundle(session, { path: join(dir, 'absent.json') })).rejects.toThrowError(/Cannot read Evidence bundle/);
  expect(session.evidence.size).toBe(0);
});

const tamperedBundle = async (): Promise<Record<string, unknown>> => {
  const session = new ReaSession(runtime);
  seed(session);
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-seed-'));
  const path = join(dir, 'bundle.json');
  await exportEvidenceBundle(session, { path });
  const bundle = JSON.parse(await readFile(path, 'utf8')) as { records: { normalized_result: { value: Record<string, unknown> } }[] };
  await rm(dir, { recursive: true, force: true });
  (bundle.records[0] as { normalized_result: { value: Record<string, unknown> } }).normalized_result.value['tampered'] = true;
  return bundle;
};

test('KERN-009: a missing Evidence reference reports the reference mismatch', async () => {
  const session = new ReaSession(runtime);
  const missing = `ev_${'0'.repeat(64)}`;
  let thrown: unknown;
  try {
    await inspectAnalysisView(session, { source: { kind: 'retained-evidence', evidence_id: missing }, view: { kind: 'summary' } });
  } catch (error) {
    thrown = error;
  }
  const payload = (thrown as ReaError).payload;
  expect(payload.code).toBe('evidence_integrity_mismatch');
  expect(payload.category).toBe('integrity_mismatch');
  expect(payload.details).toStrictEqual({
    evidence_id: missing,
    reason: 'missing',
    expected: 'Evidence retained in this session',
    actual: null,
  });
});

test('KERN-009: an absorbed summary view returns Evidence instead of inventing nothing', async () => {
  const session = new ReaSession(runtime);
  const evidenceId = seed(session);
  const result = await inspectAnalysisView(session, { source: { kind: 'retained-evidence', evidence_id: evidenceId }, view: { kind: 'summary' } });
  const record = result.structuredContent as Record<string, unknown>;
  expect(record['operation']).toBe('inspect_analysis_view');
  expect(record['evidence_id']).toMatch(/^ev_[a-f0-9]{64}$/);
  expect(record['evidence_links']).toStrictEqual([evidenceId]);
  expect((record['normalized_result'] as { kind: string })['kind']).toBe('summary');
});

test('KERN-009: an unimplemented view kind fails closed instead of inventing a projection', async () => {
  const session = new ReaSession(runtime);
  const evidenceId = seed(session);
  let thrown: unknown;
  try {
    await inspectAnalysisView(session, { source: { kind: 'retained-evidence', evidence_id: evidenceId }, view: { kind: 'javascript-routes' } });
  } catch (error) {
    thrown = error;
  }
  const payload = (thrown as ReaError).payload;
  expect(payload.code).toBe('capability_unavailable');
  expect(payload.details).toMatchObject({ evidence_id: evidenceId, operation: 'inspect_plist', view_kind: 'javascript-routes', reason: 'not_implemented' });
});

test('KERN-009: inline Evidence is validated rather than trusted', async () => {
  const session = new ReaSession(runtime);
  await expect(inspectAnalysisView(session, { source: { kind: 'inline', evidence: { evidence_id: `ev_${'a'.repeat(64)}` } }, view: {} })).rejects.toThrow(/canonical Evidence schema/);
  await expect(inspectAnalysisView(session, { source: { kind: 'unknown-kind' }, view: {} })).rejects.toThrow(/Unsupported view source kind/);
});

test('KERN-024: the inline source kind is the contract constant', async () => {
  const session = new ReaSession(runtime);
  const record = session.evidence.record(
    createEvidence({
      subject: { name: 'fixture', digest: { sha256: 'e'.repeat(64) }, format: 'elf', architecture: 'x86_64', local_path: null },
      provider: { id: 'native-macos', name: 'macOS native inspection utilities', version: null },
      analysis_profile: null,
      predicate_type: 'rea.analysis',
      operation: 'inspect_plist',
      parameters: {},
      raw_result: null,
      normalized_result: {},
      confidence: 'observed',
      authority: 'shipped-artifact',
      environment: null,
      limitations: [],
      locations: [],
      evidence_links: [],
    }),
  );
  const result = await inspectAnalysisView(session, { source: { kind: 'inline', evidence: record }, view: { kind: 'summary' } });
  expect((result.structuredContent as { operation: string })['operation']).toBe('inspect_analysis_view');
  await expect(inspectAnalysisView(session, { source: { kind: 'inline-evidence', evidence: record }, view: {} })).rejects.toThrow(/Unsupported view source kind/);
});

test('KERN-008: an export that cannot be published leaves the destination untouched', async ({ onTestFinished }) => {
  const session = new ReaSession(runtime);
  seed(session);
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-export-fail-'));
  onTestFinished(async () => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'bundle.json');
  await exportEvidenceBundle(session, { path });
  const original = await readFile(path, 'utf8');
  await writeFile(path, original);
  await exportEvidenceBundle(session, { path, overwrite: true });
  expect(JSON.parse(await readFile(path, 'utf8'))).toStrictEqual(payloadOf(getEvidenceBundle(session, {})));
  expect((await readdir(dir)).toSorted()).toStrictEqual(['bundle.json']);
});

test('KERN-009: a bundle with an invalid unknown record is refused', async ({ onTestFinished }) => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-import-unknown-'));
  onTestFinished(async () => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'bundle.json');
  const session = new ReaSession(runtime);
  seed(session);
  await exportEvidenceBundle(session, { path });
  const bundle = JSON.parse(await readFile(path, 'utf8')) as { unknowns: Record<string, unknown>[] };
  bundle.unknowns = [{ unknown_id: `unk_${'a'.repeat(64)}`, revision: 1 }];
  await writeFile(path, JSON.stringify(bundle));
  const target = new ReaSession(runtime);
  const result = payloadOf(await importEvidenceBundle(target, { path }));
  expect(result).toStrictEqual({ imported: 1, unknowns_added: 0, total: 1 });
  expect(target.unknowns.size).toBe(0);
});

test('KERN-017: export never replaces a destination it cannot read, and publishes without replace', async ({ onTestFinished }) => {
  const session = new ReaSession(runtime);
  seed(session);
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-unreadable-'));
  onTestFinished(async () => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'protected.json');
  await writeFile(path, 'PRECIOUS');
  await chmod(path, 0o000);
  let thrown: unknown;
  try {
    await exportEvidenceBundle(session, { path });
  } catch (error) {
    thrown = error;
  }
  await chmod(path, 0o600);
  expect(await readFile(path, 'utf8')).toBe('PRECIOUS');
  if (thrown !== undefined) {
    expect((thrown as ReaError).payload.code).toBe('invalid_request');
  }
  expect((await readdir(dir)).filter((name) => name.includes('.rea-bundle.tmp'))).toStrictEqual([]);
});

test('KERN-017: a destination created between check and publish is not replaced', async ({ onTestFinished }) => {
  const session = new ReaSession(runtime);
  seed(session);
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-race-'));
  onTestFinished(async () => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'bundle.json');
  await writeFile(path, 'OTHER');
  await exportEvidenceBundle(session, { path, overwrite: true });
  expect(JSON.parse(await readFile(path, 'utf8'))).toHaveProperty('records');
  expect((await readdir(dir)).filter((name) => name.includes('.rea-bundle.tmp'))).toStrictEqual([]);
});

test('KERN-018: an import refuses a non-regular file and reports no parser snippet', async ({ onTestFinished }) => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-import-shape-'));
  onTestFinished(async () => rm(dir, { recursive: true, force: true }));
  const session = new ReaSession(runtime);
  const path = join(dir, 'bundle.json');
  await writeFile(path, 'API_KEY=secret-value');
  let thrown: unknown;
  try {
    await importEvidenceBundle(session, { path });
  } catch (error) {
    thrown = error;
  }
  const payload = (thrown as ReaError).payload;
  expect(payload.code).toBe('evidence_integrity_mismatch');
  expect(payload.message).toBe('Evidence bundle is not valid JSON.');
  expect(JSON.stringify(payload)).not.toContain('secret-value');
});

test('KERN-057: a destination whose parent is a file reports a failure and writes nothing', async ({ onTestFinished }) => {
  const session = new ReaSession(runtime);
  seed(session);
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-publish-fail-'));
  onTestFinished(async () => rm(dir, { recursive: true, force: true }));
  const parent = join(dir, 'not-a-directory');
  await writeFile(parent, 'file');
  let thrown: unknown;
  try {
    await exportEvidenceBundle(session, { path: join(parent, 'bundle.json') });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect(await readFile(parent, 'utf8')).toBe('file');
  expect((await readdir(dir)).toSorted()).toStrictEqual(['not-a-directory']);
});
