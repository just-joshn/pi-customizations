/** Pi `ModelRouteReason` values the maintainer router distinguishes for entry policy. */
export type RouteReason = 'user' | 'continuation' | 'retry' | 'direct';

/**
 * Aider `run_stream` sends one request without `preproc_user_input` or the `run_one` reflection
 * loop. Pi maps that entry to virtual-model route reason `direct` (outside the agent loop).
 */
export function routeEntryActions(reason: RouteReason): {
  readonly bindExchange: boolean;
  readonly preprocessMentions: boolean;
} {
  if (reason === 'direct') return { bindExchange: false, preprocessMentions: false };
  return { bindExchange: true, preprocessMentions: reason === 'user' };
}
