import { expect, test } from 'vitest';
import { evidenceIntegrityMismatch, ReaError, resourceConstraint } from '../src/contract/errors.ts';
import { byteLength, DEFAULT_RESPONSE_BUDGET_BYTES, errorResult, evidenceResult, operationResult, responseBudgetBytes } from '../src/contract/results.ts';
import { createEvidence } from '../src/session/evidence.ts';
import { capture } from './support/fixtures.ts';

const textOf = (result: { content: readonly { type: string; text?: string }[] }): string => result.content[0]?.text ?? '';

test('KERN-004: an operation result wraps its payload in result and mirrors it in structured content', () => {
  const result = operationResult({ path: '/tmp/bundle.json', bytes: 12, records: 1, unknowns: 0 });
  expect(textOf(result)).toBe('{"result":{"path":"/tmp/bundle.json","bytes":12,"records":1,"unknowns":0}}');
  expect(result.structuredContent).toStrictEqual({ result: { path: '/tmp/bundle.json', bytes: 12, records: 1, unknowns: 0 } });
  expect(result.isError).toBeUndefined();
});

test('KERN-004: an operation result matches the reference export shape', () => {
  const reference = capture('pass2', 'export_evidence_bundle--export').response.result?.structuredContent;
  const result = operationResult({ path: '/tmp/bundle.json', bytes: 2381, records: 1, unknowns: 0 });
  expect(Object.keys(result.structuredContent ?? {})).toStrictEqual(Object.keys(reference ?? {}));
});

test('KERN-004: an Evidence result is the record at the top level, marked as target-derived', () => {
  const record = createEvidence({
    subject: { name: 'fixture', digest: { sha256: 'a'.repeat(64) }, format: 'mach-o', architecture: 'arm64', local_path: '/tmp/fixture' },
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
  });
  const result = evidenceResult(record);
  expect(result.structuredContent).toStrictEqual(record);
  expect(JSON.parse(textOf(result))).toStrictEqual(record);
  expect(result.details).toStrictEqual({ provenance: { untrusted_content: true, source: 'analysis_target' } });
});

test('KERN-005: a failure carries the canonical error JSON, isError, and no structured content', () => {
  const result = errorResult(resourceConstraint('too large', { resource: 'transport' }));
  expect(JSON.parse(textOf(result))).toStrictEqual({
    error: {
      code: 'resource_constraint',
      category: 'resource_constraint',
      message: 'too large',
      retryable: false,
      remediation: { action: 'too large' },
      details: { resource: 'transport' },
    },
  });
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toBeUndefined();
});

test('KERN-005: an unexpected failure is reported as execution_failure, not swallowed', () => {
  const result = errorResult(new Error('boom'));
  const parsed = JSON.parse(textOf(result)) as { error: { code: string; message: string } };
  expect(parsed.error.code).toBe('execution_failure');
  expect(parsed.error.message).toBe('boom');
  expect(result.isError).toBe(true);
});

test('KERN-005: a ReaError keeps its exact payload', () => {
  const error = new ReaError({
    code: 'target_unavailable',
    category: 'unavailable',
    message: 'missing',
    retryable: false,
    remediation: { action: 'missing' },
    details: { path: '/nope' },
  });
  const parsed = JSON.parse(textOf(errorResult(error))) as { error: { code: string; details: unknown } };
  expect(parsed.error).toStrictEqual(error.payload);
});

test("KERN-040: the budget defaults to REA's 10 MiB receive budget", () => {
  expect(responseBudgetBytes({})).toBe(DEFAULT_RESPONSE_BUDGET_BYTES);
  expect(DEFAULT_RESPONSE_BUDGET_BYTES).toBe(10_485_760);
});

test('KERN-040: a configured budget must be a safe decimal integer of at least the default', () => {
  expect(responseBudgetBytes({ REA_MCP_MAX_RESPONSE_BYTES: '10485760' })).toBe(DEFAULT_RESPONSE_BUDGET_BYTES);
  expect(responseBudgetBytes({ REA_MCP_MAX_RESPONSE_BYTES: '20971520' })).toBe(20_971_520);
  for (const value of ['10485759', 'abc', '1e9', '-1', '99999999999999999999']) {
    expect(() => responseBudgetBytes({ REA_MCP_MAX_RESPONSE_BYTES: value })).toThrowError(/REA_MCP_MAX_RESPONSE_BYTES/);
  }
});

test('KERN-040: an oversized result is replaced by resource_constraint with the reported limits', () => {
  const oversized = { blob: 'x'.repeat(DEFAULT_RESPONSE_BUDGET_BYTES + 1) };
  let thrown: unknown;
  try {
    operationResult(oversized);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ReaError);
  const payload = (thrown as ReaError).payload;
  expect(payload.code).toBe('resource_constraint');
  expect(payload.category).toBe('resource_constraint');
  const reportedLimits = payload.details?.['reported_limits'];
  expect(reportedLimits).toBeDefined();
  expect((reportedLimits as { response_budget_bytes: number }).response_budget_bytes).toBe(DEFAULT_RESPONSE_BUDGET_BYTES);
  expect(byteLength(JSON.stringify(oversized))).toBeGreaterThan(DEFAULT_RESPONSE_BUDGET_BYTES);
});

test('KERN-004: a built error keeps a distinct remediation when one is supplied', () => {
  const result = errorResult(evidenceIntegrityMismatch('The record is not retained.', { evidence_id: `ev_${'0'.repeat(64)}` }, 'Re-run its producer or import its bundle.'));
  const parsed = JSON.parse(textOf(result)) as { error: { remediation: { action: string } } };
  expect(parsed.error.remediation.action).toBe('Re-run its producer or import its bundle.');
});
