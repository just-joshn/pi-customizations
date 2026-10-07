import type { VerificationMethod } from './graph.ts';

export const EVIDENCE_STATES = ['MEASURED', 'INFERRED', 'UNKNOWN', 'INCONCLUSIVE', 'STALE', 'FAILED'] as const;

export type EvidenceState = (typeof EVIDENCE_STATES)[number];

export type EvidenceRecord = {
  readonly id: string;
  readonly claim: string;
  readonly criterion: string;
  readonly state: EvidenceState;
  readonly revision: string;
  readonly dependencies: readonly string[];
  readonly method: VerificationMethod;
  readonly expected: string;
  readonly observed: string;
  readonly artifact: string;
  readonly recordedAt: string;
  readonly supersedes: string | null;
};
