import type { Refusal } from './types.ts';

export class AgentPreconditionError extends Error {
  readonly code: Refusal['code'];

  constructor(refusal: Refusal) {
    super(refusal.message);
    this.name = 'AgentPreconditionError';
    this.code = refusal.code;
  }
}
