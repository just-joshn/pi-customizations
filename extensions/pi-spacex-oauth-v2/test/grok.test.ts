import type { ProviderModelConfig } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import grokFixture from './fixtures/grok-models.json' with { type: 'json' };
import { GROK_ID, jsonResponse, loadExtension, makeLogin, makeRefresh, oauthCredential } from './host.ts';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_SERVER_ERROR = 500;
const DEVICE_URL = 'https://accounts.x.ai/oauth2/device';
const DEVICE_URL_COMPLETE = 'https://accounts.x.ai/oauth2/device?user_code=ABCD-1234';
const CODE_LIFETIME_SECONDS = 600;
const SHORT_CODE_LIFETIME_SECONDS = 10;
const TOKEN_LIFETIME_SECONDS = 21_600;
const SHORT_TOKEN_LIFETIME_SECONDS = 60;
const DEFAULT_TOKEN_TTL_SECONDS = 3600;
const POLL_INTERVAL_SECONDS = 5;
const MS_PER_SECOND = 1000;
const CANCEL_DELAY_MS = 10;
const GROK_CONTEXT_WINDOW = 256_000;
const TOKEN_POLL_INDEX = 3;
// biome-ignore lint/security/noSecrets: OAuth's device authorization grant uses this standardized URN, not a credential.
const DEVICE_GRANT = 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code';
const DEVICE_CODE_URL = 'https://auth.x.ai/oauth2/device/code';
const TOKEN_URL = 'https://auth.x.ai/oauth2/token';
const MODELS_URL = 'https://cli-chat-proxy.grok.com/v1/models';
const NOW = '2026-11-15T12:00:00Z';

const deviceCode = (extra: Record<string, unknown> = {}) => ({ device_code: 'dev', user_code: 'ABCD-1234', verification_uri: DEVICE_URL, expires_in: CODE_LIFETIME_SECONDS, ...extra });
const ids = (models: ProviderModelConfig[]) => models.map((m) => m.id);

type FetchCall = [string, RequestInit | undefined];
const stubFetch = (...responses: Response[]) => {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
const grok = () => loadExtension().provider(GROK_ID);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Grok Build device sign-in', () => {
  test('shows the device code, waits through pending and slow_down, then stores the tokens', async () => {
    const fetch = stubFetch(
      jsonResponse(HTTP_OK, deviceCode({ verification_uri_complete: DEVICE_URL_COMPLETE, interval: 1 })),
      jsonResponse(HTTP_BAD_REQUEST, { error: 'authorization_pending' }),
      jsonResponse(HTTP_BAD_REQUEST, { error: 'slow_down' }),
      jsonResponse(HTTP_OK, { access_token: 'acc', refresh_token: 'ref', expires_in: TOKEN_LIFETIME_SECONDS }),
    );
    const { callbacks, deviceCodes } = makeLogin();
    const login = grok().oauth.login(callbacks);
    await vi.runAllTimersAsync();
    const creds = await login;
    expect(deviceCodes()).toStrictEqual([{ userCode: 'ABCD-1234', verificationUri: DEVICE_URL_COMPLETE, openBrowserOnConfirm: true, intervalSeconds: 1, expiresInSeconds: CODE_LIFETIME_SECONDS }]);
    expect(creds).toStrictEqual({ access: 'acc', refresh: 'ref', expires: Date.now() + TOKEN_LIFETIME_SECONDS * MS_PER_SECOND });
    expect(fetch.mock.calls[0]?.[0]).toBe(DEVICE_CODE_URL);
    const pollBody = String((fetch.mock.calls[TOKEN_POLL_INDEX] as FetchCall)[1]?.body);
    expect(pollBody).toContain(DEVICE_GRANT);
    expect(pollBody).toContain('device_code=dev');
  });

  test('uses the plain verification URL, 5 second polling, and a one hour token when the server gives no extras', async () => {
    stubFetch(jsonResponse(HTTP_OK, deviceCode({ verification_uri: DEVICE_URL })), jsonResponse(HTTP_OK, { access_token: 'a', refresh_token: 'r' }));
    const { callbacks, deviceCodes } = makeLogin();
    const login = grok().oauth.login(callbacks);
    await vi.runAllTimersAsync();
    const creds = await login;
    expect(deviceCodes()[0]).toMatchObject({ verificationUri: DEVICE_URL, intervalSeconds: POLL_INTERVAL_SECONDS });
    expect(creds.expires).toBe(Date.now() + DEFAULT_TOKEN_TTL_SECONDS * MS_PER_SECOND);
  });
});

describe('Grok Build device sign-in failures', () => {
  test('reports a rejected device-code request', async () => {
    stubFetch(new Response('', { status: HTTP_SERVER_ERROR }));
    await expect(grok().oauth.login(makeLogin().callbacks)).rejects.toThrow('Grok device sign-in failed: HTTP 500');
  });

  test('fails when the code expires before approval', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('device/code') ? jsonResponse(HTTP_OK, deviceCode({ expires_in: SHORT_CODE_LIFETIME_SECONDS, interval: POLL_INTERVAL_SECONDS })) : jsonResponse(HTTP_BAD_REQUEST, { error: 'authorization_pending' }),
      ),
    );
    const assertion = expect(grok().oauth.login(makeLogin().callbacks)).rejects.toThrow('Grok device sign-in expired before it was approved');
    await vi.runAllTimersAsync();
    await assertion;
  });

  test('cancelling while waiting rejects with the abort reason', async () => {
    stubFetch(jsonResponse(HTTP_OK, deviceCode({ interval: POLL_INTERVAL_SECONDS })));
    const controller = new AbortController();
    const assertion = expect(grok().oauth.login(makeLogin(controller.signal).callbacks)).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(CANCEL_DELAY_MS);
    controller.abort(new Error('cancelled'));
    await assertion;
  });

  test('says no token was returned when the server answers with neither tokens nor an error', async () => {
    stubFetch(jsonResponse(HTTP_OK, deviceCode({ interval: 1 })), jsonResponse(HTTP_OK, {}));
    const assertion = expect(grok().oauth.login(makeLogin().callbacks)).rejects.toThrow('Grok sign-in failed: no token returned');
    await vi.runAllTimersAsync();
    await assertion;
  });
});

