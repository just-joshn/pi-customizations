import { join } from 'node:path';

import { expect, test } from 'vitest';
import { digestOf } from '../src/analysis/canonical.mjs';
import { compareApplicationVersions } from '../src/analysis/compare-application-versions.ts';
import { compareArtifactInventories } from '../src/analysis/compare-artifacts.ts';
import { compareEvidenceBundles } from '../src/analysis/compare-bundles.ts';
import { compareJavascriptExportShapes, EXPORT_SHAPE_RESULT_LIMITATIONS } from '../src/analysis/compare-javascript-export-shapes.ts';
import { compareSourceToBundle } from '../src/analysis/compare-source-to-bundle.ts';
import type { ReaError } from '../src/contract/errors.ts';
import { createEvidence, type EvidenceDraft } from '../src/session/evidence.ts';
import { fixturePath } from './support/fixtures.ts';
import { tempTargets } from './support/temp-targets.ts';

const sha = (character: string): string => character.repeat(64);

const payloadOf = async (run: () => unknown): Promise<ReaError['payload']> => {
  try {
    await run();
  } catch (error) {
    return (error as ReaError).payload;
  }
  throw new Error('the analyzer returned instead of throwing');
};

const recordDraft = (overrides: Partial<EvidenceDraft> = {}): EvidenceDraft => ({
  subject: { name: 'fixture', digest: { sha256: sha('b') }, format: 'mach-o', architecture: 'arm64', local_path: null },
  provider: { id: 'fixture', name: 'Fixture provider', version: null },
  analysis_profile: null,
  predicate_type: 'rea.analysis',
  operation: 'inspect_macho',
  parameters: { path: '/tmp/fixture' },
  raw_result: null,
  normalized_result: { architecture: 'arm64' },
  confidence: 'observed',
  authority: 'shipped-artifact',
  environment: null,
  limitations: [],
  locations: [],
  evidence_links: [],
  ...overrides,
});

const emptyBundlePath = (side: 'left' | 'right'): string => fixturePath(`targets/bundles/empty-${side}.json`);

test('reports two empty evidence bundles as unchanged', async () => {
  const { inspection, parameters } = await compareEvidenceBundles(emptyBundlePath('left'), emptyBundlePath('right'));

  expect(inspection.status).toBe('unchanged');
  expect(inspection.summary).toStrictEqual({
    records_unchanged: 0,
    records_added: 0,
    records_removed: 0,
    records_changed: 0,
    unknowns_unchanged: 0,
    unknowns_added: 0,
    unknowns_removed: 0,
    unknowns_advanced: 0,
    unknowns_diverged: 0,
    unresolved: 0,
  });
  expect(inspection.changes).toStrictEqual([]);
  expect(inspection.left_bundle_sha256).toBe(inspection.right_bundle_sha256);
  expect(inspection.limitations).toStrictEqual([]);
  expect(parameters.left_bundle_sha256).toBe(inspection.left_bundle_sha256);
  expect(parameters.record_pairs).toStrictEqual([]);
});

test('summarizes added records with diverged unknowns', async () => {
  const targets = await tempTargets();
  const shared = createEvidence(recordDraft());
  const removed = createEvidence(recordDraft({ operation: 'inspect_plist' }));
  const added = createEvidence(recordDraft({ operation: 'inspect_pe_resources' }));
  const leftPath = await targets.write(
    'left.json',
    JSON.stringify({
      records: [shared, removed],
      unknowns: [{ unknown_id: 'a', status: 'open' }, { unknown_id: 'b', status: 'open' }, { unknown_id: 'c', status: 'open' }, { question: 'no identifier' }],
    }),
  );
  const rightPath = await targets.write(
    'right.json',
    JSON.stringify({
      records: [shared, added],
      unknowns: [
        { unknown_id: 'a', status: 'resolved' },
        { unknown_id: 'b', status: 'open' },
        { unknown_id: 'd', status: 'open' },
      ],
    }),
  );

  const { inspection } = await compareEvidenceBundles(leftPath, rightPath);

  expect(inspection.status).toBe('changed');
  expect(inspection.summary).toStrictEqual({
    records_unchanged: 1,
    records_added: 1,
    records_removed: 1,
    records_changed: 0,
    unknowns_unchanged: 1,
    unknowns_added: 1,
    unknowns_removed: 1,
    unknowns_advanced: 0,
    unknowns_diverged: 1,
    unresolved: 0,
  });
  const recordChanges = [
    { kind: 'record-added' as const, id: added.evidence_id },
    { kind: 'record-removed' as const, id: removed.evidence_id },
  ].sort((left, right) => (left.id < right.id ? -1 : 1));
  expect(inspection.changes).toStrictEqual([...recordChanges, { kind: 'unknown-changed', id: 'a' }, { kind: 'unknown-removed', id: 'c' }, { kind: 'unknown-added', id: 'd' }]);
});

test('pairs unknowns recorded under a legacy id field', async () => {
  const targets = await tempTargets();
  const leftPath = await targets.write('left.json', JSON.stringify({ unknowns: [{ id: 'legacy', status: 'open' }] }));
  const rightPath = await targets.write('right.json', JSON.stringify({ unknowns: [{ id: 'legacy', status: 'open' }] }));

  const { inspection } = await compareEvidenceBundles(leftPath, rightPath);

  expect(inspection.status).toBe('unchanged');
  expect(inspection.summary.unknowns_unchanged).toBe(1);
  expect(inspection.changes).toStrictEqual([]);
});

test('echoes supplied record pairs in the comparison parameters', async () => {
  const pairs = [{ left_evidence_id: 'ev_left', right_evidence_id: 'ev_right' }];

  const explicit = await compareEvidenceBundles(emptyBundlePath('left'), emptyBundlePath('right'), pairs);
  const omitted = await compareEvidenceBundles(emptyBundlePath('left'), emptyBundlePath('right'), null);

  expect(explicit.parameters.record_pairs).toStrictEqual(pairs);
  expect(omitted.parameters.record_pairs).toStrictEqual([]);
  expect(explicit.inspection.status).toBe('unchanged');
});

test.for([
  { label: 'a relative path', value: 'relative/left.json' },
  { label: 'an empty path', value: '' },
  { label: 'a numeric path', value: 7 },
])('rejects $label for a bundle', async ({ value }) => {
  const payload = await payloadOf(() => compareEvidenceBundles(value, emptyBundlePath('right')));

  expect(payload).toStrictEqual({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'left_bundle_path: must be an absolute local filesystem path',
    retryable: true,
    remediation: { action: 'left_bundle_path: must be an absolute local filesystem path' },
    details: {
      operation: 'compare_bundles',
      issues: [{ path: [], reason: 'invalid_value', message: 'left_bundle_path: must be an absolute local filesystem path' }],
    },
  });
});

test('rejects a relative right bundle path', async () => {
  const payload = await payloadOf(() => compareEvidenceBundles(emptyBundlePath('left'), 'relative/right.json'));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    message: 'right_bundle_path: must be an absolute local filesystem path',
    details: { operation: 'compare_bundles', issues: [{ path: [], reason: 'invalid_value' }] },
  });
});

test('rejects non-array record pairs', async () => {
  const payload = await payloadOf(() => compareEvidenceBundles(emptyBundlePath('left'), emptyBundlePath('right'), {}));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    message: 'record_pairs must be an array when supplied.',
    details: { operation: 'compare_bundles', parameter: 'record_pairs' },
  });
});

test('reports an unreadable bundle path as an integrity mismatch', async () => {
  const targets = await tempTargets();
  const missing = join(targets.dir, 'missing.json');

  const payload = await payloadOf(() => compareEvidenceBundles(missing, emptyBundlePath('right')));

  expect(payload).toMatchObject({
    code: 'evidence_integrity_mismatch',
    category: 'integrity_mismatch',
    message: expect.stringContaining(`Evidence bundle could not be read at ${missing}`),
    details: { reason: 'Evidence bundle validation failed', path: missing },
  });
});

test('reports a bundle that is not JSON as an integrity mismatch', async () => {
  const targets = await tempTargets();
  const path = await targets.write('left.json', 'not json');

  const payload = await payloadOf(() => compareEvidenceBundles(path, emptyBundlePath('right')));

  expect(payload).toStrictEqual({
    code: 'evidence_integrity_mismatch',
    category: 'integrity_mismatch',
    message: 'Evidence bundle is not valid JSON.',
    retryable: false,
    remediation: { action: 'Evidence bundle is not valid JSON.' },
    details: { reason: 'Evidence bundle validation failed' },
  });
});

test('reports a non-canonical record as a schema mismatch', async () => {
  const targets = await tempTargets();
  const path = await targets.write('left.json', JSON.stringify({ records: [{ evidence_id: 'ev_bad' }] }));

  const payload = await payloadOf(() => compareEvidenceBundles(path, emptyBundlePath('right')));

  expect(payload).toMatchObject({
    code: 'evidence_integrity_mismatch',
    message: expect.stringContaining('records.0: not a canonical Evidence record'),
    details: { reason: 'Evidence bundle validation failed' },
  });
});

interface ArtifactEvidenceOptions {
  readonly root?: string;
  readonly occurrences?: readonly Record<string, unknown>[];
  readonly truncated?: boolean;
  readonly limitations?: readonly string[];
}

const collectionsEvidence = (evidenceId: string, options: ArtifactEvidenceOptions = {}): Record<string, unknown> => ({
  evidence_id: evidenceId,
  operation: 'inspect_artifact',
  normalized_result: {
    root_artifact_sha256: options.root ?? sha('a'),
    collections: { occurrences: options.occurrences ?? [] },
    coverage: { truncated: options.truncated === true },
    limitations: options.limitations ?? [],
  },
});

const occurrence = (logicalPath: string, digest: string | null, isDirectory = false): Record<string, unknown> => ({
  logical_path: logicalPath,
  calculated_sha256: digest,
  is_directory: isDirectory,
});

