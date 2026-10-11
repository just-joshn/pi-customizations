export type MapRefresh = 'auto' | 'always' | 'files' | 'manual';

export type RenderedCacheKey = readonly [chat: string | null, other: string | null, tokens: number, mentionedFnames?: string | null, mentionedIdents?: string | null];

export interface RenderedMapState {
  mapCache: Map<string, string | null>;
  lastMap: string | null;
  mapProcessingTime: number;
}

export function renderedCacheKey(input: {
  readonly chatFiles: readonly string[];
  readonly otherFiles: readonly string[];
  readonly maxMapTokens: number;
  readonly refresh: MapRefresh;
  readonly mentionedFnames: readonly string[];
  readonly mentionedIdents: readonly string[];
}): string {
  const base: Array<string | number | null> = [input.chatFiles.length ? [...input.chatFiles].sort().join('\0') : null, input.otherFiles.length ? [...input.otherFiles].sort().join('\0') : null, input.maxMapTokens];
  if (input.refresh === 'auto') {
    base.push(input.mentionedFnames.length ? [...input.mentionedFnames].sort().join('\0') : null);
    base.push(input.mentionedIdents.length ? [...input.mentionedIdents].sort().join('\0') : null);
  }
  return JSON.stringify(base);
}

/**
 * Aider `get_ranked_tags_map` refresh policy (`aider/repomap.py:576-627`).
 * File mtimes are never part of the key.
 */
export function resolveRenderedMap(input: {
  readonly state: RenderedMapState;
  readonly refresh: MapRefresh;
  readonly forceRefresh: boolean;
  readonly key: string;
  readonly build: () => string | null;
  readonly elapsedSeconds: (run: () => string | null) => { readonly result: string | null; readonly seconds: number };
}): string | null {
  const { state, refresh, forceRefresh, key } = input;
  if (!forceRefresh) {
    if (refresh === 'manual' && state.lastMap !== null) return state.lastMap;
    const useCache = refresh === 'files' || (refresh === 'auto' && state.mapProcessingTime > 1.0);
    if (refresh !== 'always' && useCache && state.mapCache.has(key)) {
      return state.mapCache.get(key) ?? null;
    }
  }
  const { result, seconds } = input.elapsedSeconds(input.build);
  state.mapProcessingTime = seconds;
  state.mapCache.set(key, result);
  state.lastMap = result;
  return result;
}
