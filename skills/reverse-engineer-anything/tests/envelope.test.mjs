import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { canonicalJson, digestOf, evidenceId, observationId } from '../scripts/lib/canonical.mjs';
import { AUTHORITY, artifactRef, CONFIDENCE, coverage, createEnvelope, observation, STATE } from '../scripts/lib/envelope.mjs';

const reference = (name) => new URL(`../../../parity/reverse-engineer-anything/fixtures/reference/${name}`, import.meta.url);
const readReference = async (name) => JSON.parse(await (await import('node:fs/promises')).readFile(reference(name), 'utf8'));

const subject = (overrides = {}) => ({
  name: 'notepad-app',
  digest: { sha256: 'a'.repeat(64) },
  format: 'directory',
  architecture: null,
  local_path: '/tmp/notepad-app',
  ...overrides,
});

test('ENV-001: envelope carries the reference key set', async () => {
  const fixture = await readReference('rea-6.4.0-analyze-javascript-application.json');
  const envelope = createEnvelope({
    operation: 'analyze_javascript_application',
    predicateType: 'rea.javascript-application-analysis',
    subject: subject(),
    parameters: { format: 'auto' },
    normalizedResult: { graph: { nodes: [], edges: [] } },
    confidence: 'derived',
    authority: 'shipped-artifact',
    limitations: ['Static imports do not prove runtime execution.'],
    locations: [{ kind: 'artifact-path', path: 'artifact-root' }],
  });
  const { _fixture_annotations: _annotations, note: _note, ...fixtureEnvelope } = fixture;
  assert.deepEqual(Object.keys(envelope).sort(), Object.keys(fixtureEnvelope).sort());
  assert.equal(envelope.raw_result, null);
  assert.equal(envelope.analysis_profile, null);
  assert.equal(envelope.environment, null);
  assert.deepEqual(envelope.evidence_links, []);
});

test('ENV-002: subject digest is content-addressed and stable across paths', async () => {
  const first = digestOf(Buffer.from('notepad'));
  const second = digestOf(Buffer.from('notepad'));
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, digestOf(Buffer.from('notepad ')));
});

test('ENV-003: evidence ids are deterministic and input-sensitive', () => {
  const base = { operation: 'inspect_artifact', parameters: { integrity_policy: 'fail' }, subjectSha256: 'b'.repeat(64), normalizedResult: { format: 'zip' } };
  const first = evidenceId(base);
  assert.equal(first, evidenceId({ ...base, parameters: { integrity_policy: 'fail' } }));
  assert.match(first, /^ev_[0-9a-f]{64}$/);
  assert.notEqual(first, evidenceId({ ...base, normalizedResult: { format: 'asar' } }));
  assert.notEqual(first, evidenceId({ ...base, subjectSha256: 'c'.repeat(64) }));
  assert.notEqual(first, evidenceId({ ...base, operation: 'inspect_binary_layout' }));
});

test('ENV-004: provider and predicate identify the operation', () => {
  const envelope = createEnvelope({
    operation: 'inspect_binary_layout',
    predicateType: 'rea.binary-layout',
    subject: subject({ format: 'mach-o' }),
    parameters: {},
    normalizedResult: {},
    confidence: 'derived',
    authority: 'shipped-artifact',
    limitations: ['Static layout facts only.'],
    locations: [],
  });
  assert.equal(envelope.operation, 'inspect_binary_layout');
  assert.equal(envelope.predicate_type, 'rea.binary-layout');
  assert.equal(envelope.provider.id, 'pi-rea');
  assert.equal(typeof envelope.provider.version, 'string');
});

test('ENV-005: confidence and authority use the reference vocabularies', async () => {
  const fixture = await readReference('rea-6.4.0-analyze-javascript-application.json');
  assert.ok(CONFIDENCE.has(fixture.confidence));
  assert.ok(AUTHORITY.has(fixture.authority));
  const envelope = createEnvelope({
    operation: 'analyze_javascript_application',
    predicateType: 'rea.javascript-application-analysis',
    subject: subject(),
    parameters: {},
    normalizedResult: {},
    confidence: 'derived',
    authority: 'shipped-artifact',
    limitations: ['x'],
    locations: [],
  });
  assert.ok(CONFIDENCE.has(envelope.confidence));
  assert.ok(AUTHORITY.has(envelope.authority));
  assert.ok(Array.isArray(envelope.locations));
  assert.throws(() => createEnvelope({ operation: 'x', predicateType: 'p', subject: subject(), normalizedResult: {}, limitations: ['y'] }), /locations/);
  assert.throws(() => createEnvelope({ operation: 'x', predicateType: 'p', subject: subject(), normalizedResult: {}, locations: [] }), /limitations/);
});