test('classifies artifact file additions removals changes', () => {
  const left = collectionsEvidence(`ev_${'a'.repeat(64)}`, {
    occurrences: [occurrence('a.js', sha('1')), occurrence('b.js', sha('2')), occurrence('gone.js', sha('3')), occurrence('dir', null, true)],
  });
  const right = collectionsEvidence(`ev_${'b'.repeat(64)}`, {
    occurrences: [occurrence('a.js', sha('1')), occurrence('b.js', sha('9')), occurrence('new.js', sha('4')), occurrence('dir', null, true)],
  });

  const result = compareArtifactInventories(left, right);

  expect(result.status).toBe('changed');
  expect(result.left_manifest_id).toBe(`agm_${sha('a')}`);
  expect(result.right_manifest_id).toBe(`agm_${sha('a')}`);
  expect(result.summary).toStrictEqual({ unchanged: 2, added: 1, removed: 1, changed: 1, unknown: 0, contradiction: 0 });
  expect(result.changes).toStrictEqual([
    { logical_path: 'b.js', kind: 'changed', left_sha256: sha('2'), right_sha256: sha('9') },
    { logical_path: 'gone.js', kind: 'removed', left_sha256: sha('3'), right_sha256: null },
    { logical_path: 'new.js', kind: 'added', left_sha256: null, right_sha256: sha('4') },
  ]);
  expect(result.integrity_mismatch_evidence_ids).toStrictEqual([]);
  expect(result.limitations).toStrictEqual([]);
});

test('keeps matching inventories unchanged without a root digest', () => {
  const left = {
    evidence_id: `ev_${'a'.repeat(64)}`,
    operation: 'inspect_artifact',
    normalized_result: { collections: { occurrences: [{ logical_path: 'a.js', calculated_sha256: sha('1') }, { calculated_sha256: sha('2') }] }, limitations: 'not an array' },
  };
  const right = structuredClone(left);

  const result = compareArtifactInventories(left, right);

  expect(result.status).toBe('unchanged');
  expect(result.left_manifest_id).toBeNull();
  expect(result.right_manifest_id).toBeNull();
  expect(result.summary).toStrictEqual({ unchanged: 2, added: 0, removed: 0, changed: 0, unknown: 0, contradiction: 0 });
  expect(result.changes).toStrictEqual([]);
  expect(result.limitations).toStrictEqual([]);
});

test('counts truncated coverage as an unknown file comparison', () => {
  const left = collectionsEvidence(`ev_${'a'.repeat(64)}`, { occurrences: [occurrence('a.js', sha('1'))], truncated: true, limitations: ['bounded search'] });
  const right = collectionsEvidence(`ev_${'b'.repeat(64)}`, { occurrences: [occurrence('a.js', sha('1'))] });

  const result = compareArtifactInventories(left, right);

  expect(result.status).toBe('unknown');
  expect(result.summary).toStrictEqual({ unchanged: 2, added: 0, removed: 0, changed: 0, unknown: 1, contradiction: 0 });
  expect(result.changes).toStrictEqual([]);
  expect(result.limitations).toStrictEqual(['Left: bounded search']);
});

test('counts differing manifest identifiers as a change', () => {
  const result = compareArtifactInventories(collectionsEvidence(`ev_${'a'.repeat(64)}`, { root: sha('a') }), collectionsEvidence(`ev_${'b'.repeat(64)}`, { root: sha('c') }));

  expect(result.status).toBe('changed');
  expect(result.summary).toStrictEqual({ unchanged: 0, added: 0, removed: 0, changed: 1, unknown: 0, contradiction: 0 });
  expect(result.left_manifest_id).toBe(`agm_${sha('a')}`);
  expect(result.right_manifest_id).toBe(`agm_${sha('c')}`);
  expect(result.changes).toStrictEqual([{ logical_path: '.', kind: 'changed', left_sha256: sha('a'), right_sha256: sha('c') }]);
});

test('reports a file without a digest as an unknown change', () => {
  const left = collectionsEvidence(`ev_${'a'.repeat(64)}`, { occurrences: [{ logical_path: 'x.js' }] });
  const right = collectionsEvidence(`ev_${'b'.repeat(64)}`, { occurrences: [occurrence('x.js', sha('1'))] });

  const result = compareArtifactInventories(left, right);

  expect(result.status).toBe('unknown');
  expect(result.summary).toStrictEqual({ unchanged: 1, added: 0, removed: 0, changed: 0, unknown: 1, contradiction: 0 });
  expect(result.changes).toStrictEqual([{ logical_path: 'x.js', kind: 'unknown', left_sha256: null, right_sha256: sha('1') }]);
});

test('projects occurrences nodes into an inventory', () => {
  const left: Record<string, unknown> = {
    evidence_id: `ev_${'c'.repeat(64)}`,
    operation: 'inventory_artifact',
    normalized_result: {
      subject: { manifest_id: 'sub_manifest' },
      occurrences: [
        { logical_path: '.', entry_kind: 'directory', artifact_id: 'art_root' },
        { logical_path: 'lib/x.js', artifact_id: 'art_x', entry_kind: 'file' },
        { logical_path: 'direct.js', sha256: sha('d'), entry_kind: 'file' },
        { logical_path: 'calc.js', calculated_sha256: sha('e') },
        { logical_path: 'dir', entry_kind: 'directory' },
      ],
      nodes: [{ artifact_id: 'art_x', sha256: sha('f') }],
      coverage: { status: 'partial' },
      limitations: ['projected note'],
    },
  };
  const right: Record<string, unknown> = {
    evidence_id: `ev_${'d'.repeat(64)}`,
    operation: 'inventory_artifact',
    normalized_result: {
      subject: { manifest_id: 'sub_manifest' },
      occurrences: [
        { logical_path: 'lib/x.js', artifact_id: 'art_x', entry_kind: 'file' },
        { logical_path: 'direct.js', sha256: sha('d'), entry_kind: 'file' },
        { logical_path: 'calc.js', calculated_sha256: sha('e') },
      ],
      nodes: [{ artifact_id: 'art_x', sha256: sha('f') }],
    },
  };

  const result = compareArtifactInventories(left, right);

  expect(result.left_manifest_id).toBe('sub_manifest');
  expect(result.right_manifest_id).toBe('sub_manifest');
  expect(result.status).toBe('unknown');
  expect(result.summary).toStrictEqual({ unchanged: 4, added: 0, removed: 0, changed: 0, unknown: 1, contradiction: 0 });
  expect(result.changes).toStrictEqual([]);
  expect(result.limitations).toStrictEqual(['Left: projected note']);
});

test('reads a nested substep with outer limitation fallback', () => {
  const left: Record<string, unknown> = {
    evidence_id: `ev_${'e'.repeat(64)}`,
    operation: 'inventory_artifact',
    normalized_result: {
      substeps: [
        {
          operation: 'inventory_artifact',
          evidence: { normalized_result: { manifest: { manifest_id: 'nested_m' }, occurrences: [{ logical_path: 'a.js', sha256: sha('2') }] } },
        },
      ],
      limitations: ['outer note'],
    },
  };
  const right = collectionsEvidence(`ev_${'f'.repeat(64)}`, { occurrences: [occurrence('a.js', sha('2'))] });

  const result = compareArtifactInventories(left, right);

  expect(result.left_manifest_id).toBe('nested_m');
  expect(result.right_manifest_id).toBe(`agm_${sha('a')}`);
  expect(result.status).toBe('changed');
  expect(result.summary).toStrictEqual({ unchanged: 1, added: 0, removed: 0, changed: 1, unknown: 0, contradiction: 0 });
  expect(result.limitations).toStrictEqual(['Left: outer note']);
  expect(result.changes).toStrictEqual([{ logical_path: '.', kind: 'changed', left_sha256: null, right_sha256: sha('a') }]);
});

test.for([
  { label: 'left is null', left: null, message: 'compare_artifacts left must be an Evidence object.', details: { parameter: 'left' } },
  { label: 'left is an array', left: [], message: 'compare_artifacts left must be an Evidence object.', details: { parameter: 'left' } },
  {
    label: 'left lacks an evidence identifier',
    left: { evidence_id: 'not-evidence' },
    message: 'compare_artifacts left must carry an evidence_id.',
    details: { parameter: 'left' },
  },
  {
    label: 'left is not inspection evidence',
    left: { evidence_id: 'ev_probe', operation: 'inspect_macho', normalized_result: {} },
    message: 'compare_artifacts left must be inspect_artifact Evidence.',
    details: { parameter: 'left', observed_operation: 'inspect_macho' },
  },
  {
    label: 'left has no inventory',
    left: { evidence_id: 'ev_probe', operation: 'inventory_artifact', normalized_result: null },
    message: 'compare_artifacts left has no normalized_result inventory.',
    details: { parameter: 'left' },
  },
])('rejects artifact evidence when $label', async ({ left, message, details }) => {
  const payload = await payloadOf(() => compareArtifactInventories(left, collectionsEvidence(`ev_${'a'.repeat(64)}`)));

  expect(payload).toMatchObject({ code: 'invalid_request', category: 'invalid_input', message, details: { operation: 'compare_artifacts', ...details } });
});

test('rejects artifact evidence when right is null', async () => {
  const payload = await payloadOf(() => compareArtifactInventories(collectionsEvidence(`ev_${'a'.repeat(64)}`), null));

  expect(payload).toMatchObject({ code: 'invalid_request', message: 'compare_artifacts right must be an Evidence object.', details: { operation: 'compare_artifacts', parameter: 'right' } });
});

interface ExportShapeField {
  readonly path: string;
  readonly presence: string;
  readonly state: string;
  readonly value: unknown;
}

const field = (path: string, value: unknown, state = 'literal', presence = 'present'): ExportShapeField => ({ path, presence, state, value });

const shape = (fields: readonly ExportShapeField[], sourceRange: unknown = { start: 1, end: 2 }, propertyCoverage: readonly Record<string, unknown>[] = []): Record<string, unknown> => ({
  source_range: sourceRange,
  fields,
  property_coverage: propertyCoverage,
});

const exportNode = (nodeId: string, modulePath: string, exportName: string, shapes: readonly Record<string, unknown>[]): Record<string, unknown> => ({
  node_id: nodeId,
  observations: [{ properties: { semantic_role: 'export-binding', module_path: modulePath, exported_name: exportName } }, { properties: { semantic_role: 'export-return-shapes', static_return_shapes: shapes } }],
});

