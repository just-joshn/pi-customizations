import { Cursor, type SDKModel } from '@cursor/sdk';
import type { AnyModel, RefreshModelsContext } from '@earendil-works/pi-ai';
import type { ProviderModelConfig } from '@earendil-works/pi-coding-agent';
import { createCell, withEntry, withoutKeys } from '../cell.ts';
import { CURSOR_CONFIG, cursorApiKey } from './config.ts';
import { toPiModel } from './models.ts';

// Composer until the first live refresh replaces the list with Cursor.models.list().
export const FALLBACK_MODELS: ProviderModelConfig[] = [toPiModel({ id: 'composer-2.5', displayName: 'Composer 2.5' })];

// One catalog request per API key per process, as the SDK docs recommend.
const catalogs = createCell(new Map<string, Promise<SDKModel[]>>());

export function listCursorModels(apiKey: string | undefined): Promise<SDKModel[]> {
  const key = apiKey ?? '';
  const cached = catalogs.read().get(key);
  if (cached !== undefined) return cached;
  const request = Cursor.models.list(apiKey ? { apiKey } : {});
  catalogs.write(withEntry(catalogs.read(), key, request));
  request.catch(() => catalogs.write(withoutKeys(catalogs.read(), [key])));
  return request;
}

/** The catalog entry for a model id or alias, or undefined when the catalog cannot be read. */
export async function findCursorModel(apiKey: string | undefined, modelId: string): Promise<SDKModel | undefined> {
  const models = await listCursorModels(apiKey).catch((error: unknown) => {
    console.error('Cursor model catalog lookup failed:', error);
    return [];
  });
  return models.find((m) => m.id === modelId || m.aliases?.includes(modelId));
}

/** Live models when Pi allows network access, persisted so offline starts list the same models. */
export async function refreshCursorModels(ctx: RefreshModelsContext): Promise<ProviderModelConfig[]> {
  const stored = ctx.stored?.models as ProviderModelConfig[] | undefined;
  const apiKey = cursorApiKey(ctx.credential);
  if (!ctx.allowNetwork || !apiKey) return stored ?? FALLBACK_MODELS;
  catalogs.write(withoutKeys(catalogs.read(), [apiKey]));
  const models = (await listCursorModels(apiKey)).map(toPiModel);
  const target = { provider: CURSOR_CONFIG.providerId, api: CURSOR_CONFIG.api, baseUrl: CURSOR_CONFIG.baseUrl };
  await ctx.publish({ persist: { models: models.map((m) => ({ ...target, ...m }) as unknown as AnyModel), checkedAt: Date.now() } });
  return models;
}
