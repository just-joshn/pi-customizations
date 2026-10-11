/** Aider `Model.get_repo_map_tokens` (`aider/models.py:782-789`). */
export function getRepoMapTokens(maxInputTokens: number | null | undefined): number {
  if (!maxInputTokens) return 1024;
  const eighth = maxInputTokens / 8;
  return Math.min(4096, Math.max(1024, eighth));
}

/**
 * Enablement from explicit `--map-tokens` vs model `use_repo_map`.
 * Explicit positive budgets enable even when model policy disables mapping.
 */
export function resolveMapEnablement(input: { readonly explicit: number | null; readonly useRepoMap: boolean; readonly maxInputTokens: number | null }): { readonly enabled: boolean; readonly tokens: number } {
  if (input.explicit !== null) {
    return { enabled: input.explicit > 0, tokens: Math.max(0, input.explicit) };
  }
  const tokens = getRepoMapTokens(input.maxInputTokens);
  return { enabled: input.useRepoMap, tokens };
}

/** RepoMap class default for `map_mul_no_files` (`aider/repomap.py:56`). CLI default is 2. */
export const REPO_MAP_CLASS_DEFAULT_MUL = 8;

/**
 * Effective token budget after context-mode multiply and empty-chat expansion
 * (`aider/repomap.py:119-132`, `aider/coders/context_coder.py:17-19`).
 */
export function effectiveMapBudget(input: { readonly maxMapTokens: number; readonly mapMulNoFiles: number; readonly maxContextWindow: number | null; readonly chatFilesEmpty: boolean; readonly expandNoFilesBudget: boolean }): number {
  let tokens = input.maxMapTokens;
  let mul = input.mapMulNoFiles;
  if (input.expandNoFilesBudget) {
    tokens *= mul;
    mul = 1;
  }
  if (!input.chatFilesEmpty || !input.maxContextWindow) return tokens;
  const padding = 4096;
  const target = Math.min(Math.trunc(tokens * mul), input.maxContextWindow - padding);
  return target > 0 ? target : tokens;
}