const exportEvidence = (evidenceId: string, nodes: readonly Record<string, unknown>[], graph: Record<string, unknown> = {}): Record<string, unknown> => ({
  evidence_id: evidenceId,
  operation: 'analyze_javascript_application',
  normalized_result: { graph: { nodes, ...graph } },
});

const leftExportEvidence = exportEvidence(`ev_${'a'.repeat(64)}`, []);
const rightExportEvidence = exportEvidence(`ev_${'b'.repeat(64)}`, []);

const exportParams = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  left: leftExportEvidence,
  right: rightExportEvidence,
  left_module_path: 'src/handler.js',
  left_export_name: 'handler',
  right_module_path: 'src/handler.js',
  right_export_name: 'handler',
  ...overrides,
});

test('pairs variants by discriminant to report field changes', () => {
  const left = exportEvidence(`ev_${'a'.repeat(64)}`, [exportNode('left_node', 'src/handler.js', 'handler', [shape([field('kind', 'ok'), field('count', 1), field('extra', true)])])]);
  const right = exportEvidence(`ev_${'b'.repeat(64)}`, [exportNode('right_node', 'src/handler.js', 'handler', [shape([field('kind', 'ok'), field('count', 2), field('next', 'x')])])]);

  const result = compareJavascriptExportShapes({
    left,
    right,
    left_module_path: 'src/handler.js',
    left_export_name: 'handler',
    right_module_path: 'src/handler.js',
    right_export_name: 'handler',
  });

  expect(result.left).toStrictEqual({
    evidence_id: left['evidence_id'],
    graph_id: `jag_${digestOf(String(left['evidence_id']))}`,
    requested_module_path: 'src/handler.js',
    requested_export_name: 'handler',
    candidates: [{ node_id: 'left_node', module_path: 'src/handler.js', export_name: 'handler', matches_requested_module: true, matches_requested_export: true }],
    omitted_candidates: 0,
    status: 'selected',
    selected_node_id: 'left_node',
  });
  expect(result.summary).toStrictEqual({ added: 1, removed: 1, changed: 1, unknown: 0 });
  expect(result.changes).toHaveLength(3);
  expect(result.changes[0]).toMatchObject({
    status: 'changed',
    path: 'count',
    discriminant: { path: 'kind', value: 'ok' },
    presence: { left: 'present', right: 'present' },
    left: { availability: 'literal', value: 1 },
    right: { availability: 'literal', value: 2 },
  });
  expect(result.changes[1]).toMatchObject({ status: 'removed', path: 'extra', presence: { left: 'present', right: 'absent' }, left: { availability: 'literal', value: true }, right: { availability: 'absent' } });
  expect(result.changes[2]).toMatchObject({ status: 'added', path: 'next', presence: { left: 'absent', right: 'present' }, left: { availability: 'absent' }, right: { availability: 'literal', value: 'x' } });
  expect(result.changes.map((change) => change.change_id)).toStrictEqual([expect.stringMatching(/^jesc_change_[a-f0-9]{64}$/), expect.stringMatching(/^jesc_change_[a-f0-9]{64}$/), expect.stringMatching(/^jesc_change_[a-f0-9]{64}$/)]);
  expect(result.property_inventories).toStrictEqual([
    { side: 'left', variant_index: 0, discriminant: { path: 'kind', value: 'ok' }, paired: true, source_range: { start: 1, end: 2 }, properties: ['count', 'extra', 'kind'], property_coverage: [] },
    { side: 'right', variant_index: 0, discriminant: { path: 'kind', value: 'ok' }, paired: true, source_range: { start: 1, end: 2 }, properties: ['count', 'kind', 'next'], property_coverage: [] },
  ]);
  expect(result.coverage).toMatchObject({ status: 'complete-within-inputs', paired_variants: 1, unpaired_left_variants: 0, unpaired_right_variants: 0, omitted_candidates: 0 });
  expect(result.limitations).toStrictEqual([...EXPORT_SHAPE_RESULT_LIMITATIONS]);
  expect(result.evidence_links).toStrictEqual([left['evidence_id'], right['evidence_id']]);
  expect(result.comparison_id).toMatch(/^jesc_[a-f0-9]{64}$/);
});

test('reports a non-literal field change as unknown', () => {
  const left = exportEvidence(`ev_${'a'.repeat(64)}`, [exportNode('left_node', 'src/handler.js', 'handler', [shape([field('kind', 'ok'), field('payload', { expr: 'x' }, 'dynamic')])])]);
  const right = exportEvidence(`ev_${'b'.repeat(64)}`, [exportNode('right_node', 'src/handler.js', 'handler', [shape([field('kind', 'ok'), field('payload', 'b')])])]);

  const result = compareJavascriptExportShapes(exportParams({ left, right }) as Parameters<typeof compareJavascriptExportShapes>[0]);

  expect(result.summary).toStrictEqual({ added: 0, removed: 0, changed: 0, unknown: 1 });
  expect(result.changes[0]).toMatchObject({ status: 'unknown', path: 'payload', left: { availability: 'dynamic', value: { expr: 'x' } }, right: { availability: 'literal', value: 'b' } });
});

test('reports ambiguous or missing export selections', () => {
  const left = exportEvidence(`ev_${'a'.repeat(64)}`, [exportNode('first_node', 'src/handler.js', 'handler', []), exportNode('second_node', 'src/handler.js', 'handler', [])]);
  const right = exportEvidence(`ev_${'b'.repeat(64)}`, [exportNode('other_node', 'src/other.js', 'handler', [])]);

  const result = compareJavascriptExportShapes(exportParams({ left, right }) as Parameters<typeof compareJavascriptExportShapes>[0]);

  expect(result.left.status).toBe('ambiguous');
  expect('selected_node_id' in result.left).toBe(false);
  expect(result.left.candidates).toStrictEqual([
    { node_id: 'first_node', module_path: 'src/handler.js', export_name: 'handler', matches_requested_module: true, matches_requested_export: true },
    { node_id: 'second_node', module_path: 'src/handler.js', export_name: 'handler', matches_requested_module: true, matches_requested_export: true },
  ]);
  expect(result.right.status).toBe('not_found');
  expect(result.right.candidates).toStrictEqual([{ node_id: 'other_node', module_path: 'src/other.js', export_name: 'handler', matches_requested_module: false, matches_requested_export: true }]);
  expect(result.summary).toStrictEqual({ added: 0, removed: 0, changed: 0, unknown: 1 });
  expect(result.property_inventories).toStrictEqual([]);
});

test('inventories unpaired variants without an exclusive discriminant', () => {
  const left = exportEvidence(`ev_${'a'.repeat(64)}`, [exportNode('left_node', 'src/handler.js', 'handler', [shape([]), shape([field('a', 1)])])]);
  const right = exportEvidence(`ev_${'b'.repeat(64)}`, [exportNode('right_node', 'src/handler.js', 'handler', [shape([])])]);

  const result = compareJavascriptExportShapes(exportParams({ left, right }) as Parameters<typeof compareJavascriptExportShapes>[0]);

  expect(result.summary).toStrictEqual({ added: 0, removed: 0, changed: 0, unknown: 3 });
  expect(result.property_inventories).toStrictEqual([
    { side: 'left', variant_index: 0, discriminant: null, paired: false, source_range: { start: 1, end: 2 }, properties: [], property_coverage: [] },
    { side: 'left', variant_index: 1, discriminant: { path: 'a', value: 1 }, paired: false, source_range: { start: 1, end: 2 }, properties: ['a'], property_coverage: [] },
    { side: 'right', variant_index: 0, discriminant: null, paired: false, source_range: { start: 1, end: 2 }, properties: [], property_coverage: [] },
  ]);
  expect(result.coverage).toMatchObject({ paired_variants: 0, unpaired_left_variants: 2, unpaired_right_variants: 1 });
});

test('rejects unusable export evidence or empty requests', async () => {
  const cases = [
    { label: 'left is null', params: exportParams({ left: null }), message: 'compare_javascript_export_shapes left must be an Evidence object.', details: { parameter: 'left' } },
    {
      label: 'left lacks an evidence identifier',
      params: exportParams({ left: { operation: 'analyze_javascript_application' } }),
      message: 'compare_javascript_export_shapes left must carry an evidence_id.',
      details: { parameter: 'left' },
    },
    {
      label: 'left is not application evidence',
      params: exportParams({ left: { evidence_id: 'ev_probe', operation: 'inspect_macho' } }),
      message: 'compare_javascript_export_shapes left must be analyze_javascript_application Evidence.',
      details: { parameter: 'left', observed_operation: 'inspect_macho' },
    },
    {
      label: 'the evidence identifiers match',
      params: exportParams({ right: leftExportEvidence }),
      message: 'JavaScript export shape Evidence must be distinct',
      details: { parameter: 'right' },
    },
    {
      label: 'the graph is missing',
      params: exportParams({ left: { evidence_id: 'ev_probe', operation: 'analyze_javascript_application', normalized_result: null } }),
      message: 'compare_javascript_export_shapes Evidence has no application graph.',
      details: { evidence_id: 'ev_probe' },
    },
  ];

  for (const { params, message, details } of cases) {
    const payload = await payloadOf(() => compareJavascriptExportShapes(params as Parameters<typeof compareJavascriptExportShapes>[0]));
    expect(payload).toMatchObject({ code: 'invalid_request', message, details: { operation: 'compare_javascript_export_shapes', ...details } });
  }
});

test.for([{ parameter: 'left_module_path' }, { parameter: 'left_export_name' }, { parameter: 'right_module_path' }, { parameter: 'right_export_name' }])('rejects an empty $parameter', async ({ parameter }) => {
  const payload = await payloadOf(() => compareJavascriptExportShapes(exportParams({ [parameter]: '' }) as Parameters<typeof compareJavascriptExportShapes>[0]));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    message: `compare_javascript_export_shapes requires ${parameter}.`,
    details: { operation: 'compare_javascript_export_shapes', parameter },
  });
});

