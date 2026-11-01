import { expect, vi } from 'vitest';
import { CLAUDE_OAUTH_CLIENT_ID, CLAUDE_REVOKE_URL, revokeAccessToken, revokeRefreshToken } from '../src/oauth.ts';
import { test } from './network-guard.ts';
import { OAUTH_ACCESS_TOKEN, OAUTH_REFRESH_TOKEN } from './support/credentials.ts';

test('revokeAccessToken POSTs Claude revoke URL with token, token_type_hint, and client_id', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { 'request-id': 'req_test' } }));
  vi.stubGlobal('fetch', fetchMock);

  await revokeAccessToken(OAUTH_ACCESS_TOKEN, new AbortController().signal);

  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0] ?? [];
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

test('revokeRefreshToken POSTs Claude revoke URL with refresh_token hint', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { 'request-id': 'req_refresh' } }));
  vi.stubGlobal('fetch', fetchMock);

  await revokeRefreshToken(OAUTH_REFRESH_TOKEN, new AbortController().signal);

  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  expect(String(url)).toBe(CLAUDE_REVOKE_URL);
  expect(init?.method).toBe('POST');
  expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(String(init?.body))).toEqual({
    token: OAUTH_REFRESH_TOKEN,
    token_type_hint: 'refresh_token',
    client_id: CLAUDE_OAUTH_CLIENT_ID,
  });
});

test('revokeAccessToken reports a network failure as not acknowledged', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
  await expect(revokeAccessToken(OAUTH_ACCESS_TOKEN, new AbortController().signal)).resolves.toBe(false);
});

test('revokeRefreshToken reports a network failure as not acknowledged', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
  await expect(revokeRefreshToken(OAUTH_REFRESH_TOKEN, new AbortController().signal)).resolves.toBe(false);
});

test('revokeAccessToken aborts before fetch when the signal is already aborted', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const controller = new AbortController();
  controller.abort();
  await expect(revokeAccessToken(OAUTH_ACCESS_TOKEN, controller.signal)).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('revokeRefreshToken aborts before fetch when the signal is already aborted', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const controller = new AbortController();
  controller.abort();
  await expect(revokeRefreshToken(OAUTH_REFRESH_TOKEN, controller.signal)).rejects.toThrow();
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

test('revokeRefreshToken rethrows when the caller aborts during fetch', async () => {
  const controller = new AbortController();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (_input: unknown, init?: RequestInit) => {
      controller.abort();
      init?.signal?.throwIfAborted();
      return new Response(null, { status: 200 });
    }),
  );
  await expect(revokeRefreshToken(OAUTH_REFRESH_TOKEN, controller.signal)).rejects.toThrow();
});

test('a 2xx without a request id is not an acknowledgement', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  await expect(revokeAccessToken(OAUTH_ACCESS_TOKEN, new AbortController().signal)).resolves.toBe(false);
});

test('a 2xx stamped with a request id is acknowledged', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { 'request-id': 'req_ack' } })));
  await expect(revokeRefreshToken(OAUTH_REFRESH_TOKEN, new AbortController().signal)).resolves.toBe(true);
});

test('a custom base revokes at its own URL with its own client id', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { 'request-id': 'req_custom' } }));
  vi.stubGlobal('fetch', fetchMock);
  await revokeAccessToken(OAUTH_ACCESS_TOKEN, new AbortController().signal, { revokeUrl: 'https://claude.fedstart.com/v1/oauth/token/revoke', clientId: 'custom-client' });
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  expect(String(url)).toBe('https://claude.fedstart.com/v1/oauth/token/revoke');
  expect(JSON.parse(String(init?.body))).toMatchObject({ client_id: 'custom-client' });
});
