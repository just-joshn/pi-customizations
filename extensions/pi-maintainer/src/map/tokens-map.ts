import type { MapRequest, RepositoryContext } from '../feature.ts';

/**
 * `/tokens` repository-map path: call RepoMap once with editable files as chat,
 * omitting in-repo read-only partitioning into chat, mention hints, and wrapper fallbacks
 * (`aider/commands.py:472-478`).
 */
export async function tokensRepoMapContent(input: { readonly editable: ReadonlySet<string>; readonly allAbsFiles: readonly string[]; readonly map: RepositoryContext; readonly signal?: AbortSignal }): Promise<string | null> {
  const chatFiles = new Set(input.editable);
  const otherFiles = new Set(input.allAbsFiles.filter((path) => !chatFiles.has(path)));
  const request: MapRequest = {
    chatFiles,
    otherFiles,
    mentionedFnames: new Set(),
    mentionedIdents: new Set(),
  };
  return input.map.repoMap(request, input.signal);
}

/** One `/tokens` row for the repository map section. */
export function formatRepositoryMapTokenLine(input: { readonly tokens: number; readonly labelWidth: number }): string {
  const label = 'repository map'.padEnd(input.labelWidth);
  return `${String(input.tokens).padStart(8)} ${label} use --map-tokens to resize`;
}
