import type { ProviderConfig } from '@earendil-works/pi-coding-agent';
import { refreshCatalog } from '../catalog.ts';
import { cursorLogin, cursorRefresh } from './auth.ts';
import { collapseModels, fetchCursorModels } from './models.ts';
import { AGENT_URL } from './run.ts';
import { streamCursor } from './stream.ts';

export const CURSOR_PROVIDER_ID = 'spacex-cursor';

// Composer and Auto until the first live refresh replaces the list with GetUsableModels.
const FALLBACK_MODELS = collapseModels([
  { modelId: 'composer-2.5', displayName: 'Composer 2.5' },
  { modelId: 'composer-2.5-fast', displayName: 'Composer 2.5 Fast' },
]);

export const cursorProvider: ProviderConfig = {
  name: 'Cursor (X subscription)',
  baseUrl: AGENT_URL,
  api: 'cursor-agent',
  streamSimple: streamCursor,
  models: FALLBACK_MODELS,
  refreshModels: (ctx) => refreshCatalog(ctx, { provider: CURSOR_PROVIDER_ID, api: 'cursor-agent', baseUrl: AGENT_URL }, FALLBACK_MODELS, fetchCursorModels),
  oauth: {
    name: 'Cursor (X subscription)',
    isSubscription: true,
    login: cursorLogin,
    refreshToken: cursorRefresh,
    getApiKey: (credentials) => credentials.access,
  },
};