interface VersionGraphOptions {
  readonly edges?: readonly Record<string, unknown>[];
  readonly rootNodeIds?: readonly unknown[];
  readonly coverage?: Record<string, unknown>;
  readonly limitations?: readonly unknown[];
  readonly root?: string;
  readonly graphId?: string;
}

const versionNode = (nodeId: string, options: { kind?: string; identity?: Record<string, unknown>; observations?: readonly Record<string, unknown>[] } = {}): Record<string, unknown> => ({
  node_id: nodeId,
  kind: options.kind ?? 'artifact',
  identity: options.identity ?? {},
  observations: options.observations ?? [],
});

const versionEvidence = (evidenceId: string, nodes: readonly Record<string, unknown>[], options: VersionGraphOptions = {}): Record<string, unknown> => ({
  evidence_id: evidenceId,
  operation: 'analyze_javascript_application',
  normalized_result: {
    root_artifact_sha256: options.root ?? sha('f'),
    graph: {
      ...(options.graphId === undefined ? {} : { graph_id: options.graphId }),
      nodes,
      edges: options.edges ?? [],
      ...(options.rootNodeIds === undefined ? {} : { root_node_ids: options.rootNodeIds }),
      coverage: options.coverage ?? { status: 'complete' },
      limitations: options.limitations ?? [],
    },
  },
});

const RELATIONSHIP_LIMITATION = 'Relationship target identity remains unresolved; equal node kinds do not establish cross-version alignment.';
const SEMANTIC_KEY_LIMITATION = 'Semantic-key pairing is a deterministic inference and is never promoted to exact identity.';

test('indexes optional node fields defensively', () => {
  const left = versionEvidence(
    `ev_${'1'.repeat(64)}`,
    [
      versionNode('artifact_digest', { observations: [{ evidence: { artifact: { sha256: 'artifact-sha' } } }] }),
      versionNode('identity_artifact_digest', { identity: { artifact_sha256: 'identity-artifact-sha' } }),
      versionNode('object_key', { kind: 'javascript-asset', identity: { namespace: 'ns', key: { id: 1 } } }),
      versionNode('path_key', { kind: 'javascript-asset', observations: [{ properties: { path: 'maps/a.js', module_source_digest: 7 } }] }),
      { identity: { strategy: 7 } },
    ],
    { graphId: 'jag_left' },
  );
  const right = versionEvidence(`ev_${'2'.repeat(64)}`, [], { graphId: 'jag_right' });

  const result = compareApplicationVersions({ left, right });

  expect(result.summary).toStrictEqual({ unchanged: 0, added: 0, removed: 5, changed: 0, unknown: 0 });
  expect(result.items.map((item) => item.node_kind).toSorted()).toStrictEqual(['artifact', 'artifact', 'javascript-asset', 'javascript-asset', 'unknown']);
  expect(result.items.map((item) => item.left_node_id).toSorted()).toStrictEqual(['', 'artifact_digest', 'identity_artifact_digest', 'object_key', 'path_key']);
});

test('pairs nodes by content digest as unchanged', () => {
  const left = versionEvidence(`ev_${'1'.repeat(64)}`, [versionNode('left_node', { identity: { strategy: 'content-digest', sha256: sha('c') } })], { graphId: 'jag_left' });
  const right = versionEvidence(`ev_${'2'.repeat(64)}`, [versionNode('right_node', { identity: { strategy: 'content-digest', sha256: sha('c') } })], { graphId: 'jag_right' });

  const result = compareApplicationVersions({ left, right });

  expect(result.summary).toStrictEqual({ unchanged: 1, added: 0, removed: 0, changed: 0, unknown: 0 });
  expect(result.matching).toStrictEqual({
    exact_node_identity: 0,
    exact_content_digest: 1,
    exact_module_source_digest: 0,
    source_map_identity: 0,
    structural_fingerprint: 0,
    semantic_key: 0,
    ambiguous: 0,
    unmatched: 0,
  });
  expect(result.left).toStrictEqual({ evidence_id: left['evidence_id'], graph_id: 'jag_left', root_artifact_sha256: sha('f') });
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    node_kind: 'artifact',
    dimensions: [],
    limitations: [],
    status: 'unchanged',
    left_node_id: 'left_node',
    right_node_id: 'right_node',
    match: { status: 'matched', basis: 'exact-content-digest', confidence: 'exact', candidate_left_node_ids: [], candidate_right_node_ids: [] },
  });
  expect(result.items[0]?.item_id).toMatch(/^javc_item_[a-f0-9]{64}$/);
  expect(result.graph).toMatchObject({
    schema: 'JavaScriptApplicationGraph',
    root_node_ids: ['left_node'],
    edges: [],
    coverage: { status: 'complete', truncated: false, omitted_count: 0, limits: [] },
  });
  expect(result.coverage).toStrictEqual({ left_graph_status: 'complete', right_graph_status: 'complete', left_graph_omitted_count: 0, right_graph_omitted_count: 0, status: 'complete-within-inputs' });
  expect(result.limitations).toHaveLength(5);
  expect(result.evidence_links).toStrictEqual([left['evidence_id'], right['evidence_id']]);
  expect(result.comparison_id).toBe(`javc_${digestOf(`${String(left['evidence_id'])}:${String(right['evidence_id'])}`)}`);
});

test('pairs artifact-local keys into merged observations', () => {
  const left = versionEvidence(`ev_${'1'.repeat(64)}`, [versionNode('shared_node', { identity: { strategy: 'artifact-local-key' }, observations: [{ observation_id: 'obs_b', properties: { a: 1 } }, { properties: {} }] })], {
    graphId: 'jag_left',
    rootNodeIds: ['shared_node'],
  });
  const right = versionEvidence(`ev_${'2'.repeat(64)}`, [versionNode('shared_node', { identity: { strategy: 'artifact-local-key' }, observations: [{ observation_id: 'obs_a' }, { observation_id: 'obs_b', properties: { a: 2 } }] })], {
    graphId: 'jag_right',
    rootNodeIds: ['shared_node'],
  });

  const result = compareApplicationVersions({ left, right });

  expect(result.matching.exact_node_identity).toBe(1);
  expect(result.summary).toStrictEqual({ unchanged: 1, added: 0, removed: 0, changed: 0, unknown: 0 });
  expect(result.items[0]?.match.basis).toBe('exact-node-identity');
  expect(result.graph['nodes']).toStrictEqual([{ node_id: 'shared_node', kind: 'artifact', identity: { strategy: 'artifact-local-key' }, observations: [{ observation_id: 'obs_a' }, { observation_id: 'obs_b', properties: { a: 2 } }] }]);
  expect(result.graph['root_node_ids']).toStrictEqual(['shared_node']);
});

test('infers a semantic-key change with a changed_from edge', () => {
  const left = versionEvidence(
    `ev_${'1'.repeat(64)}`,
    [
      versionNode('left_node', {
        kind: 'javascript-asset',
        identity: { namespace: 'pkg', key: 'handler' },
        observations: [{ properties: { path: 'a.js' }, evidence: { artifact: { available: true, sha256: sha('9') }, location: { available: true, path: 'a.js' } } }],
      }),
    ],
    { graphId: 'jag_left', rootNodeIds: ['left_node'] },
  );
  const right = versionEvidence(`ev_${'2'.repeat(64)}`, [versionNode('right_node', { kind: 'javascript-asset', identity: { namespace: 'pkg', key: 'handler' } })], {
    graphId: 'jag_right',
    rootNodeIds: ['right_node'],
  });

  const result = compareApplicationVersions({ left, right });

  expect(result.matching.semantic_key).toBe(1);
  expect(result.summary).toStrictEqual({ unchanged: 0, added: 0, removed: 0, changed: 1, unknown: 0 });
  expect(result.items[0]).toMatchObject({
    status: 'changed',
    node_kind: 'javascript-asset',
    dimensions: ['content', 'properties'],
    limitations: [SEMANTIC_KEY_LIMITATION, RELATIONSHIP_LIMITATION],
    match: { status: 'matched', basis: 'semantic-key', confidence: 'medium' },
  });
  const edges = result.graph['edges'] as Record<string, unknown>[];
  expect(edges).toHaveLength(1);
  expect(edges[0]).toMatchObject({
    source_node_id: 'right_node',
    target_node_id: 'left_node',
    relation: 'changed_from',
    properties: { comparison_item_id: result.items[0]?.item_id, status: 'changed', match_basis: 'semantic-key', match_confidence: 'medium', dimensions: ['content', 'properties'] },
    evidence: {
      authority: 'cross-version-comparison',
      state: 'inferred',
      confidence: 'medium',
      artifact: { available: true, sha256: sha('9') },
      location: { available: true, path: 'a.js' },
      extractor: { name: 'rea-application-version-comparison', version: '1', operation: 'compare_application_versions', executable_sha256: null },
      coverage: { status: 'complete', truncated: false, omitted_count: 0, limits: [] },
      limitations: ['Cross-version pairing is inferred from the stated match basis; changed_from does not prove runtime reachability.', RELATIONSHIP_LIMITATION, SEMANTIC_KEY_LIMITATION],
    },
  });
});

