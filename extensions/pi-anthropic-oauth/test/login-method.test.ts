import { expect, test } from 'vitest';
import { CLAUDE_AUTHORIZE_ORIGIN, CLAUDE_AUTHORIZE_PATH, CLAUDE_OAUTH_SCOPES, subscriptionAuth } from '../src/auth.ts';
import { OAUTH_ACCESS_TOKEN } from './support/credentials.ts';
import { TOKEN_URL } from './support/token-endpoint.ts';

test('subscription login defaults to paste-code authorize', async () => {
  const oauth = subscriptionAuth().oauth;
  if (!oauth) throw new Error('subscriptionAuth must provide an OAuth method');
  let selected: string | undefined;
  let authorizeUrl: URL | undefined;
  const fetchCalls: unknown[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    fetchCalls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json({ access_token: OAUTH_ACCESS_TOKEN, refresh_token: 'local-refresh', expires_in: 3600 });
  }) as typeof fetch;
  try {
    const credential = await oauth.login({
      signal: new AbortController().signal,
      notify: (event) => {
        if (event.type === 'auth_url') authorizeUrl = new URL(event.url);
      },
      prompt: async (prompt) => {
        if (prompt.type === 'select') {
          selected = prompt.options[0]?.id;
          return prompt.options[0]?.id ?? '';
        }
        if (!authorizeUrl) throw new Error('No authorization URL was shown');
        return `local-code#${authorizeUrl.searchParams.get('state')}`;
      },
    });
    expect(selected).toBe('copy-code');
    expect(authorizeUrl?.origin).toBe(CLAUDE_AUTHORIZE_ORIGIN);
    expect(authorizeUrl?.pathname).toBe(CLAUDE_AUTHORIZE_PATH);
    expect(authorizeUrl?.searchParams.get('scope')).toBe(CLAUDE_OAUTH_SCOPES);
    expect(authorizeUrl?.searchParams.get('redirect_uri')).toBe('https://platform.claude.com/oauth/code/callback');
    expect(credential).toMatchObject({ type: 'oauth', access: OAUTH_ACCESS_TOKEN });
    expect(fetchCalls).toMatchObject([
      {
        url: TOKEN_URL,
        body: {
          grant_type: 'authorization_code',
          redirect_uri: 'https://platform.claude.com/oauth/code/callback',
        },
      },
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test('subscription login posts the independent state with the authorization code', async () => {
  const oauth = subscriptionAuth().oauth;
  if (!oauth) throw new Error('subscriptionAuth must provide an OAuth method');
  let authorizeUrl: URL | undefined;
  let exchangeBody: Record<string, string> | undefined;
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    exchangeBody = JSON.parse(String(init?.body)) as Record<string, string>;
    return Response.json({ access_token: OAUTH_ACCESS_TOKEN, refresh_token: 'local-refresh', expires_in: 3600 });
  }) as typeof fetch;
  try {
    await oauth.login({
      signal: new AbortController().signal,
      notify: (event) => {
        if (event.type === 'auth_url') authorizeUrl = new URL(event.url);
      },
      prompt: async (prompt) => {
        if (prompt.type === 'select') return 'copy-code';
        if (!authorizeUrl) throw new Error('No authorization URL was shown');
        const state = authorizeUrl.searchParams.get('state');
        if (!state) throw new Error('Authorize URL lacks state');
        return `local-code#${state}`;
      },
    });
    expect(exchangeBody?.['state']).toBe(authorizeUrl?.searchParams.get('state'));
    expect(exchangeBody?.['code_verifier']).not.toBe(exchangeBody?.['state']);
    expect(exchangeBody?.['redirect_uri']).toBe('https://platform.claude.com/oauth/code/callback');
  } finally {
    globalThis.fetch = original;
  }
});

test('subscriptionAuth labels match the Claude subscription UX', () => {
  const oauth = subscriptionAuth().oauth;
  expect(oauth?.name).toBe('Claude subscription (Provider CLI)');
  expect(oauth?.loginLabel).toBe('Claude subscription (Provider CLI)');
  expect(oauth?.isSubscription).toBe(true);
});
