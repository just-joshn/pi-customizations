/** One tree-sitter capture node after UTF-8 decode (`aider/repomap.py:328-334`). */
export interface CaptureNode {
  readonly text: string;
  readonly startLine: number;
}

/** Capture tag name to nodes, matching tree-sitter `captures` map shape. */
export type Captures = Readonly<Record<string, readonly CaptureNode[]>>;

/**
 * Outcome of running a tags query. Parser and query failures stay in-band so Julia
 * incompatibilities degrade instead of aborting the map (`map.query.julia-compat`).
 */
export type CaptureOutcome =
  | { readonly kind: 'ok'; readonly captures: Captures }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'query-error'; readonly message: string };

/**
 * Process-local parsers and query execution. Production stays unavailable until
 * tree-sitter recovery accepts a bridge (`docs/verification/tree-sitter-recovery-2026-10-10.md`).
 */
export interface QueryRuntime {
  languageFor(fname: string): string | null;
  capture(input: { readonly lang: string; readonly code: string; readonly queryScm: string }): CaptureOutcome;
}

/** Default runtime: no language, no captures. Filename maps still work without semantic tags. */
export const unavailableQueryRuntime: QueryRuntime = {
  languageFor: () => null,
  capture: () => ({ kind: 'unavailable' }),
};