test('reports an unresolved neighbor as unknown', () => {
  const left = versionEvidence(`ev_${'1'.repeat(64)}`, [versionNode('kept_left', { identity: { strategy: 'content-digest', sha256: sha('c') } }), versionNode('orphan_left', { identity: { strategy: 'content-digest', sha256: sha('d') } })], {
    graphId: 'jag_left',
    rootNodeIds: ['kept_left'],
    edges: [
      { edge_id: 'edge_left', source_node_id: 'kept_left', target_node_id: 'orphan_left', relation: 'imports' },
      { edge_id: 'edge_in', source_node_id: 'orphan_left', target_node_id: 'kept_left', relation: 'imports' },
      { edge_id: 'edge_skip', source_node_id: 'kept_left', target_node_id: 'orphan_left', relation: 'changed_from' },
    ],
  });
  const right = versionEvidence(`ev_${'2'.repeat(64)}`, [versionNode('kept_right', { identity: { strategy: 'content-digest', sha256: sha('c') } })], { graphId: 'jag_right', rootNodeIds: ['kept_right'] });

  const result = compareApplicationVersions({ left, right });

  expect(result.summary).toStrictEqual({ unchanged: 0, added: 0, removed: 1, changed: 0, unknown: 1 });
  expect(result.matching.unmatched).toBe(1);
  const paired = result.items.find((item) => item.match.status === 'matched');
  expect(paired).toMatchObject({ status: 'unknown', dimensions: [], limitations: [RELATIONSHIP_LIMITATION], left_node_id: 'kept_left', right_node_id: 'kept_right' });
  const removed = result.items.find((item) => item.status === 'removed');
  expect(removed).toMatchObject({ left_node_id: 'orphan_left', right_node_id: null, dimensions: ['availability'], match: { status: 'unmatched', basis: 'none', confidence: 'unknown' } });
  const edges = result.graph['edges'] as Record<string, unknown>[];
  expect(edges.map((edge) => edge['edge_id'])).toStrictEqual(['edge_in', 'edge_left', 'edge_skip']);
  expect(result.graph['root_node_ids']).toStrictEqual(['kept_left', 'kept_right']);
});

test('pairs nodes by module source digest', () => {
  const left = versionEvidence(`ev_${'1'.repeat(64)}`, [versionNode('left_node', { observations: [{ properties: { module_source_digest: 'mod', path: 'a.js' } }] })], { graphId: 'jag_left' });
  const right = versionEvidence(`ev_${'2'.repeat(64)}`, [versionNode('right_node', { observations: [{ properties: { module_source_digest: 'mod', path: 'b.js' } }] })], { graphId: 'jag_right' });

  const result = compareApplicationVersions({ left, right });

  expect(result.matching.exact_module_source_digest).toBe(1);
  expect(result.items[0]).toMatchObject({ status: 'unchanged', dimensions: [], match: { basis: 'exact-module-source-digest', confidence: 'exact' } });
});

test('pairs nodes by structural fingerprint at medium confidence', () => {
  const identity = { strategy: 'namespace-key', namespace: 'pkg' };
  const left = versionEvidence(`ev_${'1'.repeat(64)}`, [versionNode('left_node', { identity, observations: [{ properties: { path: 'a.js' } }] })], { graphId: 'jag_left' });
  const right = versionEvidence(`ev_${'2'.repeat(64)}`, [versionNode('right_node', { identity, observations: [{ properties: { path: 'a.js' } }] })], { graphId: 'jag_right' });

  const result = compareApplicationVersions({ left, right });

  expect(result.matching.structural_fingerprint).toBe(1);
  expect(result.items[0]).toMatchObject({ status: 'unchanged', dimensions: [], match: { basis: 'structural-fingerprint', confidence: 'medium' } });
});

test('infers a path-key semantic change without a self edge', () => {
  const left = versionEvidence(`ev_${'1'.repeat(64)}`, [versionNode('shared_map', { kind: 'source-map', observations: [{ properties: { path: 'maps/a.js', extra: 1 } }] })], { graphId: 'jag_left' });
  const right = versionEvidence(`ev_${'2'.repeat(64)}`, [versionNode('shared_map', { kind: 'source-map', observations: [{ properties: { path: 'maps/a.js', extra: 2 } }] })], { graphId: 'jag_right' });

  const result = compareApplicationVersions({ left, right });

  expect(result.matching.semantic_key).toBe(1);
  expect(result.items[0]).toMatchObject({ status: 'changed', dimensions: ['content', 'properties'], match: { basis: 'semantic-key', confidence: 'medium' } });
  expect(result.graph['edges']).toStrictEqual([]);
});

test('leaves duplicate digest nodes unmatched', () => {
  const left = versionEvidence(
    `ev_${'1'.repeat(64)}`,
    [versionNode('first_node', { identity: { strategy: 'content-digest', sha256: sha('c') } }), versionNode('second_node', { identity: { strategy: 'content-digest', sha256: sha('c') } })],
    { graphId: 'jag_left' },
  );
  const right = versionEvidence(`ev_${'2'.repeat(64)}`, [versionNode('only_node', { identity: { strategy: 'content-digest', sha256: sha('c') } })], { graphId: 'jag_right' });

  const result = compareApplicationVersions({ left, right });

  expect(result.summary).toStrictEqual({ unchanged: 0, added: 1, removed: 2, changed: 0, unknown: 0 });
  expect(result.matching).toMatchObject({ exact_content_digest: 0, ambiguous: 0, unmatched: 3 });
  expect(result.items.map((item) => item.status)).toStrictEqual(['removed', 'removed', 'added']);
});

test('records partial coverage on the graph with its edge', () => {
  const left = versionEvidence(`ev_${'1'.repeat(64)}`, [versionNode('left_node', { kind: 'javascript-asset', identity: { namespace: 'pkg', key: 'handler' }, observations: [{ properties: { path: 'a.js', extra: 1 } }] })], {
    graphId: 'jag_left',
    coverage: { status: 'partial', truncated: false, omitted_count: 2, limits: [{ name: 'nodes', value: 10, unit: 'count' }] },
    limitations: ['left graph note'],
  });
  const right = versionEvidence(`ev_${'2'.repeat(64)}`, [versionNode('right_node', { kind: 'javascript-asset', identity: { namespace: 'pkg', key: 'handler' }, observations: [{ properties: { path: 'a.js', extra: 2 } }] })], {
    graphId: 'jag_right',
    coverage: { status: 'partial', truncated: true, omitted_count: 3, limits: [{ name: 'edges', value: 5, unit: 'count' }] },
    limitations: ['right graph note'],
  });

  const result = compareApplicationVersions({ left, right });

  expect(result.coverage).toStrictEqual({ left_graph_status: 'partial', right_graph_status: 'partial', left_graph_omitted_count: 2, right_graph_omitted_count: 3, status: 'partial' });
  expect(result.graph['coverage']).toStrictEqual({
    status: 'partial',
    truncated: true,
    omitted_count: 5,
    limits: [
      { name: 'edges', value: 5, unit: 'count' },
      { name: 'nodes', value: 10, unit: 'count' },
    ],
  });
  expect(result.graph['limitations']).toStrictEqual([
    'Left: left graph note',
    'Right: right graph note',
    'The change graph contains compared entities and their retained relationships; it is not an executable application.',
    'changed_from edges are cross-version inferences and never promote structural or semantic matches to exact identity.',
  ]);
  const edges = result.graph['edges'] as Record<string, unknown>[];
  expect(edges[0]).toMatchObject({
    evidence: {
      coverage: {
        status: 'partial',
        truncated: true,
        omitted_count: 5,
        limits: [
          { name: 'edges', value: 5, unit: 'count' },
          { name: 'nodes', value: 10, unit: 'count' },
        ],
      },
    },
  });
});

test('derives graph identifiers from malformed graph fields', () => {
  const left = versionEvidence(`ev_${'1'.repeat(64)}`, [], { root: sha('f') });
  const right: Record<string, unknown> = {
    evidence_id: `ev_${'2'.repeat(64)}`,
    operation: 'analyze_javascript_application',
    normalized_result: {
      graph: { nodes: [{ node_id: '', kind: 'artifact' }], edges: 'not an array', root_node_ids: ['', 7, 'kept', null], limitations: [3, 'kept note'], coverage: {} },
    },
  };

  const result = compareApplicationVersions({ left, right });

  expect(result.left).toStrictEqual({ evidence_id: left['evidence_id'], graph_id: `jag_${digestOf(String(left['evidence_id']))}`, root_artifact_sha256: sha('f') });
  expect(result.right).toStrictEqual({ evidence_id: right['evidence_id'], graph_id: `jag_${digestOf(String(right['evidence_id']))}`, root_artifact_sha256: digestOf(String(right['evidence_id'])) });
  expect(result.summary).toStrictEqual({ unchanged: 0, added: 1, removed: 0, changed: 0, unknown: 0 });
  expect(result.items.map((item) => item.right_node_id)).toStrictEqual(['']);
  expect(result.graph).toMatchObject({
    schema: 'JavaScriptApplicationGraph',
    root_node_ids: [],
    nodes: [],
    edges: [],
    coverage: { status: 'partial', truncated: false, omitted_count: 0, limits: [] },
  });
  expect(result.coverage).toStrictEqual({ left_graph_status: 'complete', right_graph_status: 'unknown', left_graph_omitted_count: 0, right_graph_omitted_count: 0, status: 'partial' });
  expect(result.graph['limitations']).toStrictEqual([
    'Right: kept note',
    'The change graph contains compared entities and their retained relationships; it is not an executable application.',
    'changed_from edges are cross-version inferences and never promote structural or semantic matches to exact identity.',
  ]);
});

test.for([
  { label: 'left is null', left: null, right: versionEvidence(`ev_${'2'.repeat(64)}`, []), message: 'compare_application_versions left must be an Evidence object.', details: { parameter: 'left' } },
  { label: 'right is null', left: versionEvidence(`ev_${'1'.repeat(64)}`, []), right: null, message: 'compare_application_versions right must be an Evidence object.', details: { parameter: 'right' } },
  {
    label: 'left lacks an evidence identifier',
    left: { operation: 'analyze_javascript_application' },
    right: versionEvidence(`ev_${'2'.repeat(64)}`, []),
    message: 'compare_application_versions left must carry an evidence_id.',
    details: { parameter: 'left' },
  },
  {
    label: 'left is not application evidence',
    left: { evidence_id: 'ev_probe', operation: 'inspect_macho' },
    right: versionEvidence(`ev_${'2'.repeat(64)}`, []),
    message: 'compare_application_versions left must be analyze_javascript_application Evidence.',
    details: { parameter: 'left', observed_operation: 'inspect_macho' },
  },
  {
    label: 'the evidence identifiers match',
    left: versionEvidence(`ev_${'1'.repeat(64)}`, []),
    right: versionEvidence(`ev_${'1'.repeat(64)}`, []),
    message: 'Application version Evidence must be distinct',
    details: { parameter: 'right' },
  },
  {
    label: 'left has no normalized result',
    left: { evidence_id: 'ev_probe', operation: 'analyze_javascript_application', normalized_result: null },
    right: versionEvidence(`ev_${'2'.repeat(64)}`, []),
    message: 'compare_application_versions Evidence has no normalized_result.',
    details: { evidence_id: 'ev_probe' },
  },
])('rejects application versions when $label', async ({ left, right, message, details }) => {
  const payload = await payloadOf(() => compareApplicationVersions({ left, right }));

  expect(payload).toMatchObject({ code: 'invalid_request', message, details: { operation: 'compare_application_versions', ...details } });
});

