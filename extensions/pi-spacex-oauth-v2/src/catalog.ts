import type { AnyModel, RefreshModelsContext } from '@earendil-works/pi-ai';
import type { ProviderModelConfig } from '@earendil-works/pi-coding-agent';

/**
 * Fetches the live model list when pi allows network access and persists it, so print mode and
 * offline starts (which refresh without network) still see every model from the last live fetch.
 */
export async function refreshCatalog(
  ctx: RefreshModelsContext,
  target: { provider: string; api: string; baseUrl: string },
  fallback: ProviderModelConfig[],
  fetchLive: (accessToken: string, signal: AbortSignal) => Promise<ProviderModelConfig[]>,
): Promise<ProviderModelConfig[]> {
  const stored = ctx.stored?.models as ProviderModelConfig[] | undefined;
  if (!ctx.allowNetwork || ctx.credential?.type !== 'oauth') return stored ?? fallback;
  const models = await fetchLive(ctx.credential.access, ctx.signal);
  const persisted = models.map((m) => ({ ...target, ...m }) as unknown as AnyModel);
  await ctx.publish({ persist: { models: persisted, checkedAt: Date.now() } });
  return models;
}
