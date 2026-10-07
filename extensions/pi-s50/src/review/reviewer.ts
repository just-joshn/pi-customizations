import type { HostCapabilities } from '../domain/run.ts';

export const REVIEW_DIMENSIONS = ['correctness', 'security', 'privacy', 'performance', 'reliability', 'concurrency', 'data_integrity', 'api_contract', 'error_handling', 'test_quality', 'maintainability', 'compatibility'] as const;

export const WEB_UI_REVIEW_DIMENSIONS = ['accessibility', 'responsive_layout', 'interaction_states', 'web_guidelines'] as const;

export type ReviewAssurance = { readonly kind: 'independent' } | { readonly kind: 'reduced'; readonly reason: string };

export function reviewAssurance(capabilities: HostCapabilities): ReviewAssurance {
  return capabilities.independentAgents ? { kind: 'independent' } : { kind: 'reduced', reason: 'same-agent read-only review; no independent agents' };
}

export function reviewDimensions(webUi: boolean): readonly string[] {
  return webUi ? [...REVIEW_DIMENSIONS, ...WEB_UI_REVIEW_DIMENSIONS] : REVIEW_DIMENSIONS;
}