const SOURCE_TO_BUNDLE_BASE_LIMITATION = 'Static digest and location signals do not establish runtime behavior, semantic equivalence, or absence of dynamically generated modules.';

interface SourceApplicationOptions {
  readonly evidenceId?: string;
  readonly root?: string;
  readonly coverage?: Record<string, unknown>;
  readonly limitations?: readonly unknown[];
  readonly graphId?: string;
}

const sourceApplication = (nodes: readonly Record<string, unknown>[], options: SourceApplicationOptions = {}): Record<string, unknown> => ({
  evidence_id: options.evidenceId ?? `ev_${'1'.repeat(64)}`,
  operation: 'analyze_javascript_application',
  normalized_result: {
    root_artifact_sha256: options.root ?? sha('f'),
    graph: {
      ...(options.graphId === undefined ? {} : { graph_id: options.graphId }),
      nodes,
      coverage: options.coverage ?? { status: 'complete' },
      limitations: options.limitations ?? [],
    },
  },
});

const sourceEntry = (path: string, digest: string | null = sha('e'), extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'file',
  classifications: ['source'],
  path,
  ...(digest === null ? {} : { sha256: digest }),
  language: 'javascript',
  ...extra,
});

interface SourceReferenceOptions {
  readonly entries?: readonly Record<string, unknown>[];
  readonly inventoryState?: string;
  readonly limitations?: readonly unknown[];
  readonly relationships?: readonly unknown[];
  readonly parseFailures?: readonly unknown[];
}

const sourceReference = (options: SourceReferenceOptions = {}): Record<string, unknown> => ({
  schema: 'HistoricalSourceGraph',
  authority: 'historical-reference',
  root_alias: '$REFERENCE_ROOT',
  root_sha256: sha('a'),
  inventory_state: options.inventoryState ?? 'complete',
  entries: options.entries ?? [],
  relationships: options.relationships ?? [],
  parse_failures: options.parseFailures ?? [],
  limitations: options.limitations ?? [],
});

const digestCurrentNode = (nodeId: string, digest: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  node_id: nodeId,
  kind: 'javascript-module',
  identity: { strategy: 'content-digest', sha256: digest },
  observations: [],
  ...extra,
});

const pathCurrentNode = (
  nodeId: string,
  properties: Record<string, unknown>,
  options: { kind?: string; identity?: Record<string, unknown>; digest?: string; extraObservations?: readonly Record<string, unknown>[] } = {},
): Record<string, unknown> => ({
  node_id: nodeId,
  kind: options.kind ?? 'javascript-asset',
  identity: options.identity ?? {},
  observations: [
    {
      properties,
      ...(options.digest === undefined ? {} : { evidence: { artifact: { sha256: options.digest } } }),
    },
    ...(options.extraObservations ?? []),
  ],
});

test('maps an unchanged source file by exact digest', async () => {
  const digest = sha('c');
  const reference = sourceReference({
    entries: [
      sourceEntry('src/main.js', null, { digest, language: 7, limitations: ['entry note'] }),
      { kind: 'file', classifications: ['configuration'], path: 'package.json' },
      { kind: 'directory', classifications: ['source'], path: 'src' },
      sourceEntry('', digest),
      { kind: 'file', classifications: 'source', path: 'nope.js' },
    ],
    limitations: ['reference note'],
  });
  const application = sourceApplication([digestCurrentNode('main_node', digest), { node_id: 'note_node', kind: 'annotation' }, { node_id: '', kind: 'artifact' }], {
    graphId: 'jag_left',
    limitations: ['graph note'],
  });

  const result = await compareSourceToBundle({ reference, application });

  expect(result.summary).toStrictEqual({ unchanged: 1, modified: 0, removed: 0, split: 0, merged: 0, duplicated: 0, unknown: 0 });
  expect(result.reference).toStrictEqual({ root_sha256: sha('a'), inventory_state: 'complete' });
  expect(result.application).toStrictEqual({ evidence_id: application['evidence_id'], graph_id: 'jag_left', root_artifact_sha256: sha('f') });
  expect(result.scoring).toStrictEqual({
    algorithm: 'rea-source-to-bundle-signals',
    minimum_candidate_score: 20,
    weights: [
      { signal: 'exact-source-digest', weight: 100 },
      { signal: 'source-map-original-path', weight: 70 },
      { signal: 'current-path-exact', weight: 60 },
      { signal: 'current-path-suffix', weight: 40 },
      { signal: 'unicode-equivalent-path', weight: 20 },
      { signal: 'basename-match', weight: 20 },
      { signal: 'language-extension', weight: 5 },
    ],
  });
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    source_path: 'src/main.js',
    source_sha256: digest,
    source_language: null,
    status: 'unchanged',
    confidence: 'exact',
    current_node_ids: ['main_node'],
    limitations: ['Exact byte identity does not establish equivalent load context or runtime behavior.', 'entry note'],
  });
  expect(result.items[0]?.candidates).toStrictEqual([
    {
      current_node_id: 'main_node',
      current_node_kind: 'javascript-module',
      score: 100,
      confidence: 'exact',
      signals: [{ kind: 'exact-source-digest', weight: 100, source_value: digest, current_values: [digest] }],
    },
  ]);
  expect(result.items[0]?.mapping_id).toMatch(/^stbc_item_[a-f0-9]{64}$/);
  expect(result.unmapped_current_node_ids).toStrictEqual([]);
  expect(result.coverage).toStrictEqual({
    status: 'complete-within-inputs',
    reference_inventory_state: 'complete',
    application_graph_status: 'complete',
    retained_source_files: 1,
    retained_application_nodes: 1,
    candidate_evaluations: 1,
  });
  expect(result.limitations).toStrictEqual([SOURCE_TO_BUNDLE_BASE_LIMITATION, 'graph note', 'reference note']);
  expect(result.evidence_links).toStrictEqual([application['evidence_id']]);
  expect(result.comparison_id).toMatch(/^stbc_[a-f0-9]{64}$/);
});

test('reports duplicate exact digest matches as duplicated', async () => {
  const digest = sha('c');
  const reference = sourceReference({ entries: [sourceEntry('src/main.js', digest)] });
  const application = sourceApplication([digestCurrentNode('first_node', digest), digestCurrentNode('second_node', digest)]);

  const result = await compareSourceToBundle({ reference, application });

  expect(result.summary).toStrictEqual({ unchanged: 0, modified: 0, removed: 0, split: 0, merged: 0, duplicated: 1, unknown: 0 });
  expect(result.items[0]).toMatchObject({
    status: 'duplicated',
    confidence: 'exact',
    current_node_ids: ['first_node', 'second_node'],
    limitations: ['The same historical source digest occurs in multiple current source occurrences.'],
  });
  expect(result.items[0]?.candidates).toHaveLength(2);
  expect(result.coverage.candidate_evaluations).toBe(2);
});

test('reports equally scored path matches as a split', async () => {
  const reference = sourceReference({ entries: [sourceEntry('src/app.js', null)] });
  const application = sourceApplication([pathCurrentNode('second_node', { path: 'src/app.js' }), pathCurrentNode('first_node', { path: 'src/app.js' })]);

  const result = await compareSourceToBundle({ reference, application });

  expect(result.summary).toStrictEqual({ unchanged: 0, modified: 0, removed: 0, split: 1, merged: 0, duplicated: 0, unknown: 0 });
  expect(result.items[0]).toMatchObject({
    status: 'split',
    confidence: 'medium',
    current_node_ids: ['first_node', 'second_node'],
    limitations: ['Multiple equally scored current source occurrences retain the historical source path; this is a static split inference, not runtime proof.'],
  });
  expect(result.items[0]?.candidates.map((candidate) => candidate.score)).toStrictEqual([85, 85]);
});

test('reports a differing source digest as modified', async () => {
  const reference = sourceReference({ entries: [sourceEntry('src/exact.js', sha('8'))] });
  const application = sourceApplication([pathCurrentNode('exact_node', { path: 'src/exact.js' }, { digest: sha('9') })]);

  const result = await compareSourceToBundle({ reference, application });

  expect(result.summary).toStrictEqual({ unchanged: 0, modified: 1, removed: 0, split: 0, merged: 0, duplicated: 0, unknown: 0 });
  expect(result.items[0]).toMatchObject({
    status: 'modified',
    confidence: 'high',
    current_node_ids: ['exact_node'],
    limitations: ['Location evidence links the source to the current node, but their source digests differ.'],
  });
  expect(result.items[0]?.candidates[0]).toMatchObject({ score: 85, confidence: 'high', current_node_kind: 'javascript-asset' });
});

test('reports a suffix path match as modified at medium confidence', async () => {
  const reference = sourceReference({ entries: [sourceEntry('suffix.js', sha('7'))] });
  const application = sourceApplication([pathCurrentNode('suffix_node', { path: 'deep/pkg/suffix.js' }, { digest: sha('9') })]);

  const result = await compareSourceToBundle({ reference, application });

  expect(result.items[0]).toMatchObject({ status: 'modified', confidence: 'medium', current_node_ids: ['suffix_node'] });
  expect(result.items[0]?.candidates[0]?.signals.map((signal) => signal.kind)).toStrictEqual(['current-path-suffix', 'basename-match', 'language-extension']);
});