test('ENV-006: limitations survive view and export', async (t) => {
  const { openStore } = await import('../scripts/lib/store.mjs');
  const root = mkdtempSync(join(tmpdir(), 'rea-env-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = await openStore({ dir: root });
  const envelope = createEnvelope({
    operation: 'inspect_artifact',
    predicateType: 'rea.artifact-inventory',
    subject: subject({ format: 'zip' }),
    parameters: {},
    normalizedResult: { items: [] },
    confidence: 'derived',
    authority: 'shipped-artifact',
    limitations: ['PKG remains root-hash-only.'],
    locations: [{ kind: 'artifact-path', path: 'package.zip' }],
  });
  const retained = await store.retain(envelope);
  await store.exportBundle(join(root, 'bundle.json'), { overwrite: true });
  const bundle = JSON.parse(await (await import('node:fs/promises')).readFile(join(root, 'bundle.json'), 'utf8'));
  assert.deepEqual(retained.limitations, ['PKG remains root-hash-only.']);
  assert.deepEqual(bundle.records[0].limitations, ['PKG remains root-hash-only.']);
});

test('OBS-001: observations carry artifact, location, extractor and coverage', async () => {
  const fixture = await readReference('rea-6.4.0-analyze-javascript-application.json');
  const node = fixture.normalized_result.graph.nodes.find((candidate) => candidate.kind === 'electron-renderer');
  const observed = observation({
    label: node.observations[0].label,
    properties: node.observations[0].properties,
    authority: 'static-relationship-inference',
    state: 'inferred',
    confidence: 'high',
    artifact: artifactRef({ available: true, sha256: node.observations[0].evidence.artifact.sha256 }),
    location: node.observations[0].evidence.location,
    extractor: { name: 'pi-rea-javascript-application', version: '1', operation: 'resolve-electron-role', executable_sha256: null },
    coverage: coverage({ status: 'complete' }),
    limitations: [],
  });
  assert.deepEqual(Object.keys(observed.evidence).sort(), Object.keys(node.observations[0].evidence).sort());
  assert.match(observed.observation_id, /^jag_observation_[0-9a-f]{64}$/);
  assert.equal(observed.identifier_strategy.strategy, 'semantic-content-sha256');
});

test('OBS-002: static syntax yields inferred observations', () => {
  const observed = observation({
    label: 'main.js',
    properties: { semantic_role: 'module-reference' },
    authority: 'static-relationship-inference',
    state: STATE.inferred,
    confidence: 'low',
    artifact: artifactRef({ available: true, sha256: 'd'.repeat(64) }),
    location: { available: true, value: { kind: 'source-range', source: 'main.js', start: { line: 1, column: 0 }, end: { line: 1, column: 10 } } },
    extractor: { name: 'x', version: '1', operation: 'parse', executable_sha256: null },
    coverage: coverage({ status: 'complete' }),
    limitations: [],
  });
  assert.equal(observed.evidence.state, 'inferred');
  assert.notEqual(observed.evidence.state, 'observed');
});

test('OBS-003: truncated coverage reports an omitted count', () => {
  assert.throws(() => coverage({ status: 'complete', truncated: true }), /omitted/i);
  const partial = coverage({ status: 'partial', truncated: true, omittedCount: 3, limits: ['Member limit reached.'] });
  assert.equal(partial.truncated, true);
  assert.equal(partial.omitted_count, 3);
  assert.ok(partial.limits.length > 0);
});

test('canonical json is key-order independent', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
  assert.equal(observationId('x', { b: 1, a: 2 }), observationId('x', { a: 2, b: 1 }));
});

test('ENV-007: a structure nested past the depth cap is refused, not overflowed', () => {
  let deep = { leaf: true };
  for (let index = 0; index < 200; index += 1) deep = { nested: deep };
  assert.throws(
    () => canonicalJson(deep),
    (error) => error instanceof Error && /deeper than/.test(error.message) && !(error instanceof RangeError),
  );
});
