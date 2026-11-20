import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTHORIZE_URL, CLIENT_ID, EXPIRY_SKEW_MS, MS_PER_SECOND, SHORT_LIFETIME_SECONDS, TOKEN_LIFETIME_SECONDS, TOKEN_URL } from './support/constants.ts';
import { expectedAuthorizationGrant, expectedAuthorizeParams, JSON_HEADERS, tokenResponse } from './support/oauth.ts';
import { register } from './support/provider.ts';

const LIFETIME_MS = TOKEN_LIFETIME_SECONDS * MS_PER_SECOND;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('oauth login', () => {
  it('logs in with PKCE and exchanges the pasted code', async () => {
    const fetchMock = vi.fn(async () => tokenResponse({ access_token: 'acc', refresh_token: 'ref', expires_in: TOKEN_LIFETIME_SECONDS }));
    vi.stubGlobal('fetch', fetchMock);
    let authorizeUrl = '';
    const before = Date.now();
    const credentials = await register().config.oauth.login({
      onAuth: ({ url }: { url: string }) => {
        authorizeUrl = url;
      },
      onPrompt: async () => 'the-code#the-state',
    });
    const url = new URL(authorizeUrl);
    const verifier = url.searchParams.get('state') ?? '';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(`${url.origin}${url.pathname}`).toBe(AUTHORIZE_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual(expectedAuthorizeParams(verifier, challenge));
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fetchMock).toHaveBeenCalledWith(TOKEN_URL, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(expectedAuthorizationGrant(verifier)) });
    expect(credentials.access).toBe('acc');
    expect(credentials.refresh).toBe('ref');
    expect(credentials.expires).toBeGreaterThanOrEqual(before + LIFETIME_MS - EXPIRY_SKEW_MS);
    expect(credentials.expires).toBeLessThanOrEqual(Date.now() + LIFETIME_MS - EXPIRY_SKEW_MS);
  });

  it('rejects a failed token exchange', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => tokenResponse('bad code', false)),
    );
    await expect(register().config.oauth.login({ onAuth: () => undefined, onPrompt: async () => 'c#s' })).rejects.toThrow(/Token exchange failed/);
  });
});

describe('oauth refresh', () => {
  it('refreshes the token', async () => {
    const fetchMock = vi.fn(async () => tokenResponse({ access_token: 'acc2', refresh_token: 'ref2', expires_in: SHORT_LIFETIME_SECONDS }));
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    const credentials = await register().config.oauth.refreshToken({ refresh: 'ref1', access: 'old', expires: 0 }, signal);
    expect(fetchMock).toHaveBeenCalledWith(TOKEN_URL, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: 'ref1' }),
      signal,
    });
    expect({ access: credentials.access, refresh: credentials.refresh }).toEqual({ access: 'acc2', refresh: 'ref2' });
  });

  it('rejects a failed refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => tokenResponse('expired', false)),
    );
    await expect(register().config.oauth.refreshToken({ refresh: 'r', access: 'a', expires: 0 }, new AbortController().signal)).rejects.toThrow(/Token refresh failed/);
  });
});
