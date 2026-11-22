import { SUBAGENT_FAILURE_MESSAGES, type SubagentFailureCode } from './types.ts';

/** One error type for every failure a caller can branch on. The code is the contract. */
export class SubagentRunError extends Error {
  readonly code: SubagentFailureCode;

  constructor(code: SubagentFailureCode, detail?: string) {
    super(failureMessage(code, detail));
    this.name = 'SubagentRunError';
    this.code = code;
  }
}

export function failureMessage(code: SubagentFailureCode, detail?: string): string {
  const base = SUBAGENT_FAILURE_MESSAGES[code];
  return detail === undefined || detail.trim().length === 0 ? base : `${base}: ${detail}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function failureCode(error: unknown): SubagentFailureCode {
  return error instanceof SubagentRunError ? error.code : 'failed';
}
