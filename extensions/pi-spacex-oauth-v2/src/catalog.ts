import type { RefreshModelsContext } from '@earendil-works/pi-ai';
import { type ChatModelConfig, type ModelTarget, readStoredModels, toStoredModels } from './stored-models.ts';

/**
 * Fetches the live model list when pi allows network access and persists it, so print mode and
 * offline starts (which refresh without network) still see every model from the last live fetch.
 */
export async function refreshCatalog(ctx: RefreshModelsContext, target: ModelTarget, fallback: ChatModelConfig[], fetchLive: (accessToken: string, signal: AbortSignal) => Promise<ChatModelConfig[]>): Promise<ChatModelConfig[]> {
  const stored = readStoredModels(ctx.stored);
  if (!ctx.allowNetwork || ctx.credential?.type !== 'oauth') return stored ?? fallback;
  const models = await fetchLive(ctx.credential.access, ctx.signal);
  await ctx.publish({ persist: { models: toStoredModels(target, models), checkedAt: Date.now() } });
  return models;
}
