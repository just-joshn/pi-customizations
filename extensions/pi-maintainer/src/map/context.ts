import { relative } from 'node:path';

import type { MapRequest, RepositoryContext } from '../feature.ts';
import { effectiveMapBudget, resolveMapEnablement } from './budget.ts';
import { filenameOnlyEntries } from './rank.ts';
import { renderRankedMap } from './render.ts';

export type MapRefresh = 'auto' | 'always' | 'files' | 'manual';

export interface RepositoryContextConfig {
  readonly root: string;
  readonly mapTokens: number | null;
  readonly useRepoMap: boolean;
  readonly maxInputTokens: number | null;
  readonly maxContextWindow: number | null;
  readonly mapMulNoFiles: number;
  readonly mapRefresh: MapRefresh;
  readonly repoContentPrefix: string | null;
  readonly readText: (absPath: string) => Promise<string | null>;
}

function relFname(root: string, fname: string): string {
  try {
    const relativePath = relative(root, fname);
    return relativePath === '' ? '.' : relativePath;
  } catch {
    return fname;
  }
}

/** Host/fs-backed `RepositoryContext` with tags+rank+render skeleton (filename map until tree-sitter lands). */
export function createRepositoryContext(config: RepositoryContextConfig): RepositoryContext {
  const enablement = resolveMapEnablement({
    explicit: config.mapTokens,
    useRepoMap: config.useRepoMap,
    maxInputTokens: config.maxInputTokens,
  });

  return {
    async repoMap(request: MapRequest, signal?: AbortSignal): Promise<string | null> {
      signal?.throwIfAborted();
      if (!enablement.enabled || enablement.tokens <= 0) return null;
      if (request.otherFiles.size === 0) return null;

      const budget = effectiveMapBudget({
        maxMapTokens: enablement.tokens,
        mapMulNoFiles: config.mapMulNoFiles,
        maxContextWindow: config.maxContextWindow,
        chatFilesEmpty: request.chatFiles.size === 0,
        expandNoFilesBudget: request.expandNoFilesBudget === true,
      });
      if (budget <= 0) return null;

      const chatRel = new Set([...request.chatFiles].map((path) => relFname(config.root, path)));
      const otherRel = [...request.otherFiles].map((path) => relFname(config.root, path));
      const ranked = filenameOnlyEntries(otherRel);
      const prefixLen = Math.min(Math.max(Math.trunc(budget / 25), 1), ranked.length);
      const body = renderRankedMap(ranked.slice(0, prefixLen), chatRel);
      if (!body.trim()) return null;

      if (config.repoContentPrefix) {
        const other = request.chatFiles.size > 0 ? 'other ' : '';
        return `${config.repoContentPrefix.replace('{other}', other)}${body}`;
      }
      return body;
    },
  };
}
