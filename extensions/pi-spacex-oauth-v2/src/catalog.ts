import type { Credential, RefreshModelsContext } from '@earendil-works/pi-ai';
import { type ChatModelConfig, type ModelTarget, readStoredModels, toStoredModels } from './stored-models.ts';

/** What one provider contributes to a model refresh. */
export interface CatalogSource {
  target: ModelTarget;
  /** The models Pi lists until a live refresh has been stored. */
  fallback: ChatModelConfig[];
  /** The key to fetch with, or undefined when the user is signed out. */
  apiKey: (credential: Credential | undefined) => string | undefined;
  fetchLive: (apiKey: string, signal: AbortSignal) => Promise<ChatModelConfig[]>;
}

/**
 * Fetches the live model list when pi allows network access and persists it, so print mode and
 * offline starts (which refresh without network) still see every model from the last live fetch.
 * A failed fetch keeps the stored list, so a bad network never empties the model picker.
 */
export async function refreshCatalog(ctx: RefreshModelsContext, source: CatalogSource): Promise<ChatModelConfig[]> {
  const offline = readStoredModels(ctx.stored) ?? source.fallback;
  const apiKey = source.apiKey(ctx.credential);
  if (!ctx.allowNetwork || !apiKey) return offline;
  const live = await source.fetchLive(apiKey, ctx.signal).catch((error: unknown) => {
    console.error(`Model refresh failed for ${source.target.provider}:`, error);
    return undefined;
  });
  if (!live) return offline;
  await ctx.publish({ persist: { models: toStoredModels(source.target, live), checkedAt: Date.now() } });
  return live;
}
