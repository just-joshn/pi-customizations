import type { Model } from '@earendil-works/pi-ai';

export const CURSOR_PROVIDER_ID = 'cursor';
export const CURSOR_PROVIDER_NAME = 'Cursor (The X Subscription)';
export const CURSOR_API = 'cursor-agent';
export const CURSOR_BASE_URL = 'https://api2.cursor.sh';
export const USABLE_MODELS_PATH = '/aiserver.v1.AiService/GetUsableModels';
export const CURSOR_CLIENT_VERSION = 'cli-2026.11.05-86047df';
export const CURSOR_CONTEXT_WINDOW = 200_000;
export const CURSOR_LOGIN_HINT = 'Cursor is not logged in. Run /login and choose Cursor.';

export function cursorRejectedSession(status: number): string {
  return `Cursor rejected the session (HTTP ${status}). Run /login and choose Cursor.`;
}
export const CURSOR_BIN_HINT = 'cursor-agent is not installed. Install the Cursor CLI, then run cursor-agent login.';

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export type CursorModel = {
  readonly id: string;
  readonly name: string;
};

export const BASELINE: readonly CursorModel[] = [{ id: 'composer-2.5', name: 'Composer 2.5' }];

export type CatalogParse = { readonly kind: 'ok'; readonly models: readonly CursorModel[] } | { readonly kind: 'unreadable' };

export function usableModelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${USABLE_MODELS_PATH}`;
}

export function cursorCatalogHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Connect-Protocol-Version': '1',
    'x-cursor-client-type': 'cli',
    'x-cursor-client-version': CURSOR_CLIENT_VERSION,
    'x-ghost-mode': 'false',
  };
}

function displayName(row: { readonly modelId: string; readonly displayName?: unknown }): string {
  if (typeof row.displayName === 'string' && row.displayName.trim().length > 0 && !/\p{Cc}/u.test(row.displayName)) return row.displayName;
  return row.modelId;
}

export function parseUsableModels(body: unknown): CatalogParse {
  if (!body || typeof body !== 'object' || !('models' in body) || !Array.isArray(body.models)) return { kind: 'unreadable' };
  const models: CursorModel[] = [];
  const seen = new Set<string>();
  for (const row of body.models) {
    if (!row || typeof row !== 'object' || !('modelId' in row) || typeof row.modelId !== 'string') continue;
    if (!MODEL_ID.test(row.modelId) || seen.has(row.modelId)) continue;
    seen.add(row.modelId);
    models.push({ id: row.modelId, name: displayName(row) });
  }
  return { kind: 'ok', models };
}

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function toPiModel(model: CursorModel, baseUrl: string = CURSOR_BASE_URL): Model<typeof CURSOR_API> {
  return {
    id: model.id,
    name: model.name,
    api: CURSOR_API,
    provider: CURSOR_PROVIDER_ID,
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: ZERO_COST,
    contextWindow: CURSOR_CONTEXT_WINDOW,
    maxTokens: CURSOR_CONTEXT_WINDOW,
  };
}

export function catalogFailure(status: number): Error {
  if (status === 401 || status === 403) return new Error(`Cursor rejected the session (HTTP ${status}). Run /login and choose Cursor.`);
  return new Error(`Cursor model list failed (HTTP ${status}).`);
}
