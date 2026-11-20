import type { OAuthLoginCallbacks } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { grokLogin, grokRefresh, toGrokModel } from '../src/grok.ts';
import grokFixture from './fixtures/grok-models.json' with { type: 'json' };

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const DEVICE_URL = 'https://accounts.x.ai/oauth2/device';
const DEVICE_URL_COMPLETE = 'https://accounts.x.ai/oauth2/device?user_code=ABCD-1234';
const TOKEN_POLL_INDEX = 3;
const CODE_LIFETIME_SECONDS = 600;
const TOKEN_LIFETIME_SECONDS = 21_600;
const SHORT_TOKEN_LIFETIME_SECONDS = 60;
const MS_PER_SECOND = 1000;
const GROK_CONTEXT_WINDOW = 256_000;

const grokModels = grokFixture.data;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function callbacks() {
  return { onAuth: vi.fn(), onDeviceCode: vi.fn(), onPrompt: vi.fn(), onSelect: vi.fn() } as unknown as OAuthLoginCallbacks & { onAuth: ReturnType<typeof vi.fn>; onDeviceCode: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Grok Build device sign-in', () => {
  test('shows the device code, waits through pending and slow_down, then stores tokens', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(HTTP_OK, { device_code: 'dev', user_code: 'ABCD-1234', verification_uri: DEVICE_URL, verification_uri_complete: DEVICE_URL_COMPLETE, expires_in: CODE_LIFETIME_SECONDS, interval: 1 }))
      .mockResolvedValueOnce(json(HTTP_BAD_REQUEST, { error: 'authorization_pending' }))
      .mockResolvedValueOnce(json(HTTP_BAD_REQUEST, { error: 'slow_down' }))
      .mockResolvedValueOnce(json(HTTP_OK, { access_token: 'acc', refresh_token: 'ref', expires_in: TOKEN_LIFETIME_SECONDS }));
    vi.stubGlobal('fetch', fetch);
    const cb = callbacks();
    const login = grokLogin(cb);
    await vi.runAllTimersAsync();
    const creds = await login;
    expect(cb.onDeviceCode).toHaveBeenCalledWith(expect.objectContaining({ userCode: 'ABCD-1234', verificationUri: DEVICE_URL_COMPLETE }));
    expect(creds).toMatchObject({ access: 'acc', refresh: 'ref' });
    expect(creds.expires).toBe(Date.now() + TOKEN_LIFETIME_SECONDS * MS_PER_SECOND);
    // biome-ignore lint/security/noSecrets: OAuth's device authorization grant uses this standardized URN, not a credential.
    expect(String(fetch.mock.calls[TOKEN_POLL_INDEX]?.[1]?.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code');
  });

  test('refresh keeps the old refresh token when the server does not rotate it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(HTTP_OK, { access_token: 'new', expires_in: SHORT_TOKEN_LIFETIME_SECONDS })));
    const creds = await grokRefresh({ access: 'old', refresh: 'keep', expires: 0 }, new AbortController().signal);
    expect(creds).toMatchObject({ access: 'new', refresh: 'keep' });
  });

  test("refresh surfaces the server's error description", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(HTTP_BAD_REQUEST, { error: 'invalid_grant', error_description: 'refresh token revoked' })));
    await expect(grokRefresh({ access: 'a', refresh: 'r', expires: 0 }, new AbortController().signal)).rejects.toThrow('refresh token revoked');
  });
});

describe('Grok Build models (/v1/models, recorded)', () => {
  test('every recorded model gets thinking levels from its reasoning efforts', () => {
    const models = grokModels.map(toGrokModel);
    expect(models.map((m) => m.id)).toStrictEqual(['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5']);
    const grok45 = models.find((m) => m.id === 'grok-4.5');
    expect(grok45).toMatchObject({
      thinkingLevelMap: { low: 'low', medium: 'medium', high: 'high', xhigh: null },
      contextWindow: GROK_CONTEXT_WINDOW,
    });
  });
});
