import type { HostCapabilities } from '../domain/run.ts';

export const REVIEW_DIMENSIONS = [
  'correctness_and_acceptance_criteria',
  'domain_invariants',
  'authorization_and_data_integrity',
  'error_handling',
  'concurrency',
  'migration_safety',
  'architecture_and_module_depth',
  'caller_knowledge',
  'duplicate_domain_knowledge',
  'test_quality_and_confirmed_seams',
  'reader_load',
  'dead_or_replaced_code',
] as const;

const WEB_UI_REVIEW_DIMENSIONS = ['frontend_design_contract', 'web_design_guidelines', 'agent_browser_verification', 'vercel_react_best_practices'] as const;

export type ReviewAssurance = { readonly kind: 'independent' } | { readonly kind: 'reduced'; readonly reason: string };

export type Reviewer = { readonly independent: boolean; readonly authored: boolean };

export function reviewAssurance(capabilities: HostCapabilities, reviewer: Reviewer = { independent: true, authored: false }): ReviewAssurance {
  if (!capabilities.independentAgents) return { kind: 'reduced', reason: 'same-agent read-only review; no independent agents' };
  if (!reviewer.independent) return { kind: 'reduced', reason: 'reviewer did not run as a fresh independent agent' };
  if (reviewer.authored) return { kind: 'reduced', reason: 'reviewer wrote or integrated this revision' };
  return { kind: 'independent' };
}

export type ReviewSurface = { readonly kind: 'non_web' } | { readonly kind: 'web_ui'; readonly react: boolean };

export function reviewDimensions(surface: ReviewSurface): readonly string[] {
  if (surface.kind === 'non_web') return REVIEW_DIMENSIONS;
  const web = surface.react ? WEB_UI_REVIEW_DIMENSIONS : WEB_UI_REVIEW_DIMENSIONS.filter((dimension) => dimension !== 'vercel_react_best_practices');
  return [...REVIEW_DIMENSIONS, ...web];
}
