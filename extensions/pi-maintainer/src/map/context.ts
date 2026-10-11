import { accessSync, constants } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { MapRequest, RepositoryContext } from '../feature.ts';
import { effectiveMapBudget, resolveMapEnablement } from './budget.ts';
import { getRankedTags, prependImportantFiles } from './rank.ts';
import { renderRankedMap } from './render.ts';
import { type MapRefresh, type RenderedMapState, renderedCacheKey } from './rendered-cache.ts';
import { selectRankedPrefix } from './sampled-prefix.ts';
import type { Tag } from './tag.ts';
import { createTagsCache, getCachedTags, type TagCacheStore } from './tags-cache.ts';

export type { MapRefresh };

export interface MapRuntimeSnapshot {
  readonly maxMapTokens: number;
  readonly mapMulNoFiles: number;
}

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
  readonly now?: () => number;
  readonly reportError?: (message: string) => void;
  readonly inspect?: (snapshot: MapRuntimeSnapshot) => void;
  readonly buildMap?: (input: { readonly request: MapRequest; readonly budget: number; readonly chatRel: ReadonlySet<string>; readonly otherRel: readonly string[] }) => Promise<string | null>;
  readonly tagsCache?: TagCacheStore;
  readonly tokenCount?: (text: string) => number;
}

function relFname(root: string, fname: string): string {
  try {
    const relativePath = relative(root, fname);
    return relativePath === '' ? '.' : relativePath;
  } catch {
    return fname;
  }
}

