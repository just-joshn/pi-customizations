import { expect, test, vi } from 'vitest';
import {
  CLAUDE_COPY_CODE_REDIRECT_URI,
  CLAUDE_OAUTH_CLIENT_ID,
  CLAUDE_TOKEN_URL,
  createClaudeOAuth,
  exchangeAuthorizationCodeResult,
} from '../src/oauth.ts';
import { oauthCredential } from './support/credentials.ts';

const EXCHANGE = {
  code: 'local-code',
  state: 'state-value',
  redirectUri: CLAUDE_COPY_CODE_REDIRECT_URI,
  verifier: 'verifier-value',
};

test('exchangeAuthorizationCodeResult matches the stub token response', async () => {
  const body = {
    access_token: 'sk-ant-oat01-stub-access',
    refresh_token: 'sk-ant-ort01-stub-refresh',
    expires_in: 3600,
    refresh_token_expires_in: 2_592_000,
  };
  let seenUrl = '';
  let seenBody: unknown;
  const now = 1_762_000_000_000;
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    seenUrl = String(input);
    seenBody = JSON.parse(String(init?.body));
    return Response.json(body);
  });
  try {
    const result = await exchangeAuthorizationCodeResult(EXCHANGE, new AbortController().signal);
    expect(seenUrl).toBe(CLAUDE_TOKEN_URL);
    expect(seenBody).toEqual({
      grant_type: 'authorization_code',
      code: EXCHANGE.code,
      redirect_uri: EXCHANGE.redirectUri,
      client_id: CLAUDE_OAUTH_CLIENT_ID,
      code_verifier: EXCHANGE.verifier,
      state: EXCHANGE.state,
    });
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual(body);
    expect(result.credential).toEqual({
      type: 'oauth',
      access: body.access_token,
      refresh: body.refresh_token,
      expires: now + body.expires_in * 1000,
    });
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

test('a 201 token response with a valid body is not a successful exchange', async () => {
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0]) => {
    expect(String(input)).toBe(CLAUDE_TOKEN_URL);
    return Response.json(
      {
        access_token: 'sk-ant-oat01-created',
        refresh_token: 'sk-ant-ort01-created',
        expires_in: 3600,
      },
      { status: 201, statusText: 'Created' },
    );
  });
  try {
    await expect(exchangeAuthorizationCodeResult(EXCHANGE, new AbortController().signal)).rejects.toThrow(
      'Token exchange failed (201): Created',
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

test('a 204 token response is not a successful refresh', async () => {
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0]) => {
    expect(String(input)).toBe(CLAUDE_TOKEN_URL);
    return new Response(null, { status: 204, statusText: 'No Content' });
  });
  try {
    const oauth = createClaudeOAuth({ customOAuthUrl: '' });
    await expect(oauth.refresh(oauthCredential(), new AbortController().signal)).rejects.toThrow(
      'Token refresh failed: No Content',
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
