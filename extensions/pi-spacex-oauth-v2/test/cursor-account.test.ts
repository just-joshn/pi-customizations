import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeSdk, sdk } from './fake-sdk.ts';
import { CURSOR_ID, loadExtension, makeLogin, makeRefresh, oauthCredential } from './host.ts';
import { makeModel } from './support.ts';

vi.mock('@cursor/sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fake-sdk.ts')).fakeSdk }));

const LOGIN_URL = 'https://cursor.com/login';
const CURSOR_API_URL = 'https://api.cursor.com';
const KEY_EXPIRES_AT_MS = 1_900_000_000_000;
const MIN_LIVE_MODELS = 40;

const cursor = () => loadExtension().provider(CURSOR_ID);
const ids = (models: { id: string }[]) => models.map((m) => m.id);

beforeEach(() => sdk.reset());
afterEach(() => vi.unstubAllEnvs());

describe('Cursor sign-in', () => {
  test('mints a key through Cursor, shows its URL in Pi, and keeps it out of ~/.cursor', async () => {
    fakeSdk.Cursor.auth.login.mockImplementation(async (options: { onLoginUrl: (url: string) => void }) => {
      options.onLoginUrl(LOGIN_URL);
      return { apiKey: 'crsr_key', apiKeyExpiresAtMs: KEY_EXPIRES_AT_MS };
    });
    const signal = new AbortController().signal;
    const { callbacks, authUrls } = makeLogin(signal);
    const credentials = await cursor().oauth.login(callbacks);
    expect(credentials).toStrictEqual({ access: 'crsr_key', refresh: '', expires: KEY_EXPIRES_AT_MS });
    expect(authUrls()).toStrictEqual([{ url: LOGIN_URL, instructions: 'Sign in to Cursor in the browser, then return here.' }]);
    expect(fakeSdk.Cursor.auth.login).toHaveBeenCalledWith(expect.objectContaining({ store: null, openBrowser: false, apiKeyName: 'Pi (pi-spacex-oauth-v2)', signal }));
  });

  test('signs in without a cancel signal when Pi supplies none', async () => {
    fakeSdk.Cursor.auth.login.mockResolvedValue({ apiKey: 'crsr_key', apiKeyExpiresAtMs: KEY_EXPIRES_AT_MS });
    await cursor().oauth.login(makeLogin().callbacks);
    expect(fakeSdk.Cursor.auth.login.mock.calls[0]?.[0]).not.toHaveProperty('signal');
  });

  test('an expired key asks the user to sign in again', async () => {
    const expired = { access: 'a', refresh: '', expires: 0 };
    await expect(cursor().oauth.refreshToken(expired, new AbortController().signal)).rejects.toThrow('Run /login and choose Cursor (X subscription)');
  });

  test('hands Pi the minted key as the API key', () => {
    expect(cursor().oauth.getApiKey({ access: 'crsr_key', refresh: '', expires: 0 })).toBe('crsr_key');
  });
});

describe('Cursor model list refresh', () => {
  test('offline, Pi keeps the stored list', async () => {
    vi.stubEnv('CURSOR_API_KEY', '');
    const stored = [makeModel('kept', CURSOR_ID, 'cursor-sdk')];
    const { ctx } = makeRefresh({ allowNetwork: false, credential: oauthCredential('a'), stored: { models: stored } });
    expect(await cursor().refreshModels(ctx)).toBe(stored);
    expect(fakeSdk.Cursor.models.list).not.toHaveBeenCalled();
  });

  test('signed out with nothing stored, Pi lists Composer', async () => {
    vi.stubEnv('CURSOR_API_KEY', '');
    expect(ids(await cursor().refreshModels(makeRefresh().ctx))).toStrictEqual(['composer-2.5']);
    expect(fakeSdk.Cursor.models.list).not.toHaveBeenCalled();
  });

  test('a signed-in refresh lists the live models and persists them for offline starts', async () => {
    const { ctx, published } = makeRefresh({ credential: oauthCredential('refresh-key') });
    const models = await cursor().refreshModels(ctx);
    expect(models.length).toBeGreaterThan(MIN_LIVE_MODELS);
    expect(fakeSdk.Cursor.models.list).toHaveBeenCalledWith({ apiKey: 'refresh-key' });
    const [publication] = published();
    expect(publication?.persist?.models[0]).toMatchObject({ provider: CURSOR_ID, api: 'cursor-sdk', baseUrl: CURSOR_API_URL, id: 'default' });
  });

  test('an API key from auth.json also refreshes', async () => {
    await cursor().refreshModels(makeRefresh({ credential: { type: 'api_key', key: 'stored-key' } }).ctx);
    expect(fakeSdk.Cursor.models.list.mock.calls).toStrictEqual([[{ apiKey: 'stored-key' }]]);
  });

  test('CURSOR_API_KEY also refreshes', async () => {
    vi.stubEnv('CURSOR_API_KEY', 'env-key');
    await cursor().refreshModels(makeRefresh({ credential: { type: 'api_key' } }).ctx);
    expect(fakeSdk.Cursor.models.list.mock.calls).toStrictEqual([[{ apiKey: 'env-key' }]]);
  });

  test('refreshing again asks Cursor again rather than reusing an earlier list', async () => {
    const { ctx } = makeRefresh({ credential: oauthCredential('again-key') });
    await cursor().refreshModels(ctx);
    await cursor().refreshModels(ctx);
    expect(fakeSdk.Cursor.models.list).toHaveBeenCalledTimes(2);
  });
});

describe('Cursor model list refresh when the live list fails', () => {
  beforeEach(() => {
    fakeSdk.Cursor.models.list.mockRejectedValue(new Error('Invalid User API Key'));
  });
  afterEach(() => vi.restoreAllMocks());

  test('Pi keeps the stored list, persists nothing, and the log names the failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stored = [makeModel('kept', CURSOR_ID, 'cursor-sdk')];
    const { ctx, published } = makeRefresh({ credential: oauthCredential('bad-key'), stored: { models: stored } });
    expect(await cursor().refreshModels(ctx)).toBe(stored);
    expect(published()).toStrictEqual([]);
    expect(error).toHaveBeenCalledWith('Model refresh failed for spacex-cursor:', expect.objectContaining({ message: 'Invalid User API Key' }));
  });

  test('Pi lists Composer when nothing was stored', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(ids(await cursor().refreshModels(makeRefresh({ credential: oauthCredential('bad-key') }).ctx))).toStrictEqual(['composer-2.5']);
  });
});

describe('Cursor credential isolation', () => {
  test('uses the signed-in key over CURSOR_API_KEY', async () => {
    vi.stubEnv('CURSOR_API_KEY', 'env-key');
    await cursor().refreshModels(makeRefresh({ credential: oauthCredential('oauth-key') }).ctx);
    expect(fakeSdk.Cursor.models.list.mock.calls).toStrictEqual([[{ apiKey: 'oauth-key' }]]);
  });

  test('writes no key to the refresh failure log', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fakeSdk.Cursor.models.list.mockRejectedValue(new Error('Invalid User API Key'));
    await cursor().refreshModels(makeRefresh({ credential: oauthCredential('secret-key') }).ctx);
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret-key');
    error.mockRestore();
  });
});
