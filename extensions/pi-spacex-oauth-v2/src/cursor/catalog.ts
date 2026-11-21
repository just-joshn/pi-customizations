import { Cursor, type SDKModel } from '@cursor/sdk';
import type { CatalogSource } from '../catalog.ts';
import { createCell, withEntry, withoutKeys } from '../cell.ts';
import type { ChatModelConfig } from '../stored-models.ts';
import { CURSOR_CONFIG, cursorApiKey } from './config.ts';
import { toPiModel } from './models.ts';

// Composer until the first live refresh replaces the list with Cursor.models.list().
const FALLBACK_MODELS: ChatModelConfig[] = [toPiModel({ id: 'composer-2.5', displayName: 'Composer 2.5' })];

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

/** A refresh always asks Cursor again, so it drops the list a run may have cached for this key. */
async function fetchLiveModels(apiKey: string): Promise<ChatModelConfig[]> {
  catalogs.write(withoutKeys(catalogs.read(), [apiKey]));
  return (await listCursorModels(apiKey)).map(toPiModel);
}

export const cursorCatalog: CatalogSource = {
  target: { provider: CURSOR_CONFIG.providerId, api: CURSOR_CONFIG.api, baseUrl: CURSOR_CONFIG.baseUrl },
  fallback: FALLBACK_MODELS,
  apiKey: cursorApiKey,
  fetchLive: fetchLiveModels,
};