test('reports a path match without comparable digests as unknown', async () => {
  const reference = sourceReference({ entries: [sourceEntry('src/nodigest.js', sha('6'))] });
  const application = sourceApplication([pathCurrentNode('plain_node', { path: 'src/nodigest.js' })]);

  const result = await compareSourceToBundle({ reference, application });

  expect(result.summary).toStrictEqual({ unchanged: 0, modified: 0, removed: 0, split: 0, merged: 0, duplicated: 0, unknown: 1 });
  expect(result.items[0]).toMatchObject({
    status: 'unknown',
    confidence: 'unknown',
    current_node_ids: ['plain_node'],
    limitations: ['Location evidence links the source to the current node, but comparable source digests are unavailable.'],
  });
});

test('reports a removed source when both inventories are complete', async () => {
  const reference = sourceReference({ entries: [sourceEntry('src/gone.js', sha('3'))] });

  const result = await compareSourceToBundle({ reference, application: sourceApplication([]) });

  expect(result.summary).toStrictEqual({ unchanged: 0, modified: 0, removed: 1, split: 0, merged: 0, duplicated: 0, unknown: 0 });
  expect(result.items[0]).toMatchObject({
    status: 'removed',
    confidence: 'high',
    current_node_ids: [],
    candidates: [],
    limitations: ['No retained current node matched exact digest or path signals within complete static inventories.'],
  });
  expect(result.coverage.status).toBe('complete-within-inputs');
});

test.for([{ inventoryState: 'partial' }, { inventoryState: 'unknown' }])('leaves an unmatched source unknown for $inventoryState inventory', async ({ inventoryState }) => {
  const reference = sourceReference({ inventoryState, entries: [sourceEntry('src/gone.js', sha('3'))] });

  const result = await compareSourceToBundle({ reference, application: sourceApplication([]) });

  expect(result.summary.unknown).toBe(1);
  expect(result.items[0]).toMatchObject({ status: 'unknown', confidence: 'unknown', limitations: ['No candidate was observed, but incomplete input or graph coverage prevents a removal claim.'] });
  expect(result.coverage.status).toBe('partial');
  expect(result.limitations).toStrictEqual([`Historical source inventory is ${inventoryState}; unmatched files remain unknown.`, SOURCE_TO_BUNDLE_BASE_LIMITATION]);
});

test.for([
  { label: 'partial', coverage: { status: 'partial' }, status: 'partial' },
  { label: 'unknown', coverage: {}, status: 'unknown' },
])('leaves an unmatched source unknown when graph coverage is $label', async ({ coverage, status }) => {
  const reference = sourceReference({ entries: [sourceEntry('src/gone.js', sha('3'))] });

  const result = await compareSourceToBundle({ reference, application: sourceApplication([], { coverage }) });

  expect(result.summary.unknown).toBe(1);
  expect(result.items[0]?.status).toBe('unknown');
  expect(result.coverage).toMatchObject({ status: 'partial', application_graph_status: status });
  expect(result.limitations).toStrictEqual([`Application graph coverage is ${status}; unmatched files remain unknown.`, SOURCE_TO_BUNDLE_BASE_LIMITATION]);
});

test('marks historical sources merged onto one current occurrence', async () => {
  const digest = sha('c');
  const reference = sourceReference({ entries: [sourceEntry('src/a.js', digest), sourceEntry('src/b.js', digest)] });
  const application = sourceApplication([digestCurrentNode('main_node', digest)]);

  const result = await compareSourceToBundle({ reference, application });

  expect(result.summary).toStrictEqual({ unchanged: 0, modified: 0, removed: 0, split: 0, merged: 2, duplicated: 0, unknown: 0 });
  expect(result.items.map((item) => item.status)).toStrictEqual(['merged', 'merged']);
  expect(result.items.map((item) => item.current_node_ids)).toStrictEqual([['main_node'], ['main_node']]);
  expect(result.items[0]?.limitations).toStrictEqual([
    'Exact byte identity does not establish equivalent load context or runtime behavior.',
    'Multiple historical source paths have exact digest identity with the same current source occurrence.',
  ]);
  expect(result.coverage.retained_source_files).toBe(2);
  expect(result.unmapped_current_node_ids).toStrictEqual([]);
});

test('leaves a basename-only candidate unknown', async () => {
  const reference = sourceReference({ entries: [sourceEntry('src/main.js', null)] });
  const application = sourceApplication([pathCurrentNode('vendor_node', { path: 'vendor/main.js' })]);

  const result = await compareSourceToBundle({ reference, application });

  expect(result.summary.unknown).toBe(1);
  expect(result.items[0]).toMatchObject({ status: 'unknown', confidence: 'unknown', limitations: ['Only weak basename or extension signals were available; no mapping was forced.'] });
  expect(result.items[0]?.candidates[0]).toMatchObject({
    score: 25,
    confidence: 'low',
    signals: [
      { kind: 'basename-match', weight: 20, source_value: 'main.js', current_values: ['vendor/main.js'] },
      { kind: 'language-extension', weight: 5, source_value: '.js', current_values: ['vendor/main.js'] },
    ],
  });
});

test('leaves a Unicode-equivalent candidate unknown', async () => {
  const reference = sourceReference({ entries: [sourceEntry('src/caf\u00e9.js', null)] });
  const application = sourceApplication([pathCurrentNode('unicode_node', { path: 'src/cafe\u0301.js' })]);

  const result = await compareSourceToBundle({ reference, application });

  expect(result.summary.unknown).toBe(1);
  expect(result.items[0]).toMatchObject({
    status: 'unknown',
    confidence: 'unknown',
    limitations: ['Unicode-equivalent paths are inferred candidates only; filesystem paths with distinct Unicode spellings may identify different files, so no mapping was forced.'],
  });
  expect(result.items[0]?.candidates[0]?.signals.map((signal) => signal.kind)).toStrictEqual(['unicode-equivalent-path', 'language-extension']);
});

test('indexes canonical Unicode spellings of current paths', async () => {
  const reference = sourceReference({ entries: [sourceEntry('src/cafe\u0301.js', null)] });
  const application = sourceApplication([pathCurrentNode('unicode_node', { path: 'src/caf\u00e9.js' })]);

  const result = await compareSourceToBundle({ reference, application });

  expect(result.summary.unknown).toBe(1);
  expect(result.items[0]?.candidates[0]?.signals.map((signal) => signal.kind)).toStrictEqual(['unicode-equivalent-path', 'language-extension']);
});

test.for([
  { resolutionKind: 'exact', resolutionPath: 'src/orig.js', sourcePath: 'src/orig.js' },
  { resolutionKind: 'suffix', resolutionPath: 'dist/src/orig.js', sourcePath: 'orig.js' },
])('matches a $resolutionKind source-map resolution', async ({ resolutionKind, resolutionPath, sourcePath }) => {
  const reference = sourceReference({ entries: [sourceEntry(sourcePath, sha('4'))] });
  const application = sourceApplication([
    {
      node_id: 'map_node',
      kind: 'javascript-asset',
      identity: { strategy: 'source-map-original', source_sha256: sha('5') },
      observations: [{ source_map_reference: { resolution: { kind: resolutionKind, path: resolutionPath } } }],
    },
  ]);

  const result = await compareSourceToBundle({ reference, application });

  expect(result.items[0]).toMatchObject({ status: 'modified', confidence: 'high', current_node_ids: ['map_node'] });
  expect(result.items[0]?.candidates[0]?.signals[0]).toStrictEqual({ kind: 'source-map-original-path', weight: 70, source_value: sourcePath, current_values: [resolutionPath] });
});

test('ignores an unresolved source-map reference', async () => {
  const reference = sourceReference({ entries: [sourceEntry('gone.js', null)] });
  const application = sourceApplication([
    {
      node_id: 'map_node',
      kind: 'javascript-asset',
      identity: { strategy: 'source-map-original', source_sha256: sha('5') },
      observations: [{ source_map_reference: { resolution: { kind: 'unresolved', path: 'gone.js' } } }],
    },
  ]);

  const result = await compareSourceToBundle({ reference, application });

  expect(result.summary).toStrictEqual({ unchanged: 0, modified: 0, removed: 1, split: 0, merged: 0, duplicated: 0, unknown: 0 });
  expect(result.items[0]?.candidates).toStrictEqual([]);
  expect(result.coverage.candidate_evaluations).toBe(0);
});

test('matches a canonical-path identity with a source digest property', async () => {
  const digest = sha('c');
  const reference = sourceReference({ entries: [sourceEntry('workspace/src/canon.js', digest)] });
  const application = sourceApplication([
    {
      node_id: 'canon_node',
      kind: 'javascript-asset',
      identity: { strategy: 'canonical-path', path: '/workspace/src/canon.js' },
      observations: [{ properties: { source_sha256: digest, path: 'ignored/other.js' } }],
    },
  ]);

  const result = await compareSourceToBundle({ reference, application });

  expect(result.items[0]).toMatchObject({ status: 'unchanged', confidence: 'exact', current_node_ids: ['canon_node'] });
  expect(result.items[0]?.candidates[0]?.signals.map((signal) => signal.kind)).toStrictEqual(['exact-source-digest', 'current-path-exact', 'basename-match', 'language-extension']);
});

test('normalizes URL with Windows observation paths', async () => {
  const reference = sourceReference({ entries: [sourceEntry('src/url.js', null), sourceEntry('app/mod.js', null)] });
  const application = sourceApplication([pathCurrentNode('norm_node', { source: 'https://cdn.example.com/src/url.js?x=1#frag', declared_path: 'C:\\app\\mod.js' })]);

  const result = await compareSourceToBundle({ reference, application });

  expect(result.summary).toStrictEqual({ unchanged: 0, modified: 0, removed: 0, split: 0, merged: 0, duplicated: 0, unknown: 2 });
  expect(result.items.map((item) => item.current_node_ids)).toStrictEqual([['norm_node'], ['norm_node']]);
  expect(result.items.map((item) => item.limitations)).toStrictEqual([
    ['Location evidence links the source to the current node, but comparable source digests are unavailable.'],
    ['Location evidence links the source to the current node, but comparable source digests are unavailable.'],
  ]);
});

