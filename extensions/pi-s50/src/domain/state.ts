export const PHASES = [
  'START',
  'PREFLIGHT',
  'CLASSIFY',
  'CLARIFY',
  'DIAGNOSE',
  'EXPLICIT_TRIAGE',
  'EXPLICIT_ARCH_REVIEW',
  'DOMAIN',
  'ARCHITECT',
  'PROTOTYPE',
  'DESIGN',
  'CONFIRM_TDD_SEAMS',
  'BUILD_GRAPH',
  'IMPLEMENT',
  'INTEGRATE',
  'REVIEW',
  'VERIFY',
  'FREEZE_REVISION',
  'REVERIFY_STALE',
  'PR_READY',
] as const;

export type Phase = (typeof PHASES)[number];

export const MODES = ['feature', 'bug', 'frontend', 'external_issue', 'architecture_survey'] as const;

export type Mode = (typeof MODES)[number];

export type Question = { readonly id: string; readonly title: string; readonly body: string; readonly recommendation: string };

export type Gate =
  | { readonly kind: 'user_workflow'; readonly skill: string; readonly action: string }
  | { readonly kind: 'missing_skill'; readonly skill: string; readonly install: string }
  | { readonly kind: 'decisions'; readonly questions: readonly Question[] }
  | { readonly kind: 'shared_understanding' }
  | { readonly kind: 'seam_confirmation'; readonly seams: readonly string[] }
  | { readonly kind: 'authorization'; readonly action: AuthorizationAction; readonly scope: string };

export const AUTHORIZATION_ACTIONS = [
  'force_push',
  'merge',
  'deploy',
  'destructive_data_deletion',
  'public_message',
  'customer_communication',
  'sensitive_data_disclosure',
  'irreversible_action',
] as const;

export type AuthorizationAction = (typeof AUTHORIZATION_ACTIONS)[number];

export type RunStatus =
  | { readonly kind: 'active' }
  | { readonly kind: 'blocked'; readonly gate: Gate }
  | { readonly kind: 'inconclusive'; readonly missing: string }
  | { readonly kind: 'pr_ready'; readonly revision: string };
