import type { Mode, Phase } from '../domain/state.ts';

export function classify(mode: Mode): Phase {
  switch (mode) {
    case 'feature':
    case 'frontend':
      return 'CLARIFY';
    case 'bug':
      return 'DIAGNOSE';
    case 'external_issue':
      return 'EXPLICIT_TRIAGE';
    case 'architecture_survey':
      return 'EXPLICIT_ARCH_REVIEW';
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export const CHECK_KINDS = ['typecheck', 'unit_test', 'integration_test', 'consumer', 'review', 'design', 'architecture', 'seam', 'stale_evidence'] as const;

export type CheckKind = (typeof CHECK_KINDS)[number];

const FAILURE_OWNERS: { readonly [K in CheckKind]: Phase } = {
  typecheck: 'IMPLEMENT',
  unit_test: 'IMPLEMENT',
  integration_test: 'IMPLEMENT',
  consumer: 'IMPLEMENT',
  review: 'IMPLEMENT',
  design: 'DESIGN',
  architecture: 'ARCHITECT',
  seam: 'CONFIRM_TDD_SEAMS',
  stale_evidence: 'REVERIFY_STALE',
};

export function failureOwner(check: CheckKind): Phase {
  return FAILURE_OWNERS[check];
}
