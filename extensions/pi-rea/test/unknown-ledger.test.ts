import { expect, test } from 'vitest';
import { ReaError } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import type { UnknownDraft } from '../src/session/unknown-ledger.ts';
import { listUnknowns, recordUnknown, updateUnknown } from '../src/tools/unknown-tools.ts';
import { capture } from './support/fixtures.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };

const draft = (overrides: Partial<UnknownDraft> = {}): UnknownDraft => ({
  question: 'Does the fixture binary embed its build settings?',
  severity: 'medium',
  domain: 'fixture-go-macho',
  required_authority: 'shipped-artifact',
  required_confidence: 'observed',
  required_environment: { id: null, platform: null, architecture: null, isolation: null },
  recommended_probes: [{ operation: 'inspect_macho', rationale: 'Read embedded build metadata from the shipped artifact.' }],
  relationships: [],
  supporting_evidence_ids: [],
  contradicting_evidence_ids: [],
  ...overrides,
});

const payloadOf = (result: { structuredContent?: unknown }): Record<string, unknown> => (result.structuredContent as { result: Record<string, unknown> }).result;

test('KERN-010: a recorded unknown carries the reference record fields', () => {
  const session = new ReaSession(runtime);
  const record = payloadOf(recordUnknown(session, draft()));
  const reference = capture('pass4', 'record_unknown--valid').response.result?.structuredContent as { result: Record<string, unknown> };
  expect(Object.keys(record).toSorted()).toStrictEqual(Object.keys(reference.result).toSorted());
  expect(record['question']).toBe(draft().question);
  expect(record['revision']).toBe(1);
  expect(record['previous_revision_digest']).toBeNull();
  expect(record['scope_digest']).toBeNull();
  expect(record['status']).toBe('open');
  expect(record['resolution']).toBeNull();
  expect(record['unknown_id']).toMatch(/^unk_[a-f0-9]{64}$/);
  expect(record['revision_digest']).toMatch(/^[a-f0-9]{64}$/);
});

test('KERN-010: recording an unknown records exactly one mutation Evidence', () => {
  const session = new ReaSession(runtime);
  const record = payloadOf(recordUnknown(session, draft()));
  const mutations = record['mutation_evidence_ids'] as string[];
  expect(mutations).toHaveLength(1);
  const evidence = session.evidence.get(mutations[0] as string);
  expect(evidence?.operation).toBe('record_unknown');
  expect(evidence?.provider.id).toBe('rea-unknown-registry');
  expect(session.evidence.size).toBe(1);
});

test('KERN-010: recording the same unknown twice is idempotent', () => {
  const session = new ReaSession(runtime);
  const first = payloadOf(recordUnknown(session, draft()));
  const second = payloadOf(recordUnknown(session, draft()));
  expect(second).toStrictEqual(first);
  expect(session.unknowns.revisionCount).toBe(1);
});

test('KERN-010: list_unknowns returns items and a total, filtered by domain', () => {
  const session = new ReaSession(runtime);
  recordUnknown(session, draft());
  recordUnknown(session, draft({ domain: 'other', question: 'A different question?' }));
  const all = payloadOf(listUnknowns(session, {}));
  expect(all['total']).toBe(2);
  expect(all['items']).toHaveLength(2);
  const filtered = payloadOf(listUnknowns(session, { domain: 'other' }));
  expect(filtered['total']).toBe(1);
  expect(payloadOf(listUnknowns(session, { status: 'resolved' }))['total']).toBe(0);
  expect(payloadOf(listUnknowns(session, { severity: 'critical' }))['total']).toBe(0);
});

