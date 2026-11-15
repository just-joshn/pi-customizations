import { readFileSync } from 'node:fs';

import type { OAuthLoginCallbacks } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { grokLogin, grokRefresh, toGrokModel } from '../src/grok.ts';

const grokModels = JSON.parse(readFileSync(new URL('./fixtures/grok-models.json', import.meta.url), 'utf8')).data;
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
      .mockResolvedValueOnce(
        json(200, { device_code: 'dev', user_code: 'ABCD-1234', verification_uri: 'https://accounts.x.ai/oauth2/device', verification_uri_complete: 'https://accounts.x.ai/oauth2/device?user_code=ABCD-1234', expires_in: 600, interval: 1 }),
      )
      .mockResolvedValueOnce(json(400, { error: 'authorization_pending' }))
      .mockResolvedValueOnce(json(400, { error: 'slow_down' }))
      .mockResolvedValueOnce(json(200, { access_token: 'acc', refresh_token: 'ref', expires_in: 21600 }));
    vi.stubGlobal('fetch', fetch);
    const cb = callbacks();
    const login = grokLogin(cb);
    await vi.runAllTimersAsync();
    const creds = await login;
    expect(cb.onDeviceCode).toHaveBeenCalledWith(expect.objectContaining({ userCode: 'ABCD-1234', verificationUri: 'https://accounts.x.ai/oauth2/device?user_code=ABCD-1234' }));
    expect(creds).toMatchObject({ access: 'acc', refresh: 'ref' });
    expect(creds.expires).toBe(Date.now() + 21600 * 1000);
    expect(String(fetch.mock.calls[3]?.[1]?.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code');
  });

  test('refresh keeps the old refresh token when the server does not rotate it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { access_token: 'new', expires_in: 60 })));
    const creds = await grokRefresh({ access: 'old', refresh: 'keep', expires: 0 }, new AbortController().signal);
    expect(creds).toMatchObject({ access: 'new', refresh: 'keep' });
  });

  test("refresh surfaces the server's error description", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(400, { error: 'invalid_grant', error_description: 'refresh token revoked' })));
    await expect(grokRefresh({ access: 'a', refresh: 'r', expires: 0 }, new AbortController().signal)).rejects.toThrow('refresh token revoked');
  });
});

describe('Grok Build models (/v1/models, recorded)', () => {
  test('every recorded model gets thinking levels from its reasoning efforts', () => {
    const models = grokModels.map(toGrokModel);
    expect(models.map((m: { id: string }) => m.id)).toStrictEqual(['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5']);
    const grok45 = models.find((m: { id: string }) => m.id === 'grok-4.5');
    expect(grok45.thinkingLevelMap).toMatchObject({ low: 'low', medium: 'medium', high: 'high', xhigh: null });
    expect(grok45.contextWindow).toBe(256000);
  });
});
