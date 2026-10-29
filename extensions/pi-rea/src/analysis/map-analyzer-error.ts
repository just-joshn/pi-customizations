import { capabilityUnavailable, ERROR_CATEGORIES, ERROR_CODES, invalidRequest, ReaError, type ReaErrorCategory, type ReaErrorCode, unsupportedTarget } from '../contract/errors.ts';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export const mapAnalyzerError: (error: unknown) => never = (error) => {
  if (error instanceof ReaError) throw error;

  if (isRecord(error) && error['name'] === 'IntegrityPolicyError') {
    throw new ReaError({
      code: 'artifact_integrity_mismatch',
      category: 'integrity_mismatch',
      message: typeof error['message'] === 'string' ? error['message'] : 'Artifact integrity check failed.',
      retryable: false,
      remediation: { action: 'Re-acquire the artifact, or retry with integrity_policy record-and-continue.' },
      details: { contradictions: error['contradictions'] ?? [] },
    });
  }

  if (isRecord(error) && (error['name'] === 'FormatError' || error['name'] === 'GoFormatError' || error['name'] === 'ArtifactFormatError' || error['name'] === 'AsarError' || error['name'] === 'HarError' || error['name'] === 'ZipError')) {
    throw unsupportedTarget(typeof error['message'] === 'string' ? error['message'] : 'Unsupported target format.', {
      code: error['code'] ?? null,
      offset: error['offset'] ?? null,
    });
  }

  if (isRecord(error) && typeof error['code'] === 'string' && typeof error['category'] === 'string') {
    const code = error['code'] as string;
    const category = error['category'] as string;
    if ((ERROR_CODES as readonly string[]).includes(code) && (ERROR_CATEGORIES as readonly string[]).includes(category)) {
      const remediation =
        isRecord(error['remediation']) && typeof error['remediation']['action'] === 'string'
          ? { action: error['remediation']['action'] }
          : { action: typeof error['message'] === 'string' ? error['message'] : 'Read the reported detail and retry.' };
      throw new ReaError({
        code: code as ReaErrorCode,
        category: category as ReaErrorCategory,
        message: typeof error['message'] === 'string' ? error['message'] : code,
        retryable: error['retryable'] === true,
        remediation,
        ...(isRecord(error['details']) ? { details: error['details'] } : {}),
      });
    }
  }

  if (isRecord(error) && typeof error['message'] === 'string') {
    throw invalidRequest(error['message']);
  }

  throw capabilityUnavailable('An absorbed analyzer failed without a recognizable error contract.', {
    reason: 'analyzer_error',
    error: error instanceof Error ? error.message : String(error),
  });
};
