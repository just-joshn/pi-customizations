import type { OAuthLoginCallbacks } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cursorLogin, cursorRefresh } from '../src/cursor/auth.ts';

const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const callbacks = () => ({ onAuth: vi.fn(), onDeviceCode: vi.fn(), onPrompt: vi.fn(), onSelect: vi.fn() }) as unknown as OAuthLoginCallbacks;
const respond = (body: unknown, status = 200) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(status, body)));
const stale = { access: 'a', refresh: 'r', expires: 0 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Cursor sign-in failures', () => {
  test('stops with the HTTP status when polling gets an unexpected error', async () => {
    respond({}, 500);
    await expect(cursorLogin(callbacks())).rejects.toThrow('Cursor sign-in failed: HTTP 500');
  });

  test('rejects an approval that carries no refresh token', async () => {
    respond({ accessToken: jwt(Math.floor(Date.now() / 1000) + 60) });
    await expect(cursorLogin(callbacks())).rejects.toThrow('without a Cursor access token');
  });

  test('rejects an access token that is not a JWT or has no expiry', async () => {
    respond({ accessToken: 'opaque', refreshToken: 'r' });
    await expect(cursorLogin(callbacks())).rejects.toThrow('not a JWT');
    respond({ accessToken: jwt(0), refreshToken: 'r' });
    await expect(cursorLogin(callbacks())).rejects.toThrow('no expiry');
  });

  test('times out after 150 unapproved polls', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    const assertion = expect(cursorLogin(callbacks())).rejects.toThrow('timed out before it was approved');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(150);
  });

  test('cancelling while waiting rejects with the abort reason', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    const controller = new AbortController();
    const assertion = expect(cursorLogin({ ...callbacks(), signal: controller.signal })).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(10);
    controller.abort(new Error('cancelled'));
    await assertion;
  });
});

describe('Cursor token refresh failures', () => {
  const signal = () => new AbortController().signal;

  test('surfaces a server outage and a missing access token', async () => {
    respond({}, 503);
    await expect(cursorRefresh(stale, signal())).rejects.toThrow('HTTP 503');
    respond({}, 400);
    await expect(cursorRefresh(stale, signal())).rejects.toThrow('refresh failed: HTTP 400');
  });

  test("includes Cursor's reason when it ends the session", async () => {
    respond({ shouldLogout: true, error: 'revoked' });
    await expect(cursorRefresh(stale, signal())).rejects.toThrow('Cursor ended this sign-in: revoked. Run /login again.');
  });

  test('adopts a rotated refresh token', async () => {
    respond({ access_token: jwt(Math.floor(Date.now() / 1000) + 60), refresh_token: 'rotated' });
    expect((await cursorRefresh(stale, signal())).refresh).toBe('rotated');
  });
});
