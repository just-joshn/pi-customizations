import { CursorSdkError, IntegrationNotConnectedError } from '@cursor/sdk';
import type { OAuthLoginCallbacks, RefreshModelsContext } from '@earendil-works/pi-ai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { loginCursor, refreshCursorKey } from '../src/cursor/auth.ts';
import { FALLBACK_MODELS, findCursorModel, listCursorModels, refreshCursorModels } from '../src/cursor/catalog.ts';
import { describeCursorError } from '../src/cursor/errors.ts';
import { fakeSdk, sdk } from './fake-sdk.ts';

vi.mock('@cursor/sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fake-sdk.ts')).fakeSdk }));

beforeEach(() => sdk.reset());
afterEach(() => vi.unstubAllEnvs());

describe('sign-in', () => {
  test('mints a key through Cursor.auth.login, shows its URL in Pi, and keeps it out of ~/.cursor', async () => {
    fakeSdk.Cursor.auth.login.mockImplementation(async (options: { onLoginUrl: (url: string) => void }) => {
      options.onLoginUrl('https://cursor.com/login');
      return { apiKey: 'crsr_key', apiKeyExpiresAtMs: 1_900_000_000_000 };
    });
    const onAuth = vi.fn();
    const signal = new AbortController().signal;
    const credentials = await loginCursor({ onAuth, signal } as unknown as OAuthLoginCallbacks);
    expect(credentials).toStrictEqual({ access: 'crsr_key', refresh: '', expires: 1_900_000_000_000 });
    expect(onAuth).toHaveBeenCalledWith({ url: 'https://cursor.com/login', instructions: 'Sign in to Cursor in the browser, then return here.' });
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
    expect(models.length).toBeGreaterThan(40);
    expect(fakeSdk.Cursor.models.list).toHaveBeenCalledWith({ apiKey: 'refresh-key' });
    const persisted = ctx.publish.mock.calls[0]?.[0].persist.models;
    expect(persisted[0]).toMatchObject({ provider: 'spacex-cursor', api: 'cursor-sdk', baseUrl: 'https://api.cursor.com', id: 'default' });
  });

  test('an API key from auth.json or CURSOR_API_KEY also refreshes', async () => {
    await refreshCursorModels(context({ credential: { type: 'api_key', key: 'stored-key' } }));
    vi.stubEnv('CURSOR_API_KEY', 'env-key');
    await refreshCursorModels(context({ credential: { type: 'api_key' } }));
    expect(fakeSdk.Cursor.models.list.mock.calls).toStrictEqual([[{ apiKey: 'stored-key' }], [{ apiKey: 'env-key' }]]);
  });

  test('lists once per key, retries after a failure, and finds models by id or alias', async () => {
    fakeSdk.Cursor.models.list.mockRejectedValueOnce(new Error('offline'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
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
    const error = new IntegrationNotConnectedError('github integration is not connected', { provider: 'github', helpUrl: 'https://cursor.com/dashboard/integrations', code: 'not_connected' });
    expect(describeCursorError(error)).toBe('Cursor IntegrationNotConnectedError: github integration is not connected (code not_connected) https://cursor.com/dashboard/integrations');
  });

  test('pass through plain errors and stringify the rest', () => {
    expect(describeCursorError(new CursorSdkError('bare'))).toBe('Cursor CursorSdkError: bare');
    expect(describeCursorError('text')).toBe('text');
  });
});
