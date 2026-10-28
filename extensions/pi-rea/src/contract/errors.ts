export const ERROR_CATEGORIES = ['invalid_input', 'unsupported_provider', 'unsupported_target', 'integrity_mismatch', 'truncated', 'cancelled', 'timeout', 'resource_constraint', 'unavailable', 'execution_failure'] as const;

export const ERROR_CODES = [
  'invalid_request',
  'access_denied',
  'artifact_changed',
  'unreadable_output',
  'capability_unavailable',
  'unsupported_target',
  'provider_unavailable',
  'provider_timeout',
  'resource_constraint',
  'cancelled',
  'artifact_integrity_mismatch',
  'artifact_operation_failed',
  'evidence_integrity_mismatch',
  'truncated',
  'process_capture_failed',
  'cleanup_incomplete',
  'revision_conflict',
  'configuration_invalid',
  'target_unavailable',
  'execution_failure',
] as const;

export type ReaErrorCategory = (typeof ERROR_CATEGORIES)[number];
export type ReaErrorCode = (typeof ERROR_CODES)[number];

export interface ReaErrorPayload {
  readonly code: ReaErrorCode;
  readonly category: ReaErrorCategory;
  readonly message: string;
  readonly retryable: boolean;
  readonly remediation: { readonly action: string };
  readonly recovery?: { readonly kind: string; readonly operation: string };
  readonly details?: Record<string, unknown>;
}

export class ReaError extends Error {
  readonly payload: ReaErrorPayload;

  constructor(payload: ReaErrorPayload) {
    super(payload.message);
    this.name = 'ReaError';
    this.payload = payload;
  }
}

const build = (code: ReaErrorCode, category: ReaErrorCategory, retryable: boolean, message: string, details?: Record<string, unknown>, remediation?: string): ReaError =>
  new ReaError({
    code,
    category,
    message,
    retryable,
    remediation: { action: remediation ?? message },
    ...(details === undefined ? {} : { details }),
  });

export const invalidRequest = (message: string, details?: Record<string, unknown>): ReaError => build('invalid_request', 'invalid_input', true, message, details);

export const analysisInputInvalid = (operation: string, issues: readonly Record<string, unknown>[], extraDetails: Record<string, unknown> = {}): ReaError =>
  new ReaError({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'Analysis input is invalid. Check the arguments and try again.',
    retryable: false,
    remediation: {
      action: `Read the declared input schema or CLI usage for ${operation}; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.`,
    },
    recovery: { kind: 'inspect_input_contract', operation },
    details: { operation, issues, ...extraDetails },
  });

export const capabilityUnavailable = (message: string, details?: Record<string, unknown>, remediation?: string): ReaError => build('capability_unavailable', 'unsupported_provider', false, message, details, remediation);

export const unsupportedTarget = (message: string, details?: Record<string, unknown>, remediation?: string): ReaError => build('unsupported_target', 'unsupported_target', false, message, details, remediation);

export const unreadableOutput = (message: string, details?: Record<string, unknown>): ReaError => build('unreadable_output', 'execution_failure', false, message, details);

export const PWNTTOOLS_LINUX_X64_ONLY = 'The initial real-verified pwntools artifact profile supports Linux x64 only.';

export const pwntoolsHostSupported = (platform: NodeJS.Platform = process.platform, arch: string = process.arch): boolean => platform === 'linux' && arch === 'x64';

export const targetUnavailable = (message: string, details?: Record<string, unknown>, remediation?: string): ReaError => build('target_unavailable', 'unavailable', false, message, details, remediation);

export const providerUnavailable = (message: string, details?: Record<string, unknown>, remediation?: string): ReaError => build('provider_unavailable', 'unavailable', true, message, details, remediation);

export const evidenceIntegrityMismatch = (message: string, details?: Record<string, unknown>, remediation?: string): ReaError => build('evidence_integrity_mismatch', 'integrity_mismatch', false, message, details, remediation);

export const executionFailure = (message: string, details?: Record<string, unknown>, remediation?: string): ReaError => build('execution_failure', 'execution_failure', false, message, details, remediation);

export const resourceConstraint = (message: string, details?: Record<string, unknown>, remediation?: string): ReaError => build('resource_constraint', 'resource_constraint', false, message, details, remediation);

export const cancelled = (message: string, details?: Record<string, unknown>): ReaError => build('cancelled', 'cancelled', true, message, details);

export const revisionConflict = (message: string, details?: Record<string, unknown>): ReaError => build('revision_conflict', 'integrity_mismatch', true, message, details);
