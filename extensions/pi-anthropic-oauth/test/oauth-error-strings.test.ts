import { expect, vi } from 'vitest';
import { LOGIN_CANCELLED, LOGIN_TIMED_OUT, subscriptionAuth } from '../src/auth.ts';
import { OAUTH_ACCESS_TOKEN, oauthCredential } from './support/credentials.ts';
import { test } from './network-guard.ts';
import { TOKEN_URL } from './support/token-endpoint.ts';

async function pasteLogin(status: number, statusText: string): Promise<unknown> {
  const oauth = subscriptionAuth().oauth;
  if (!oauth) throw new Error('subscriptionAuth must provide an OAuth method');
  let authorizeUrl: URL | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
      expect(String(input)).toBe(TOKEN_URL);
      return new Response('{}', {
        status,
        statusText,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return oauth.login({
    signal: new AbortController().signal,
    notify: (event) => {
      if (event.type === 'auth_url') authorizeUrl = new URL(event.url);
    },
    prompt: async (prompt) => {
      if (prompt.type === 'select') return 'copy-code';
      if (!authorizeUrl) throw new Error('No authorization URL was shown');
      return `local-code#${authorizeUrl.searchParams.get('state')}`;
    },
  });
}

test('exchange 401 surfaces Claude invalid authorization code string', async () => {
  await expect(pasteLogin(401, 'Unauthorized')).rejects.toThrow('Authentication failed: Invalid authorization code');
});

test('exchange non-401 surfaces Claude token exchange failed string', async () => {
  await expect(pasteLogin(503, 'Service Unavailable')).rejects.toThrow('Token exchange failed (503): Service Unavailable');
});

test('refresh non-200 surfaces Claude token refresh failed string', async () => {
  const oauth = subscriptionAuth().oauth;
  if (!oauth) throw new Error('subscriptionAuth must provide an OAuth method');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
  await expect(oauth.refresh(oauthCredential(), new AbortController().signal)).rejects.toThrow(
    'Token refresh failed: Bad Request',
  );
});

test('login cancellation still passes through', async () => {
  const oauth = subscriptionAuth().oauth;
  if (!oauth) throw new Error('subscriptionAuth must provide an OAuth method');
  await expect(
    oauth.login({
      signal: new AbortController().signal,
      notify: () => undefined,
      prompt: async () => {
        throw new Error(LOGIN_CANCELLED);
      },
    }),
  ).rejects.toThrow(LOGIN_CANCELLED);
});

test('login timeout still passes through', async () => {
  const oauth = subscriptionAuth().oauth;
  if (!oauth) throw new Error('subscriptionAuth must provide an OAuth method');
  await expect(
    oauth.login({
      signal: new AbortController().signal,
      notify: () => undefined,
      prompt: async () => {
        throw new Error(LOGIN_TIMED_OUT);
      },
    }),
  ).rejects.toThrow(LOGIN_TIMED_OUT);
});

test('refresh abort still passes through', async () => {
  const oauth = subscriptionAuth().oauth;
  if (!oauth) throw new Error('subscriptionAuth must provide an OAuth method');
  const controller = new AbortController();
  const reason = new DOMException('Cancelled', 'AbortError');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => {
      controller.abort(reason);
      throw reason;
    }),
  );
  await expect(oauth.refresh(oauthCredential({ access: OAUTH_ACCESS_TOKEN }), controller.signal)).rejects.toBe(reason);
});
