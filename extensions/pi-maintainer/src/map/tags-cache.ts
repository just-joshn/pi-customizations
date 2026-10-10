import type { Tag } from './tag.ts';

export interface TagCacheEntry {
  readonly mtime: number;
  readonly data: readonly Tag[];
}

/** Minimal store matching diskcache get/set used by Aider's TAGS_CACHE. */
export interface TagCacheStore {
  get(key: string): TagCacheEntry | undefined;
  set(key: string, value: TagCacheEntry): void;
}

function memoryStore(): TagCacheStore {
  const data = new Map<string, TagCacheEntry>();
  return {
    get: (key) => data.get(key),
    set: (key, value) => {
      data.set(key, value);
    },
  };
}

/**
 * Open a tags cache the way `RepoMap.load_tags_cache` / `tags_cache_error` do
 * (`aider/repomap.py:177-230`): try persistent, recreate, then fall back to memory.
 */
export function createTagsCache(input: {
  readonly openPersistent: () => TagCacheStore;
  readonly recreatePersistent?: () => TagCacheStore;
  readonly warn?: (message: string) => void;
}): TagCacheStore {
  try {
    return input.openPersistent();
  } catch {
    // continue to recreate / memory
  }
  try {
    if (input.recreatePersistent) return input.recreatePersistent();
  } catch {
    input.warn?.('Unable to use tags cache, falling back to memory cache');
  }
  return memoryStore();
}

/** Reuse tags only when fname+mtime match; replace the entry after a miss. */
export function getCachedTags(cache: TagCacheStore, fname: string, mtime: number, load: () => readonly Tag[]): readonly Tag[] {
  const hit = cache.get(fname);
  if (hit && hit.mtime === mtime) return hit.data;
  const data = load();
  cache.set(fname, { mtime, data });
  return data;
}
