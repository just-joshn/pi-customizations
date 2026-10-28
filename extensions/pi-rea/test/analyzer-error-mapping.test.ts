import { expect, test } from 'vitest';
import { mapAnalyzerError } from '../src/analysis/map-analyzer-error.ts';
import { invalidRequest, type ReaError } from '../src/contract/errors.ts';

const payloadOf = (run: () => unknown): ReaError['payload'] => {
  try {
    run();
  } catch (error) {
    return (error as ReaError).payload;
  }
  throw new Error('mapAnalyzerError returned instead of throwing');
};

test('passes a ReaError through unchanged', () => {
  const original = invalidRequest('already mapped');
  let thrown: unknown;
  try {
    mapAnalyzerError(original);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBe(original);
});

test('maps an IntegrityPolicyError to an artifact integrity mismatch', () => {
  const payload = payloadOf(() => mapAnalyzerError({ name: 'IntegrityPolicyError', message: 'digest differs', contradictions: [{ path: 'app.asar' }] }));
  expect(payload).toMatchObject({
    code: 'artifact_integrity_mismatch',
    category: 'integrity_mismatch',
    message: 'digest differs',
    retryable: false,
    details: { contradictions: [{ path: 'app.asar' }] },
  });
});

test('supplies defaults for a bare IntegrityPolicyError', () => {
  const payload = payloadOf(() => mapAnalyzerError({ name: 'IntegrityPolicyError' }));
  expect(payload.message).toBe('Artifact integrity check failed.');
  expect(payload.details).toStrictEqual({ contradictions: [] });
});

test.for(['FormatError', 'GoFormatError', 'ArtifactFormatError', 'AsarError', 'HarError', 'ZipError'])('maps %s to unsupported_target', (name) => {
  const payload = payloadOf(() => mapAnalyzerError({ name, message: 'bad header', code: 'bad_magic', offset: 12 }));
  expect(payload).toMatchObject({ code: 'unsupported_target', category: 'unsupported_target', message: 'bad header' });
  expect(payload.details).toMatchObject({ code: 'bad_magic', offset: 12 });
});

test('defaults the fields of a bare format error', () => {
  const payload = payloadOf(() => mapAnalyzerError({ name: 'FormatError' }));
  expect(payload.message).toBe('Unsupported target format.');
  expect(payload.details).toMatchObject({ code: null, offset: null });
});

test('reconstructs a coded error that carries a remediation action', () => {
  const payload = payloadOf(() =>
    mapAnalyzerError({
      code: 'truncated',
      category: 'truncated',
      message: 'cut short',
      retryable: true,
      remediation: { action: 'Read more bytes.' },
      details: { offset: 4 },
    }),
  );
  expect(payload).toStrictEqual({
    code: 'truncated',
    category: 'truncated',
    message: 'cut short',
    retryable: true,
    remediation: { action: 'Read more bytes.' },
    details: { offset: 4 },
  });
});

test('falls back to the message as remediation when none is recorded', () => {
  const payload = payloadOf(() => mapAnalyzerError({ code: 'execution_failure', category: 'execution_failure', message: 'provider died' }));
  expect(payload.remediation).toStrictEqual({ action: 'provider died' });
  expect(payload.retryable).toBe(false);
  expect(payload.details).toBeUndefined();
});

test('falls back to the code as the message when none is recorded', () => {
  const payload = payloadOf(() => mapAnalyzerError({ code: 'provider_timeout', category: 'timeout' }));
  expect(payload.message).toBe('provider_timeout');
  expect(payload.remediation).toStrictEqual({ action: 'Read the reported detail and retry.' });
});

test('treats an unknown code as an invalid request', () => {
  const payload = payloadOf(() => mapAnalyzerError({ code: 'not_a_real_code', category: 'invalid_input', message: 'nope' }));
  expect(payload.code).toBe('invalid_request');
  expect(payload.message).toBe('nope');
});

test('treats an unknown category as an invalid request', () => {
  const payload = payloadOf(() => mapAnalyzerError({ code: 'invalid_request', category: 'not_a_category', message: 'nope' }));
  expect(payload.code).toBe('invalid_request');
  expect(payload.message).toBe('nope');
});

test('treats an Error instance as an invalid request', () => {
  const payload = payloadOf(() => mapAnalyzerError(new Error('plain failure')));
  expect(payload.code).toBe('invalid_request');
  expect(payload.message).toBe('plain failure');
});

test('reports an unrecognizable failure as capability_unavailable', () => {
  const payload = payloadOf(() => mapAnalyzerError('no contract here'));
  expect(payload).toMatchObject({
    code: 'capability_unavailable',
    category: 'unsupported_provider',
    details: { reason: 'analyzer_error', error: 'no contract here' },
  });
});