test('KERN-010: an update advances the revision and links the previous digest', () => {
  const session = new ReaSession(runtime);
  const first = payloadOf(recordUnknown(session, draft()));
  const updated = payloadOf(
    updateUnknown(session, {
      unknown_id: first['unknown_id'] as string,
      expected_revision: 1,
      status: 'resolved',
      resolution: { disposition: 'out-of-scope', rationale: 'The build settings are not part of this question.', evidence_ids: [] },
    }),
  );
  expect(updated['revision']).toBe(2);
  expect(updated['previous_revision_digest']).toBe(first['revision_digest']);
  expect(updated['status']).toBe('resolved');
  expect(updated['mutation_evidence_ids']).toHaveLength(2);
  expect(session.evidence.size).toBe(2);
});

test('KERN-010: a stale revision is a conflict that names both revisions', () => {
  const session = new ReaSession(runtime);
  const first = payloadOf(recordUnknown(session, draft()));
  const unknownId = first['unknown_id'] as string;
  updateUnknown(session, { unknown_id: unknownId, expected_revision: 1, status: 'resolved', resolution: null });
  let thrown: unknown;
  try {
    updateUnknown(session, { unknown_id: unknownId, expected_revision: 1, status: 'open', resolution: null });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ReaError);
  const payload = (thrown as ReaError).payload;
  expect(payload.code).toBe('revision_conflict');
  expect(payload.details).toMatchObject({ unknown_id: unknownId, expected_revision: 1, actual_revision: 2 });
});

test('KERN-010: an unknown identifier that is not retained fails closed', () => {
  const session = new ReaSession(runtime);
  let thrown: unknown;
  try {
    updateUnknown(session, { unknown_id: `unk_${'0'.repeat(64)}`, expected_revision: 1, status: 'open', resolution: null });
  } catch (error) {
    thrown = error;
  }
  expect((thrown as ReaError).payload.code).toBe('invalid_request');
  expect((thrown as ReaError).payload.details).toMatchObject({ reason: 'missing' });
});

test('KERN-010: a dangling supporting Evidence reference is refused', () => {
  const session = new ReaSession(runtime);
  let thrown: unknown;
  try {
    recordUnknown(session, draft({ supporting_evidence_ids: [`ev_${'a'.repeat(64)}`] }));
  } catch (error) {
    thrown = error;
  }
  expect((thrown as ReaError).payload.code).toBe('invalid_request');
  expect((thrown as ReaError).payload.details).toMatchObject({ reason: 'missing' });
  expect(session.evidence.size).toBe(0);
});

test('KERN-010: malformed unknown input is refused before anything is recorded', () => {
  const session = new ReaSession(runtime);
  const invalid = [
    {},
    draft({ severity: 'urgent' as UnknownDraft['severity'] }),
    draft({ recommended_probes: [{ operation: 'x' } as never] }),
    draft({ relationships: [{ type: 'depends-on', unknown_id: 'not-an-id' } as never] }),
    draft({ supporting_evidence_ids: 'ev_x' as never }),
  ];
  for (const candidate of invalid) {
    expect(() => recordUnknown(session, candidate)).toThrowError();
  }
  expect(session.evidence.size).toBe(0);
  expect(session.unknowns.size).toBe(0);
});

test('KERN-010: imported unknowns keep their identifiers and revisions', () => {
  const session = new ReaSession(runtime);
  const reference = capture('pass5', 'get_evidence_bundle--mutation-evidence').response.result?.structuredContent as {
    result: { unknowns: Record<string, unknown>[] };
  };
  const added = session.unknowns.insertImported(reference.result.unknowns);
  expect(added).toBe(1);
  expect(session.unknowns.insertImported(reference.result.unknowns)).toBe(0);
  const [only] = session.unknowns.list();
  expect(only?.unknown_id).toBe(reference.result.unknowns[0]?.['unknown_id']);
  expect(only?.revision).toBe(1);
});

test('KERN-021: the optional Evidence arrays default to empty', () => {
  const session = new ReaSession(runtime);
  const minimal = { ...draft() } as Record<string, unknown>;
  delete minimal['supporting_evidence_ids'];
  delete minimal['contradicting_evidence_ids'];
  const record = payloadOf(recordUnknown(session, minimal));
  expect(record['supporting_evidence_ids']).toStrictEqual([]);
  expect(record['contradicting_evidence_ids']).toStrictEqual([]);
});