describe('Grok Build token refresh and API key', () => {
  const signal = new AbortController().signal;

  test('keeps the old refresh token when the server does not rotate it', async () => {
    stubFetch(jsonResponse(HTTP_OK, { access_token: 'new', expires_in: SHORT_TOKEN_LIFETIME_SECONDS }));
    const creds = await grok().oauth.refreshToken({ access: 'old', refresh: 'keep', expires: 0 }, signal);
    expect(creds).toStrictEqual({ access: 'new', refresh: 'keep', expires: Date.now() + SHORT_TOKEN_LIFETIME_SECONDS * MS_PER_SECOND });
  });

  test('sends the refresh token to the token endpoint', async () => {
    const fetch = stubFetch(jsonResponse(HTTP_OK, { access_token: 'new', refresh_token: 'rotated' }));
    const creds = await grok().oauth.refreshToken({ access: 'old', refresh: 'keep', expires: 0 }, signal);
    expect(creds.refresh).toBe('rotated');
    expect(fetch.mock.calls[0]?.[0]).toBe(TOKEN_URL);
    expect(String(fetch.mock.calls[0]?.[1]?.body)).toContain('refresh_token=keep');
  });

  test("surfaces the server's error description", async () => {
    stubFetch(jsonResponse(HTTP_BAD_REQUEST, { error: 'invalid_grant', error_description: 'refresh token revoked' }));
    await expect(grok().oauth.refreshToken({ access: 'a', refresh: 'r', expires: 0 }, signal)).rejects.toThrow('Grok sign-in failed: refresh token revoked');
  });

  test('falls back to the error code when there is no description', async () => {
    stubFetch(jsonResponse(HTTP_BAD_REQUEST, { error: 'invalid_grant' }));
    await expect(grok().oauth.refreshToken({ access: 'a', refresh: 'r', expires: 0 }, signal)).rejects.toThrow('Grok sign-in failed: invalid_grant');
  });

  test('hands Pi the access token as the API key', () => {
    expect(grok().oauth.getApiKey({ access: 'acc', refresh: 'r', expires: 0 })).toBe('acc');
  });
});

describe('Grok Build model list', () => {
  const liveList = (data: unknown[]) => jsonResponse(HTTP_OK, { data });

  test('without a network or sign-in, Pi keeps the stored catalog, else the built-in list', async () => {
    const provider = grok();
    const stored = [{ id: 'stored-model' }];
    const offline = makeRefresh({ allowNetwork: false, stored: { models: stored } as never });
    expect(await provider.refreshModels(offline.ctx)).toBe(stored);
    const apiKeyOnly = await provider.refreshModels(makeRefresh({ credential: { type: 'api_key' } }).ctx);
    expect(ids(apiKeyOnly)).toStrictEqual(['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5']);
  });

  test('a signed-in refresh lists the live models and persists them', async () => {
    const fetch = stubFetch(liveList([{ id: 'grok-5', name: 'Grok 5', reasoning_efforts: [{ value: 'high' }] }, { id: 'grok-img', api_backend: 'images' }, { id: 'grok-plain' }]));
    const { ctx, published } = makeRefresh({ credential: oauthCredential('tok') });
    const models = await grok().refreshModels(ctx);
    expect(ids(models)).toStrictEqual(['grok-5', 'grok-plain']);
    expect(models[0]).toMatchObject({ name: 'Grok 5', reasoning: true, thinkingLevelMap: { high: 'high', low: null, off: null } });
    expect(models[1]).toMatchObject({ name: 'grok-plain', reasoning: false, contextWindow: GROK_CONTEXT_WINDOW });
    expect(models[1]).not.toHaveProperty('thinkingLevelMap');
    expect(fetch.mock.calls[0]?.[0]).toBe(MODELS_URL);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: 'Bearer tok', 'x-grok-client-version': '1.0.77' } });
    expect(published()).toStrictEqual([{ persist: { checkedAt: Date.now(), models: [expect.objectContaining({ provider: GROK_ID, api: 'openai-responses', id: 'grok-5' }), expect.objectContaining({ id: 'grok-plain' })] } }]);
  });

  test('every recorded model gets its thinking levels from its reasoning efforts', async () => {
    stubFetch(liveList(grokFixture.data));
    const models = await grok().refreshModels(makeRefresh({ credential: oauthCredential('tok') }).ctx);
    expect(ids(models)).toStrictEqual(['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5']);
    expect(models.find((m) => m.id === 'grok-4.5')).toMatchObject({ thinkingLevelMap: { low: 'low', medium: 'medium', high: 'high', xhigh: null }, contextWindow: GROK_CONTEXT_WINDOW });
  });

  test('a failed model list surfaces the HTTP status', async () => {
    stubFetch(new Response('', { status: HTTP_FORBIDDEN }));
    await expect(grok().refreshModels(makeRefresh({ credential: oauthCredential('tok') }).ctx)).rejects.toThrow('Grok Build model list failed: HTTP 403');
  });
});
