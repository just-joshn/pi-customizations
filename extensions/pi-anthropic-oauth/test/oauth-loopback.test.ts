import type { AuthEvent, ProviderAuthInteraction } from '@earendil-works/pi-ai';
import { expect, vi } from 'vitest';
import {
  CLAUDE_AUTHORIZE_ORIGIN,
  CLAUDE_AUTHORIZE_PATH,
  CLAUDE_OAUTH_CLIENT_ID,
  LOGIN_CANCELLED,
  LOGIN_TIMED_OUT,
  subscriptionAuth,
} from '../src/auth.ts';
import { test } from './network-guard.ts';
import { OAUTH_ACCESS_TOKEN } from './support/credentials.ts';
import { TOKEN_URL } from './support/token-endpoint.ts';

const LOOPBACK_LIMIT_MS = 15 * 60 * 1000;

function interaction(select: 'copy-code' | 'loopback', manual?: string): {
  login: ProviderAuthInteraction;
  events: AuthEvent[];
} {
  const events: AuthEvent[] = [];
  const login: ProviderAuthInteraction = {
    signal: new AbortController().signal,
    notify(event) {
      events.push(event);
    },
    prompt: async (prompt) => {
      if (prompt.type === 'select') return select;
      if (manual !== undefined) return manual;
      return new Promise<string>(() => undefined);
    },
  };
  return { login, events };
}

async function waitForUrl(events: AuthEvent[]): Promise<string> {
  return vi.waitFor(() => {
    const found = events.find((event) => event.type === 'auth_url');
    if (found?.type !== 'auth_url') throw new Error('authorize URL was not shown');
    return found.url;
  });
}

test('loopback login exchanges the callback code with a matching localhost redirect_uri', async () => {
  const exchangeBodies: Record<string, string>[] = [];
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) return realFetch(input, init);
    expect(url).toBe(TOKEN_URL);
    exchangeBodies.push(JSON.parse(String(init?.body)) as Record<string, string>);
    return Response.json({ access_token: OAUTH_ACCESS_TOKEN, refresh_token: 'local-refresh', expires_in: 3600 });
  });

  const oauth = subscriptionAuth().oauth;
  if (!oauth) throw new Error('subscriptionAuth must provide an OAuth method');
  const { login, events } = interaction('loopback');
  const pending = oauth.login(login);
  const authorize = new URL(await waitForUrl(events));
  expect(authorize.origin).toBe(CLAUDE_AUTHORIZE_ORIGIN);
  expect(authorize.pathname).toBe(CLAUDE_AUTHORIZE_PATH);
  const redirect = new URL(authorize.searchParams.get('redirect_uri') ?? '');
  expect(redirect.protocol).toBe('http:');
  expect(redirect.hostname).toBe('localhost');
  expect(redirect.pathname).toBe('/callback');
  redirect.searchParams.set('code', 'loopback-code');
  redirect.searchParams.set('state', authorize.searchParams.get('state') ?? '');
  const callbackResponse = await fetch(redirect);
  expect(callbackResponse.status).toBe(200);
  expect(await callbackResponse.text()).toContain('Signed in');

  const credential = await pending;
  expect(credential).toMatchObject({ type: 'oauth', access: OAUTH_ACCESS_TOKEN, refresh: 'local-refresh' });
  expect(exchangeBodies).toStrictEqual([
    {
      grant_type: 'authorization_code',
      code: 'loopback-code',
      redirect_uri: `http://localhost:${redirect.port}/callback`,
      client_id: CLAUDE_OAUTH_CLIENT_ID,
      code_verifier: expect.any(String),
      state: authorize.searchParams.get('state'),
    },
  ]);
  expect(exchangeBodies[0]?.['code_verifier']).not.toBe(exchangeBodies[0]?.['state']);
});

test('loopback login rejects a callback with the wrong state', async () => {
  const oauth = subscriptionAuth().oauth;
  if (!oauth) throw new Error('subscriptionAuth must provide an OAuth method');
  const { login, events } = interaction('loopback');
  const pending = oauth.login(login);
  const failure = pending.then(
    () => {
      throw new Error('login resolved');
    },
    (error: unknown) => error,
  );
  const authorize = new URL(await waitForUrl(events));
  const redirect = new URL(authorize.searchParams.get('redirect_uri') ?? '');
  redirect.searchParams.set('code', 'loopback-code');
  redirect.searchParams.set('state', 'wrong-state');
  const callbackResponse = await fetch(redirect);
  expect(callbackResponse.status).toBe(400);
  const error = await failure;
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe('Claude subscription login failed. Try /login again.');
});

test('loopback listen timeout is not login cancellation', async () => {
  vi.useFakeTimers();
  try {
    expect(LOGIN_TIMED_OUT).not.toBe(LOGIN_CANCELLED);
    const oauth = subscriptionAuth().oauth;
    if (!oauth) throw new Error('subscriptionAuth must provide an OAuth method');
    const { login, events } = interaction('loopback');
    const pending = oauth.login(login);
    await waitForUrl(events);
    const failure = expect(pending).rejects.toThrow(LOGIN_TIMED_OUT);
    await vi.advanceTimersByTimeAsync(LOOPBACK_LIMIT_MS);
    await failure;
  } finally {
    vi.useRealTimers();
  }
});
