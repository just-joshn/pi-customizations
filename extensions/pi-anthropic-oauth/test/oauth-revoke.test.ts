import { expect, vi } from 'vitest';
import { CLAUDE_OAUTH_CLIENT_ID, CLAUDE_REVOKE_URL, revokeAccessToken } from '../src/oauth.ts';
import { OAUTH_ACCESS_TOKEN } from './support/credentials.ts';
import { test } from './network-guard.ts';

test('revokeAccessToken POSTs Claude revoke URL with token, token_type_hint, and client_id', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { 'request-id': 'req_test' } }));
  vi.stubGlobal('fetch', fetchMock);

  await revokeAccessToken(OAUTH_ACCESS_TOKEN, new AbortController().signal);

  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(String(url)).toBe(CLAUDE_REVOKE_URL);
  expect(CLAUDE_REVOKE_URL).toBe('https://platform.claude.com/v1/oauth/token/revoke');
  expect(init?.method).toBe('POST');
  expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(String(init?.body))).toEqual({
    token: OAUTH_ACCESS_TOKEN,
    token_type_hint: 'access_token',
    client_id: CLAUDE_OAUTH_CLIENT_ID,
  });
});

test('revokeAccessToken swallows network failures so logout can continue', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
  await expect(revokeAccessToken(OAUTH_ACCESS_TOKEN, new AbortController().signal)).resolves.toBeUndefined();
});

test('revokeAccessToken aborts before fetch when the signal is already aborted', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const controller = new AbortController();
  controller.abort();
  await expect(revokeAccessToken(OAUTH_ACCESS_TOKEN, controller.signal)).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('revokeAccessToken rethrows when the caller aborts during fetch', async () => {
  const controller = new AbortController();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (_input: unknown, init?: RequestInit) => {
      controller.abort();
      init?.signal?.throwIfAborted();
      return new Response(null, { status: 200 });
    }),
  );
  await expect(revokeAccessToken(OAUTH_ACCESS_TOKEN, controller.signal)).rejects.toThrow();
});