test('skips a declared path when a resolved path is present', async () => {
  const reference = sourceReference({ entries: [sourceEntry('src/res.js', null), sourceEntry('src/declared.js', null)] });
  const application = sourceApplication([pathCurrentNode('resolved_node', { resolved_path: 'src/res.js', declared_path: 'src/declared.js' })]);

  const result = await compareSourceToBundle({ reference, application });

  expect(result.summary).toStrictEqual({ unchanged: 0, modified: 0, removed: 1, split: 0, merged: 0, duplicated: 0, unknown: 1 });
  expect(result.items.map((item) => item.source_path)).toStrictEqual(['src/declared.js', 'src/res.js']);
  expect(result.items.map((item) => item.status)).toStrictEqual(['removed', 'unknown']);
});

test('normalizes dot segments while dropping rootless paths', async () => {
  const reference = sourceReference({ entries: [sourceEntry('src/norm.js', null), sourceEntry('other.js', null)] });
  const application = sourceApplication([pathCurrentNode('norm_node', { path: 'src/../src/norm.js' }), pathCurrentNode('dot_node', { path: '.' }), pathCurrentNode('escape_node', { path: '../escape.js' })]);

  const result = await compareSourceToBundle({ reference, application });

  expect(result.summary).toStrictEqual({ unchanged: 0, modified: 0, removed: 1, split: 0, merged: 0, duplicated: 0, unknown: 1 });
  expect(result.items.map((item) => item.status)).toStrictEqual(['removed', 'unknown']);
  expect(result.unmapped_current_node_ids).toStrictEqual(['dot_node', 'escape_node']);
});

test('derives application defaults without a graph block', async () => {
  const application = { evidence_id: `ev_${'3'.repeat(64)}`, operation: 'analyze_javascript_application', normalized_result: { limitations: ['outer graph note'] } };

  const result = await compareSourceToBundle({ reference: sourceReference({ entries: [sourceEntry('src/gone.js', null)] }), application });

  expect(result.application).toStrictEqual({ evidence_id: application['evidence_id'], graph_id: `jag_${digestOf(String(application['evidence_id']))}`, root_artifact_sha256: digestOf(String(application['evidence_id'])) });
  expect(result.coverage).toMatchObject({ status: 'partial', application_graph_status: 'unknown', retained_application_nodes: 0 });
  expect(result.summary.unknown).toBe(1);
  expect(result.limitations).toStrictEqual(['Application graph coverage is unknown; unmatched files remain unknown.', SOURCE_TO_BUNDLE_BASE_LIMITATION, 'outer graph note']);
});

test('reads a reference graph from a JSON file', async () => {
  const targets = await tempTargets();
  const digest = sha('c');
  const path = await targets.write('reference.json', JSON.stringify(sourceReference({ entries: [sourceEntry('src/main.js', digest)] })));

  const result = await compareSourceToBundle({ reference: { kind: 'file', path }, application: sourceApplication([digestCurrentNode('main_node', digest)]) });

  expect(result.summary.unchanged).toBe(1);
  expect(result.reference).toStrictEqual({ root_sha256: sha('a'), inventory_state: 'complete' });
});

test('groups current observations by file occurrence', async () => {
  const digest = sha('d');
  const occurrence = { container_sha256: sha('c'), path: 'bundle/a.js', sha256: digest };
  const application = sourceApplication([
    {
      node_id: 'occ_node',
      kind: 'javascript-asset',
      identity: {},
      observations: [{ properties: { file_occurrence: occurrence } }, { properties: { file_occurrence: occurrence } }],
    },
  ]);

  const result = await compareSourceToBundle({ reference: sourceReference({ entries: [sourceEntry('bundle/a.js', digest)] }), application });

  expect(result.summary.unchanged).toBe(1);
  expect(result.items[0]?.candidates).toStrictEqual([
    {
      current_file_occurrence: occurrence,
      representation_node_ids: ['occ_node'],
      current_node_id: 'occ_node',
      current_node_kind: 'javascript-asset',
      score: 100,
      confidence: 'exact',
      signals: [{ kind: 'exact-source-digest', weight: 100, source_value: digest, current_values: [digest] }],
    },
  ]);
  expect(result.unmapped_current_node_ids).toStrictEqual([]);
});

test('keeps distinct file occurrences as separate candidates', async () => {
  const first = { container_sha256: sha('c'), path: 'one/a.js', sha256: sha('1') };
  const second = { container_sha256: sha('c'), path: 'two/b.js', sha256: sha('2') };
  const application = sourceApplication([
    {
      node_id: 'occ_node',
      kind: 'javascript-asset',
      identity: {},
      observations: [{ properties: { file_occurrence: first } }, { properties: { file_occurrence: second } }],
    },
  ]);
  const reference = sourceReference({ entries: [sourceEntry('one/a.js', sha('1')), sourceEntry('two/b.js', sha('2'))] });

  const result = await compareSourceToBundle({ reference, application });

  expect(result.summary).toStrictEqual({ unchanged: 2, modified: 0, removed: 0, split: 0, merged: 0, duplicated: 0, unknown: 0 });
  expect(result.items.map((item) => item.candidates[0]?.current_file_occurrence)).toStrictEqual([first, second]);
  expect(result.items.map((item) => item.candidates[0]?.representation_node_ids)).toStrictEqual([['occ_node'], ['occ_node']]);
});

test('synthesizes an occurrence from a path with digest', async () => {
  const digest = sha('5');
  const application = sourceApplication([
    {
      node_id: 'synth_node',
      kind: 'javascript-asset',
      identity: {},
      observations: [{ properties: { path: 'src/syn.js', file_occurrence: { path: 'broken' } }, evidence: { artifact: { sha256: digest } } }],
    },
  ]);

  const result = await compareSourceToBundle({ reference: sourceReference({ entries: [sourceEntry('src/syn.js', digest)] }), application });

  expect(result.summary.unchanged).toBe(1);
  expect(result.items[0]?.candidates[0]).toMatchObject({
    current_file_occurrence: { container_sha256: sha('f'), path: 'src/syn.js', sha256: digest },
    representation_node_ids: ['synth_node'],
  });
});

test('keeps a node without a synthesizable occurrence keyed by node id', async () => {
  const application = sourceApplication([pathCurrentNode('plain_node', { path: 'src/nodigest.js' })]);

  const result = await compareSourceToBundle({ reference: sourceReference({ entries: [sourceEntry('src/nodigest.js', null)] }), application });

  const candidate = result.items[0]?.candidates[0];
  expect(result.items[0]?.status).toBe('unknown');
  expect(candidate).toMatchObject({ current_node_id: 'plain_node', score: 85, confidence: 'high' });
  expect(Object.hasOwn(candidate ?? {}, 'current_file_occurrence')).toBe(false);
  expect(Object.hasOwn(candidate ?? {}, 'representation_node_ids')).toBe(false);
});

test.for([
  { label: 'the reference is null', reference: null, message: 'compare_source_to_bundle reference must be a HistoricalSourceGraph object.', details: {} },
  { label: 'the schema differs', mutate: { schema: 'OtherGraph' }, message: 'compare_source_to_bundle reference.schema must be HistoricalSourceGraph.', details: { expected: ['HistoricalSourceGraph'] } },
  { label: 'the authority differs', mutate: { authority: 'external-service' }, message: 'compare_source_to_bundle reference.authority must be historical-reference.', details: { expected: ['historical-reference'] } },
  { label: 'the root alias differs', mutate: { root_alias: '$OTHER_ROOT' }, message: 'compare_source_to_bundle reference.root_alias must be $REFERENCE_ROOT.', details: { expected: ['$REFERENCE_ROOT'] } },
  { label: 'the root digest is short', mutate: { root_sha256: 'abc' }, message: 'compare_source_to_bundle reference.root_sha256 must be a sha256 hex digest.', details: {} },
  {
    label: 'the inventory state is invalid',
    mutate: { inventory_state: 'sometimes' },
    message: 'compare_source_to_bundle reference.inventory_state is invalid.',
    details: { expected: ['complete', 'partial', 'unknown'] },
  },
  { label: 'entries is not an array', mutate: { entries: 'x' }, message: 'compare_source_to_bundle reference requires entries, relationships, and parse_failures arrays.', details: {} },
  { label: 'relationships is null', mutate: { relationships: null }, message: 'compare_source_to_bundle reference requires entries, relationships, and parse_failures arrays.', details: {} },
  { label: 'parse_failures is null', mutate: { parse_failures: null }, message: 'compare_source_to_bundle reference requires entries, relationships, and parse_failures arrays.', details: {} },
])('refuses a reference graph when $label', async ({ reference, mutate, message, details }) => {
  const input = reference === null ? null : { ...sourceReference(), ...(mutate ?? {}) };

  const payload = await payloadOf(() => compareSourceToBundle({ reference: input, application: sourceApplication([]) }));

  expect(payload).toMatchObject({ code: 'invalid_request', message, details: { operation: 'compare_source_to_bundle', parameter: 'reference', ...details } });
});

test('refuses a relative reference file path', async () => {
  const payload = await payloadOf(() => compareSourceToBundle({ reference: { kind: 'file', path: 'relative.json' }, application: sourceApplication([]) }));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    message: 'compare_source_to_bundle reference file path must be absolute.',
    details: { operation: 'compare_source_to_bundle', parameter: 'reference' },
  });
});

test.for([
  { label: 'the application is null', application: null, message: 'compare_source_to_bundle application must be an Evidence object.', details: { parameter: 'application' } },
  {
    label: 'the evidence identifier is missing',
    application: { operation: 'analyze_javascript_application' },
    message: 'compare_source_to_bundle application must carry an evidence_id.',
    details: { parameter: 'application' },
  },
  {
    label: 'the operation differs',
    application: { evidence_id: 'ev_probe', operation: 'inspect_macho' },
    message: 'compare_source_to_bundle application must be analyze_javascript_application Evidence.',
    details: { parameter: 'application', observed_operation: 'inspect_macho' },
  },
])('refuses an application when $label', async ({ application, message, details }) => {
  const payload = await payloadOf(() => compareSourceToBundle({ reference: sourceReference(), application }));

  expect(payload).toMatchObject({ code: 'invalid_request', message, details: { operation: 'compare_source_to_bundle', ...details } });
});
