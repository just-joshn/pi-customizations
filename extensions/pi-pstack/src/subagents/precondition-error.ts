import type { AgentTypeErrorCode, Refusal } from './types.ts';

export class AgentPreconditionError extends Error {
  readonly code: Refusal['code'];

  constructor(refusal: Refusal) {
    super(refusal.message);
    this.name = 'AgentPreconditionError';
    this.code = refusal.code;
  }
}

export class AgentTypeError extends Error {
  readonly code: AgentTypeErrorCode;

  constructor(refusal: { code: AgentTypeErrorCode; message: string }) {
    super(refusal.message);
    this.name = 'AgentTypeError';
    this.code = refusal.code;
  }
}
