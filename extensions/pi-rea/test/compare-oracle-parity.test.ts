import { expect, test } from 'vitest';
import { compareSourceToBundle } from '../src/analysis/compare-source-to-bundle.ts';
import type { ReaError } from '../src/contract/errors.ts';
import { createEvidence, type EvidenceDraft } from '../src/session/evidence.ts';

const sha = (character: string): string => character.repeat(64);

const payloadOf = async (run: () => unknown): Promise<ReaError['payload']> => {
  try {
    await run();
  } catch (error) {
    return (error as ReaError).payload;
  }
  throw new Error('the analyzer returned instead of throwing');
};

const reference = {
  schema: 'HistoricalSourceGraph',
  authority: 'historical-reference',
  root_alias: '$REFERENCE_ROOT',
  root_sha256: sha('a'),
  inventory_state: 'complete',
  entries: [],
  relationships: [],
  parse_failures: [],
  limitations: [],
};

const applicationDraft = (): EvidenceDraft => ({
  subject: null,
  provider: { id: 'fixture', name: 'Fixture provider', version: null },
  analysis_profile: null,
  predicate_type: 'rea.javascript-application-analysis',
  operation: 'analyze_javascript_application',
  parameters: {},
  raw_result: null,
  normalized_result: { root_artifact_sha256: sha('f'), graph: { graph_id: 'jag_fixture', nodes: [], coverage: { status: 'complete' }, limitations: [] } },
  confidence: 'observed',
  authority: 'shipped-artifact',
  environment: null,
  limitations: [],
  locations: [],
  evidence_links: [],
});

const EVIDENCE_IDENTITY_FAILURE = 'Evidence validation failed at evidence_id: Evidence semantic identifier does not match its record';

test('rejects a null reference', async () => {
  const application = createEvidence(applicationDraft());

  const payload = await payloadOf(() => compareSourceToBundle({ reference: null, application }));

  expect(payload).toMatchObject({ code: 'invalid_request', category: 'invalid_input', details: { operation: 'compare_source_to_bundle', parameter: 'reference' } });
});

test.for([
  { label: 'null', normalized_result: null },
  { label: 'a string', normalized_result: 'inventory' },
  { label: 'an array', normalized_result: [] },
])('rejects a tampered application whose normalized_result is $label', async ({ normalized_result }) => {
  const application = { ...createEvidence(applicationDraft()), normalized_result };

  const payload = await payloadOf(() => compareSourceToBundle({ reference, application }));

  expect(payload).toStrictEqual({
    code: 'evidence_integrity_mismatch',
    category: 'integrity_mismatch',
    message: EVIDENCE_IDENTITY_FAILURE,
    retryable: false,
    remediation: { action: EVIDENCE_IDENTITY_FAILURE },
    details: { reason: EVIDENCE_IDENTITY_FAILURE },
  });
});

test('rejects a minimal application with a null normalized_result', async () => {
  const application = { evidence_id: `ev_${sha('c')}`, operation: 'analyze_javascript_application', normalized_result: null };

  const payload = await payloadOf(() => compareSourceToBundle({ reference, application }));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    category: 'invalid_input',
    details: { operation: 'compare_source_to_bundle', parameter: 'application' },
  });
});

test('compares a sealed application with an inventory object', async () => {
  const application = createEvidence(applicationDraft());

  const inspection = await compareSourceToBundle({ reference, application });

  expect(inspection.application).toStrictEqual({ evidence_id: application.evidence_id, graph_id: 'jag_fixture', root_artifact_sha256: sha('f') });
  expect(inspection.summary).toStrictEqual({ unchanged: 0, modified: 0, removed: 0, split: 0, merged: 0, duplicated: 0, unknown: 0 });
});
