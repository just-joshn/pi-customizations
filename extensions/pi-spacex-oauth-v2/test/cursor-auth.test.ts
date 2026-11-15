import type { OAuthLoginCallbacks } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cursorLogin, cursorRefresh } from '../src/cursor/auth.ts';

const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function callbacks() {
  return { onAuth: vi.fn(), onDeviceCode: vi.fn(), onPrompt: vi.fn(), onSelect: vi.fn() } as unknown as OAuthLoginCallbacks & { onAuth: ReturnType<typeof vi.fn>; onDeviceCode: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Cursor browser sign-in', () => {
  test('opens loginDeepControl with a PKCE challenge, polls through 404, and stores the session', async () => {
    vi.useFakeTimers();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(json(200, { accessToken: jwt(exp), refreshToken: 'ref' }));
    vi.stubGlobal('fetch', fetch);
    const cb = callbacks();
    const login = cursorLogin(cb);
    await vi.runAllTimersAsync();
    const creds = await login;
    const url = new URL(cb.onAuth.mock.calls[0]?.[0]?.url);
    expect(url.origin + url.pathname).toBe('https://cursor.com/loginDeepControl');
    expect(url.searchParams.get('redirectTarget')).toBe('cli');
    const poll = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(poll.searchParams.get('uuid')).toBe(url.searchParams.get('uuid'));
    expect(creds).toStrictEqual({ access: jwt(exp), refresh: 'ref', expires: exp * 1000 });
  });

  test("refresh posts the IDE's refresh grant and keeps the refresh token", async () => {
    const exp = Math.floor(Date.now() / 1000) + 7200;
    const fetch = vi.fn().mockResolvedValue(json(200, { access_token: jwt(exp) }));
    vi.stubGlobal('fetch', fetch);
    const creds = await cursorRefresh({ access: 'old', refresh: 'ref', expires: 0 }, new AbortController().signal);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toStrictEqual({ grant_type: 'refresh_token', client_id: 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB', refresh_token: 'ref' });
    expect(creds).toStrictEqual({ access: jwt(exp), refresh: 'ref', expires: exp * 1000 });
  });

  test('refresh tells the user to sign in again when Cursor ends the session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { shouldLogout: true })));
    await expect(cursorRefresh({ access: 'a', refresh: 'r', expires: 0 }, new AbortController().signal)).rejects.toThrow('Run /login again');
  });
});