test('KERN-023: a refused update records no mutation Evidence', () => {
  const session = new ReaSession(runtime);
  const first = payloadOf(recordUnknown(session, draft()));
  const unknownId = first['unknown_id'] as string;
  expect(session.evidence.size).toBe(1);
  for (const expected of [2, 99]) {
    expect(() => updateUnknown(session, { unknown_id: unknownId, expected_revision: expected, status: 'resolved', resolution: null })).toThrowError();
  }
  expect(() => updateUnknown(session, { unknown_id: `unk_${'0'.repeat(64)}`, expected_revision: 1, status: 'resolved', resolution: null })).toThrowError();
  expect(session.evidence.size).toBe(1);
  expect(session.unknowns.revisionCount).toBe(1);
});

test('KERN-023: successive updates carry distinct mutation Evidence', () => {
  const session = new ReaSession(runtime);
  const first = payloadOf(recordUnknown(session, draft()));
  const unknownId = first['unknown_id'] as string;
  const second = payloadOf(updateUnknown(session, { unknown_id: unknownId, expected_revision: 1, status: 'investigating', resolution: null }));
  const third = payloadOf(updateUnknown(session, { unknown_id: unknownId, expected_revision: 2, status: 'resolved', resolution: { disposition: 'out-of-scope', rationale: 'Out of scope for this pass.', evidence_ids: [] } }));
  const ids = third['mutation_evidence_ids'] as string[];
  expect(ids).toHaveLength(3);
  expect(second['mutation_evidence_ids']).toHaveLength(2);
  expect(new Set(ids).size).toBe(3);
  expect(session.evidence.size).toBe(3);
  expect(session.evidence.list().map((record) => record.operation)).toStrictEqual(['record_unknown', 'update_unknown', 'update_unknown']);
  expect(session.evidence.get(ids[2] as string)?.parameters).toMatchObject({ unknown_id: unknownId, revision: 3, status: 'resolved' });
});

test('KERN-021: an unknown record that is not canonical is not imported', () => {
  const session = new ReaSession(runtime);
  const reference = capture('pass5', 'get_evidence_bundle--mutation-evidence').response.result?.structuredContent as {
    result: { unknowns: Record<string, unknown>[] };
  };
  const good = reference.result.unknowns[0] as Record<string, unknown>;
  expect(session.unknowns.insertImported([{ ...good, revision: 'nope' }])).toBe(0);
  expect(session.unknowns.insertImported([{ ...good, unknown_id: 'not-an-id' }])).toBe(0);
  expect(session.unknowns.insertImported([{ ...good, status: 'made-up' }])).toBe(0);
  expect(session.unknowns.insertImported([{ ...good, resolution: { status: 'resolved', summary: 'x' } }])).toBe(0);
  expect(session.unknowns.insertImported([good])).toBe(1);
});

test('KERN-051: a verified resolution requires retained Evidence and a rationale', () => {
  const session = new ReaSession(runtime);
  const first = payloadOf(recordUnknown(session, draft()));
  const unknownId = first['unknown_id'] as string;
  const missing = `ev_${'f'.repeat(64)}`;
  expect(() =>
    updateUnknown(session, {
      unknown_id: unknownId,
      expected_revision: 1,
      status: 'resolved',
      resolution: { disposition: 'verified', rationale: 'Verified against the fixture.', evidence_ids: [missing] },
    }),
  ).toThrowError(/not retained in this session/);
  expect(session.unknowns.revisionCount).toBe(1);
  expect(session.evidence.size).toBe(1);

  const own = session.evidence.list()[0]?.evidence_id as string;
  const updated = payloadOf(
    updateUnknown(session, {
      unknown_id: unknownId,
      expected_revision: 1,
      status: 'resolved',
      resolution: { disposition: 'verified', rationale: 'Verified against the fixture.', evidence_ids: [own] },
    }),
  );
  expect(updated['status']).toBe('resolved');
  expect((updated['resolution'] as { disposition: string }).disposition).toBe('verified');
});