function fileExists(absPath: string): boolean {
  try {
    accessSync(absPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isRecursionError(error: unknown): boolean {
  return error instanceof RangeError || (error instanceof Error && error.name === 'RecursionError');
}

type MapBuildInput = { readonly request: MapRequest; readonly budget: number; readonly chatRel: ReadonlySet<string>; readonly otherRel: readonly string[] };

function defaultTagsCache(): TagCacheStore {
  return createTagsCache({
    openPersistent: () => {
      const data = new Map<string, { mtime: number; data: readonly Tag[] }>();
      return {
        get: (key) => data.get(key),
        set: (key, value) => {
          data.set(key, value);
        },
      };
    },
  });
}

/** Cached tags for a file, or null when the file is missing. */
async function cachedTagsFor(tagsCache: TagCacheStore, abs: string): Promise<readonly Tag[] | null> {
  try {
    const mtime = (await stat(abs)).mtimeMs;
    return getCachedTags(tagsCache, abs, mtime, () => []);
  } catch {
    return null;
  }
}

/** A reusable rendered map for this refresh policy, or undefined to rebuild. */
function cachedMap(rendered: RenderedMapState, refresh: string, key: string): string | null | undefined {
  if (refresh === 'manual' && rendered.lastMap !== null) return rendered.lastMap;
  const useCache = refresh === 'files' || (refresh === 'auto' && rendered.mapProcessingTime > 1.0);
  if (refresh !== 'always' && useCache && rendered.mapCache.has(key)) return rendered.mapCache.get(key) ?? null;
  return undefined;
}

async function buildDefaultMap(config: RepositoryContextConfig, tagsCache: TagCacheStore, tokenCount: (text: string) => number, input: MapBuildInput): Promise<string | null> {
  const tagsByAbsPath = new Map<string, readonly Tag[]>();
  for (const abs of input.request.otherFiles) {
    const tags = await cachedTagsFor(tagsCache, abs);
    if (tags !== null) tagsByAbsPath.set(abs, tags);
  }
  const ranked = prependImportantFiles(
    getRankedTags({
      chatFnames: [...input.request.chatFiles],
      otherFnames: [...input.request.otherFiles],
      mentionedFnames: input.request.mentionedFnames,
      mentionedIdents: input.request.mentionedIdents,
      tagsByAbsPath,
      getRelFname: (absPath) => relFname(config.root, absPath),
      fileExists,
    }),
    input.otherRel,
  );
  const body = selectRankedPrefix({
    ranked,
    maxMapTokens: input.budget,
    chatRelFnames: input.chatRel,
    tokenCount,
    render: (entries, chat) => renderRankedMap(entries, chat),
  });
  if (!body.trim()) return null;
  if (!config.repoContentPrefix) return body;
  const other = input.request.chatFiles.size > 0 ? 'other ' : '';
  return `${config.repoContentPrefix.replace('{other}', other)}${body}`;
}

/** Relative chat/other paths, the effective refresh policy, and the rendered-cache key for one request. */
function mapKey(config: RepositoryContextConfig, request: MapRequest, budget: number) {
  const refresh = request.refresh ?? config.mapRefresh;
  const chatRel = new Set([...request.chatFiles].map((path) => relFname(config.root, path)));
  const otherRel = [...request.otherFiles].map((path) => relFname(config.root, path));
  const key = renderedCacheKey({
    chatFiles: [...chatRel],
    otherFiles: otherRel,
    maxMapTokens: budget,
    refresh,
    mentionedFnames: [...request.mentionedFnames],
    mentionedIdents: [...request.mentionedIdents],
  });
  return { refresh, chatRel, otherRel, key };
}

/** Host/fs-backed `RepositoryContext` with rank, caches, sampled prefix, and fail paths. */
export function createRepositoryContext(config: RepositoryContextConfig): RepositoryContext {
  const enablement = resolveMapEnablement({ explicit: config.mapTokens, useRepoMap: config.useRepoMap, maxInputTokens: config.maxInputTokens });

  let maxMapTokens = enablement.tokens;
  let mapMulNoFiles = config.mapMulNoFiles;
  let enabled = enablement.enabled;
  const tagsCache = config.tagsCache ?? defaultTagsCache();
  const rendered: RenderedMapState = { mapCache: new Map(), lastMap: null, mapProcessingTime: 0 };
  const now = config.now ?? (() => Date.now() / 1000);
  const tokenCount = config.tokenCount ?? ((text: string) => Math.ceil(text.length / 4));

  return {
    async repoMap(request: MapRequest, signal?: AbortSignal): Promise<string | null> {
      signal?.throwIfAborted();
      if (!enabled || maxMapTokens <= 0 || request.otherFiles.size === 0) return null;

      if (request.expandNoFilesBudget) {
        maxMapTokens *= mapMulNoFiles;
        mapMulNoFiles = 1;
      }
      config.inspect?.({ maxMapTokens, mapMulNoFiles });

      const budget = effectiveMapBudget({
        maxMapTokens,
        mapMulNoFiles,
        maxContextWindow: config.maxContextWindow,
        chatFilesEmpty: request.chatFiles.size === 0,
        expandNoFilesBudget: false,
      });
      if (budget <= 0) return null;

      const { refresh, chatRel, otherRel, key } = mapKey(config, request, budget);

      const cached = request.forceRefresh === true ? undefined : cachedMap(rendered, refresh, key);
      if (cached !== undefined) return cached;

      const started = now();
      try {
        const builder = config.buildMap ?? ((input: MapBuildInput) => buildDefaultMap(config, tagsCache, tokenCount, input));
        const result = await builder({ request, budget, chatRel, otherRel });
        rendered.mapProcessingTime = now() - started;
        rendered.mapCache.set(key, result);
        rendered.lastMap = result;
        return result;
      } catch (error) {
        if (isRecursionError(error)) {
          config.reportError?.(error instanceof Error ? error.message : 'Disabling repo map, git repo too large?');
          maxMapTokens = 0;
          enabled = false;
          return null;
        }
        throw error;
      }
    },
  };
}

/** Cache directory name mirrors Aider's versioned tags cache path shape. */
export function tagsCacheDir(root: string, version = 4): string {
  return join(root, `.aider.tags.cache.v${version}`);
}
