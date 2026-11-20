import { CursorSdkError, IntegrationNotConnectedError } from '@cursor/sdk';
import type { OAuthLoginCallbacks, RefreshModelsContext } from '@earendil-works/pi-ai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { loginCursor, refreshCursorKey } from '../src/cursor/auth.ts';
import { FALLBACK_MODELS, findCursorModel, listCursorModels, refreshCursorModels } from '../src/cursor/catalog.ts';
import { describeCursorError } from '../src/cursor/errors.ts';
import { fakeSdk, sdk } from './fake-sdk.ts';

const LOGIN_URL = 'https://cursor.com/login';
const CURSOR_API_URL = 'https://api.cursor.com';
const INTEGRATIONS_URL = 'https://cursor.com/dashboard/integrations';
const KEY_EXPIRES_AT_MS = 1_900_000_000_000;
const MIN_LIVE_MODELS = 40;

vi.mock('@cursor/sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fake-sdk.ts')).fakeSdk }));

beforeEach(() => sdk.reset());
afterEach(() => vi.unstubAllEnvs());

describe('sign-in', () => {
  test('mints a key through Cursor.auth.login, shows its URL in Pi, and keeps it out of ~/.cursor', async () => {
    fakeSdk.Cursor.auth.login.mockImplementation(async (options: { onLoginUrl: (url: string) => void }) => {
      options.onLoginUrl(LOGIN_URL);
      return { apiKey: 'crsr_key', apiKeyExpiresAtMs: KEY_EXPIRES_AT_MS };
    });
    const onAuth = vi.fn();
    const signal = new AbortController().signal;
    const credentials = await loginCursor({ onAuth, signal } as unknown as OAuthLoginCallbacks);
    expect(credentials).toStrictEqual({ access: 'crsr_key', refresh: '', expires: KEY_EXPIRES_AT_MS });
    expect(onAuth).toHaveBeenCalledWith({ url: LOGIN_URL, instructions: 'Sign in to Cursor in the browser, then return here.' });
    expect(fakeSdk.Cursor.auth.login).toHaveBeenCalledWith(expect.objectContaining({ store: null, openBrowser: false, apiKeyName: 'Pi (pi-spacex-oauth-v2)', signal }));
  });

  test('an expired key asks the user to sign in again', async () => {
    await expect(refreshCursorKey({ access: 'a', refresh: '', expires: 0 })).rejects.toThrow('Run /login and choose Cursor (X subscription)');
  });
});

describe('model catalog', () => {
  const context = (overrides: Partial<RefreshModelsContext>) =>
    ({ allowNetwork: true, signal: new AbortController().signal, publish: vi.fn(async () => true), ...overrides }) as unknown as RefreshModelsContext & { publish: ReturnType<typeof vi.fn> };

  test('offline or signed-out starts use the stored list, else Composer', async () => {
    vi.stubEnv('CURSOR_API_KEY', '');
    const stored = [{ id: 'kept' }];
    expect(await refreshCursorModels(context({ allowNetwork: false, credential: { type: 'oauth', access: 'a', refresh: '', expires: 0 }, stored: { models: stored } as never }))).toBe(stored);
    expect(await refreshCursorModels(context({}))).toBe(FALLBACK_MODELS);
    expect(fakeSdk.Cursor.models.list).not.toHaveBeenCalled();
  });

  test('a signed-in refresh lists live models and persists them for offline starts', async () => {
    const ctx = context({ credential: { type: 'oauth', access: 'refresh-key', refresh: '', expires: 0 } });
    const models = await refreshCursorModels(ctx);
    expect(models.length).toBeGreaterThan(MIN_LIVE_MODELS);
    expect(fakeSdk.Cursor.models.list).toHaveBeenCalledWith({ apiKey: 'refresh-key' });
    const persisted = ctx.publish.mock.calls[0]?.[0].persist.models;
    expect(persisted[0]).toMatchObject({ provider: 'spacex-cursor', api: 'cursor-sdk', baseUrl: CURSOR_API_URL, id: 'default' });
  });

  test('an API key from auth.json or CURSOR_API_KEY also refreshes', async () => {
    await refreshCursorModels(context({ credential: { type: 'api_key', key: 'stored-key' } }));
    vi.stubEnv('CURSOR_API_KEY', 'env-key');
    await refreshCursorModels(context({ credential: { type: 'api_key' } }));
    expect(fakeSdk.Cursor.models.list.mock.calls).toStrictEqual([[{ apiKey: 'stored-key' }], [{ apiKey: 'env-key' }]]);
  });

  test('lists once per key, retries after a failure, and finds models by id or alias', async () => {
    fakeSdk.Cursor.models.list.mockRejectedValueOnce(new Error('offline'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await findCursorModel('cache-key', 'composer-2.5')).toBeUndefined();
    expect(error).toHaveBeenCalled();
    expect((await findCursorModel('cache-key', 'auto'))?.id).toBe('default');
    await listCursorModels('cache-key');
    await listCursorModels(undefined);
    expect(fakeSdk.Cursor.models.list.mock.calls).toStrictEqual([[{ apiKey: 'cache-key' }], [{ apiKey: 'cache-key' }], [{}]]);
  });
});

describe('error messages', () => {
  test('surface the help link for a disconnected integration', () => {
    const error = new IntegrationNotConnectedError('github integration is not connected', { provider: 'github', helpUrl: INTEGRATIONS_URL, code: 'not_connected' });
    expect(describeCursorError(error)).toBe(`Cursor IntegrationNotConnectedError: github integration is not connected (code not_connected) ${INTEGRATIONS_URL}`);
  });

  test('pass through plain errors and stringify the rest', () => {
    expect(describeCursorError(new CursorSdkError('bare'))).toBe('Cursor CursorSdkError: bare');
    expect(describeCursorError('text')).toBe('text');
  });
});
