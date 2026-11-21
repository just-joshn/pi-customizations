import type { ProviderConfig } from '@earendil-works/pi-coding-agent';
import { refreshCatalog } from '../catalog.ts';
import { loginCursor, refreshCursorKey } from './auth.ts';
import { cursorCatalog } from './catalog.ts';
import { CURSOR_CONFIG } from './config.ts';
import { streamCursor } from './stream.ts';

export const CURSOR_PROVIDER_ID = CURSOR_CONFIG.providerId;

export const cursorProvider: ProviderConfig = {
  name: CURSOR_CONFIG.name,
  baseUrl: CURSOR_CONFIG.baseUrl,
  apiKey: `$${CURSOR_CONFIG.apiKeyEnv}`,
  api: CURSOR_CONFIG.api,
  models: cursorCatalog.fallback,
  refreshModels: (ctx) => refreshCatalog(ctx, cursorCatalog),
  oauth: {
    name: CURSOR_CONFIG.name,
    isSubscription: true,
    login: loginCursor,
    refreshToken: refreshCursorKey,
    getApiKey: (credentials) => credentials.access,
  },
  streamSimple: streamCursor,
};