test('KERN-051: an unknown update can carry new probes, relationships and references', () => {
  const session = new ReaSession(runtime);
  const first = payloadOf(recordUnknown(session, draft()));
  const evidenceId = session.evidence.list()[0]?.evidence_id as string;
  const updated = payloadOf(
    updateUnknown(session, {
      unknown_id: first['unknown_id'] as string,
      expected_revision: 1,
      status: 'investigating',
      resolution: null,
      severity: 'high',
      recommended_probes: [{ operation: 'inspect_binary_layout', rationale: 'Read the symbol table.' }],
      supporting_evidence_ids: [evidenceId],
      required_authority: 'controlled-replay',
      required_confidence: 'derived',
    }),
  );
  expect(updated['severity']).toBe('high');
  expect(updated['supporting_evidence_ids']).toStrictEqual([evidenceId]);
  expect(updated['required_authority']).toBe('controlled-replay');
  expect(updated['required_confidence']).toBe('derived');
});

test('KERN-021: unknown input outside the contract vocabulary is refused', () => {
  const session = new ReaSession(runtime);
  const invalid: [string, Record<string, unknown>][] = [
    ['authority', { ...draft(), required_authority: 'made-up' }],
    ['confidence', { ...draft(), required_confidence: 'guessed' }],
    ['environment', { ...draft(), required_environment: { id: null, platform: null, architecture: null, isolation: 'orbit' } }],
    ['environment shape', { ...draft(), required_environment: { id: null } }],
    ['probes', { ...draft(), recommended_probes: 'none' }],
    ['relationships', { ...draft(), relationships: 'none' }],
    ['relationship type', { ...draft(), relationships: [{ type: 'supports', unknown_id: `unk_${'a'.repeat(64)}` }] }],
    ['question', { ...draft(), question: 42 }],
    ['domain', { ...draft(), domain: '' }],
    ['not an object', 'nope' as never],
  ];
  for (const [label, candidate] of invalid) {
    expect(() => recordUnknown(session, candidate), label).toThrowError();
  }
  expect(session.evidence.size).toBe(0);
  expect(session.unknowns.size).toBe(0);
});

test('KERN-010: filters narrow by severity and status', () => {
  const session = new ReaSession(runtime);
  recordUnknown(session, draft({ severity: 'high' }));
  const low = payloadOf(recordUnknown(session, draft({ severity: 'low', question: 'Another question?' })));
  const unknownId = low['unknown_id'] as string;
  const updated = payloadOf(updateUnknown(session, { unknown_id: unknownId, expected_revision: 1, status: 'blocked', resolution: null }));
  expect(updated['status']).toBe('blocked');
  expect(payloadOf(listUnknowns(session, { severity: 'high' }))['total']).toBe(1);
  expect(payloadOf(listUnknowns(session, { severity: 'low' }))['total']).toBe(1);
  expect(payloadOf(listUnknowns(session, { status: 'blocked' }))['total']).toBe(1);
  expect(payloadOf(listUnknowns(session, { status: 'open' }))['total']).toBe(1);
  expect(payloadOf(listUnknowns(session, { domain: 'absent' }))['total']).toBe(0);
});

test('KERN-061: an unknown whose result cannot fit is retained and answered with a truncation marker', () => {
  const session = new ReaSession(runtime);
  const huge = { ...draft(), question: 'x'.repeat(10_485_760) };
  const result = recordUnknown(session, huge);
  const marker = (result.structuredContent as { result: Record<string, unknown> }).result;
  expect(marker['truncated']).toBe(true);
  expect(String(marker['guidance'])).toContain('REA_MCP_MAX_RESPONSE_BYTES');
  expect(session.evidence.size).toBe(1);
  expect(session.unknowns.size).toBe(1);
  expect(payloadOf(recordUnknown(session, draft()))['revision']).toBe(1);
});
