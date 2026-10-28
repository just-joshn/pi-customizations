import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import type { EvidenceRecord } from '../session/evidence.ts';
import { ReaError } from './errors.ts';

export const DEFAULT_RESPONSE_BUDGET_BYTES = 10_485_760;
const ENVELOPE_RESERVE_BYTES = 1024;

export const responseBudgetBytes = (environment: NodeJS.ProcessEnv = process.env): number => {
  const raw = environment['REA_MCP_MAX_RESPONSE_BYTES'];
  if (raw === undefined) return DEFAULT_RESPONSE_BUDGET_BYTES;
  if (!/^[0-9]+$/.test(raw)) {
    throw new ReaError({
      code: 'configuration_invalid',
      category: 'invalid_input',
      message: `REA_MCP_MAX_RESPONSE_BYTES must be a safe decimal integer of at least ${DEFAULT_RESPONSE_BUDGET_BYTES}.`,
      retryable: false,
      remediation: { action: `Set REA_MCP_MAX_RESPONSE_BYTES to a decimal integer of at least ${DEFAULT_RESPONSE_BUDGET_BYTES}.` },
      details: { setting: 'REA_MCP_MAX_RESPONSE_BYTES', value: raw },
    });
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < DEFAULT_RESPONSE_BUDGET_BYTES) {
    throw new ReaError({
      code: 'configuration_invalid',
      category: 'invalid_input',
      message: `REA_MCP_MAX_RESPONSE_BYTES must be a safe decimal integer of at least ${DEFAULT_RESPONSE_BUDGET_BYTES}.`,
      retryable: false,
      remediation: { action: `Set REA_MCP_MAX_RESPONSE_BYTES to a decimal integer of at least ${DEFAULT_RESPONSE_BUDGET_BYTES}.` },
      details: { setting: 'REA_MCP_MAX_RESPONSE_BYTES', value: raw },
    });
  }
  return value;
};

export const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8');

const snapshotDetail = (details: object | undefined, provenance: boolean): Record<string, unknown> | undefined => {
  if (details === undefined) return provenance ? { provenance: { untrusted_content: true, source: 'analysis_target' } } : undefined;
  return provenance ? { ...(details as Record<string, unknown>), provenance: { untrusted_content: true, source: 'analysis_target' } } : (details as Record<string, unknown>);
};

const budgetBytes = (): number => responseBudgetBytes() - ENVELOPE_RESERVE_BYTES;

const truncated = (requiredBytes: number, guidance: string): Record<string, unknown> => ({
  truncated: true,
  response_budget_bytes: budgetBytes(),
  required_bytes: requiredBytes,
  guidance,
});

export const operationResult = (payload: unknown, options: { readonly details?: Record<string, unknown>; readonly provenance?: boolean } = {}): AgentToolResult<unknown> => {
  const body = JSON.stringify({ result: payload });
  const details = snapshotDetail(options.details, options.provenance === true);
  if (byteLength(body) > budgetBytes()) {
    const marker = truncated(byteLength(body), 'The complete payload was not returned because it exceeds the response budget. Narrow the request with its view or page parameters and retry, or raise REA_MCP_MAX_RESPONSE_BYTES.');
    const truncatedBody = JSON.stringify({ result: marker });
    return {
      content: [{ type: 'text', text: truncatedBody }],
      structuredContent: asStructuredContent(truncatedBody),
      details: details ?? {},
    };
  }
  return {
    content: [{ type: 'text', text: body }],
    structuredContent: asStructuredContent(body),
    details: details ?? {},
  };
};

const asStructuredContent = (body: string): NonNullable<AgentToolResult<unknown>['structuredContent']> => JSON.parse(body) as NonNullable<AgentToolResult<unknown>['structuredContent']>;

export const evidenceResult = (record: EvidenceRecord): AgentToolResult<unknown> => {
  const body = JSON.stringify(record);
  if (byteLength(body) > budgetBytes()) {
    const marker = truncated(byteLength(body), `Evidence ${record.evidence_id} is retained in this session. Call export_evidence_bundle, then read the exported bundle in pages, or raise REA_MCP_MAX_RESPONSE_BYTES.`);
    const truncatedBody = JSON.stringify(marker);
    return {
      content: [{ type: 'text', text: truncatedBody }],
      structuredContent: asStructuredContent(truncatedBody),
      details: { evidence: record, truncated: true, provenance: { untrusted_content: true, source: 'analysis_target' } },
    };
  }
  return {
    content: [{ type: 'text', text: body }],
    structuredContent: asStructuredContent(body),
    details: { evidence: record, provenance: { untrusted_content: true, source: 'analysis_target' } },
  };
};

export const configurationResult = (payload: unknown): AgentToolResult<unknown> => {
  const body = JSON.stringify(payload);
  if (byteLength(body) > budgetBytes()) {
    const marker = truncated(byteLength(body), 'The complete payload was not returned because it exceeds the response budget. Narrow the request and retry, or raise REA_MCP_MAX_RESPONSE_BYTES.');
    const truncatedBody = JSON.stringify(marker);
    return {
      content: [{ type: 'text', text: truncatedBody }],
      structuredContent: asStructuredContent(truncatedBody),
      details: {},
    };
  }
  return {
    content: [{ type: 'text', text: body }],
    structuredContent: asStructuredContent(body),
    details: {},
  };
};

export const errorResult = (error: unknown): AgentToolResult<unknown> => {
  const payload =
    error instanceof ReaError
      ? error.payload
      : {
          code: 'execution_failure' as const,
          category: 'execution_failure' as const,
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
          remediation: { action: error instanceof Error ? error.message : String(error) },
        };
  return { content: [{ type: 'text', text: JSON.stringify({ error: payload }) }], details: {}, isError: true };
};
