import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import type { EvidenceRecord } from '../session/evidence.ts';
import { ReaError, resourceConstraint } from './errors.ts';

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

export const operationResult = (payload: unknown, options: { readonly details?: Record<string, unknown>; readonly provenance?: boolean } = {}): AgentToolResult<unknown> => {
  const body = JSON.stringify({ result: payload });
  const budget = responseBudgetBytes() - ENVELOPE_RESERVE_BYTES;
  if (byteLength(body) > budget) throw oversized(body);
  const details = snapshotDetail(options.details, options.provenance === true);
  return {
    content: [{ type: 'text', text: body }],
    structuredContent: asStructuredContent(body),
    details: details ?? {},
  };
};

const asStructuredContent = (body: string): NonNullable<AgentToolResult<unknown>['structuredContent']> => JSON.parse(body) as NonNullable<AgentToolResult<unknown>['structuredContent']>;

export const evidenceResult = (record: EvidenceRecord): AgentToolResult<unknown> => {
  const body = JSON.stringify(record);
  const budget = responseBudgetBytes() - ENVELOPE_RESERVE_BYTES;
  if (byteLength(body) > budget) throw oversized(body);
  return {
    content: [{ type: 'text', text: body }],
    structuredContent: asStructuredContent(body),
    details: { provenance: { untrusted_content: true, source: 'analysis_target' } },
  };
};

export const configurationResult = (payload: unknown): AgentToolResult<unknown> => {
  const body = JSON.stringify(payload);
  const budget = responseBudgetBytes() - ENVELOPE_RESERVE_BYTES;
  if (byteLength(body) > budget) throw oversized(body);
  return {
    content: [{ type: 'text', text: body }],
    structuredContent: asStructuredContent(body),
    details: {},
  };
};

const oversized = (body: string): ReaError =>
  resourceConstraint(
    `The response is ${byteLength(body)} bytes and does not fit the ${responseBudgetBytes()} byte response budget. Export the complete session with export_evidence_bundle and read it in pages, or raise REA_MCP_MAX_RESPONSE_BYTES.`,
    {
      resource: 'transport',
      reported_limits: { response_budget_bytes: responseBudgetBytes(), required_bytes: byteLength(body) },
    },
  );

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
