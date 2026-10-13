import { CATEGORIES, ERROR_CODES } from './error-vocabulary.mjs';

export { CATEGORIES, ERROR_CODES };

/** A failure that carries the reference error contract's fields. */
export class ReaError extends Error {
  constructor({ code, category, message, retryable = false, remediation, details = {} }) {
    super(message);
    this.name = 'ReaError';
    this.code = code;
    this.category = category;
    this.retryable = retryable;
    this.remediation = remediation;
    this.details = details;
  }
}

export function fail(code, category, message, { retryable = false, action, details = {} } = {}) {
  if (!ERROR_CODES.has(code)) throw new Error(`unknown error code: ${code}`);
  if (!CATEGORIES.has(category)) throw new Error(`unknown error category: ${category}`);
  return new ReaError({ code, category, message, retryable, remediation: { action: action ?? defaultAction(code) }, details });
}

function defaultAction(code) {
  return (
    {
      invalid_request: 'Correct the listed arguments and retry.',
      unsupported_target: 'Select a target whose format this operation supports.',
      capability_unavailable: 'Install or select the missing prerequisite, or answer the question from the evidence that is available.',
      artifact_integrity_mismatch: 'Re-acquire the artifact, or record the contradiction with --integrity-policy record-and-continue.',
      revision_conflict: 'Re-read the current record and retry with its revision.',
      artifact_changed: 'Re-run the analysis against the current artifact bytes.',
      truncated: 'Narrow the request or page through the retained evidence.',
      cancelled: 'Re-run the operation if it is still needed.',
      provider_timeout: 'Retry, or narrow the target.',
      resource_constraint: 'Narrow the request, or raise the limit for this operation.',
      unreadable_output: 'Inspect the raw output and retry.',
      evidence_integrity_mismatch: 'Re-export the bundle from the session that produced it.',
      execution_failure: 'Read the reported detail and retry with a supported input.',
      configuration_invalid: 'Repair the store or configuration path and retry.',
      target_unavailable: 'Confirm the target still exists and is readable.',
      process_capture_failed: 'Re-run the capture with a narrower scenario.',
      cleanup_incomplete: 'Remove the leftover resource before retrying.',
      access_denied: 'Grant the required access, or choose an accessible target.',
      artifact_operation_failed: 'Read the reported detail and retry.',
    }[code] ?? 'Read the reported detail and retry.'
  );
}

export const invalidInput = (message, issues, operation) =>
  fail('invalid_request', 'invalid_input', message, {
    retryable: true,
    action: 'Correct the listed arguments and retry.',
    details: { ...(operation ? { operation } : {}), issues },
  });

export const unsupportedTarget = (message, details) => fail('unsupported_target', 'unsupported_target', message, { details });

export const capabilityUnavailable = (operation, reason, details = {}) => fail('capability_unavailable', 'unsupported_provider', reason, { details: { operation, reason, ...details } });

export const integrityMismatch = (message, details) => fail('artifact_integrity_mismatch', 'integrity_mismatch', message, { details });

export const revisionConflict = (message, details) => fail('revision_conflict', 'invalid_input', message, { details });

export function errorEnvelope(error) {
  const known = error instanceof ReaError ? error : fail('execution_failure', 'execution_failure', error instanceof Error ? error.message : String(error));
  return {
    code: known.code,
    category: known.category,
    message: known.message,
    retryable: known.retryable,
    remediation: known.remediation,
    details: known.details,
  };
}
