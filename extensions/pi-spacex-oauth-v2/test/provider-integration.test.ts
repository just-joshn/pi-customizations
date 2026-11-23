import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeSdk, sdk } from './fake-sdk.ts';
import { CURSOR_ID, GROK_ID, jsonResponse, loadExtension, makeLogin, makeRefresh, oauthCredential } from './host.ts';

vi.mock('@cursor/sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fake-sdk.ts')).fakeSdk }));

const HTTP_OK = 200;
const TOKEN_LIFETIME_SECONDS = 3600;
const MS_PER_SECOND = 1000;
const MODELS_CALL_INDEX = 2;

const grok = () => loadExtension().provider(GROK_ID);
const cursor = () => loadExtension().provider(CURSOR_ID);

const stubFetch = (...responses: Response[]) => {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

const deviceCode = { device_code: 'dev', user_code: 'ABCD-1234', verification_uri: 'https://accounts.x.ai/oauth2/device', expires_in: 600, interval: 1 };
const token = { access_token: 'issued-access', refresh_token: 'issued-refresh', expires_in: TOKEN_LIFETIME_SECONDS };
const authorized = (fetch: ReturnType<typeof stubFetch>, index: number): string | undefined => {
  const headers = fetch.mock.calls[index]?.[1]?.headers;
  return headers instanceof Headers ? (headers.get('Authorization') ?? undefined) : (headers as Record<string, string> | undefined)?.['Authorization'];
};

beforeEach(() => {
  sdk.reset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Grok sign-in through the first model refresh', () => {
  test('uses the issued access token for the live model list and persists that list', async () => {
    const fetch = stubFetch(jsonResponse(HTTP_OK, deviceCode), jsonResponse(HTTP_OK, token), jsonResponse(HTTP_OK, { data: [{ id: 'grok-5', name: 'Grok 5' }] }));
    const login = grok().oauth.login(makeLogin().callbacks);
    await vi.runAllTimersAsync();
    const credentials = await login;
    const { ctx, published } = makeRefresh({ credential: { type: 'oauth', ...credentials } });
    const models = await grok().refreshModels(ctx);
    expect(models.map((model) => model.id)).toStrictEqual(['grok-5']);
    expect(authorized(fetch, MODELS_CALL_INDEX)).toBe('Bearer issued-access');
    expect(published()[0]?.persist?.models[0]).toMatchObject({ provider: GROK_ID, id: 'grok-5' });
  });
});

describe('Grok refresh through the next model refresh', () => {
  test('uses the refreshed access token for the live model list', async () => {
    const fetch = stubFetch(jsonResponse(HTTP_OK, { access_token: 'refreshed-access', refresh_token: 'refreshed-refresh' }), jsonResponse(HTTP_OK, { data: [{ id: 'grok-5' }] }));
    const refreshed = await grok().oauth.refreshToken({ access: 'old-access', refresh: 'old-refresh', expires: 0 }, new AbortController().signal);
    expect(refreshed.expires).toBe(Date.now() + TOKEN_LIFETIME_SECONDS * MS_PER_SECOND);
    await grok().refreshModels(makeRefresh({ credential: { type: 'oauth', ...refreshed } }).ctx);
    expect(authorized(fetch, 1)).toBe('Bearer refreshed-access');
  });
});

describe('two providers in one extension', () => {
  test('each catalog uses only its own credential and persists only its own models', async () => {
    vi.stubEnv('CURSOR_API_KEY', '');
    fakeSdk.Cursor.models.list.mockResolvedValue([{ id: 'composer-live', displayName: 'Composer Live' }]);
    const fetch = stubFetch(jsonResponse(HTTP_OK, { data: [{ id: 'grok-live', name: 'Grok Live' }] }));
    const grokRefresh = makeRefresh({ credential: oauthCredential('grok-token') });
    const cursorRefresh = makeRefresh({ credential: oauthCredential('cursor-key') });
    const grokModels = await grok().refreshModels(grokRefresh.ctx);
    const cursorModels = await cursor().refreshModels(cursorRefresh.ctx);
    expect(grokModels.map((model) => model.id)).toStrictEqual(['grok-live']);
    expect(cursorModels.map((model) => model.id)).toStrictEqual(['composer-live']);
    expect(fetch.mock.calls.map((call) => (call[1]?.headers as Record<string, string>)['Authorization'])).toStrictEqual(['Bearer grok-token']);
    expect(fakeSdk.Cursor.models.list.mock.calls).toStrictEqual([[{ apiKey: 'cursor-key' }]]);
    expect(JSON.stringify(grokRefresh.published())).not.toContain('cursor-key');
    expect(JSON.stringify(cursorRefresh.published())).not.toContain('grok-token');
  });
});
