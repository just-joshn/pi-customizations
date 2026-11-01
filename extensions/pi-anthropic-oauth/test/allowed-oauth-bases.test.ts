import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, vi } from 'vitest';
import { ALLOWED_OAUTH_BASE_URLS, CUSTOM_OAUTH_URL_UNAPPROVED, readCustomOAuthBaseFromEnv, resolveCustomOAuthBase } from '../src/allowed-oauth-bases.ts';
import { CLAUDE_AUTHORIZE_URL, CLAUDE_COPY_CODE_REDIRECT_URI, CLAUDE_TOKEN_URL, createClaudeOAuth, prodClaudeOAuthEndpoints, resolveClaudeOAuthEndpoints } from '../src/oauth.ts';

const ALLOWLIST_FIXTURE = join(fileURLToPath(new URL('../../../parity/oauth-rea-2026-10-31/claude/fixtures', import.meta.url)), 'allowed-oauth-bases-2.1.312.json');

const PROD_LOGIN_SCOPE = 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload user:plugins';
const PROD_REFRESH_SCOPE = 'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload user:plugins';
const CUSTOM_LOGIN_SCOPE = 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload';
const CUSTOM_REFRESH_SCOPE = 'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload';

test.for([
  { name: 'beacon staging', raw: 'https://beacon.claude-ai.staging.ant.dev' },
  { name: 'fedstart', raw: 'https://claude.fedstart.com' },
  { name: 'fedstart staging', raw: 'https://claude-staging.fedstart.com' },
  { name: 'trailing slash stripped', raw: 'https://claude.fedstart.com/' },
])('allows $name', ({ raw }) => {
  expect(resolveCustomOAuthBase(raw)).toBe(raw.replace(/\/$/, ''));
});

test.for([
  { name: 'unset', raw: undefined, expected: undefined },
  { name: 'empty', raw: '', expected: undefined },
])('$name keeps prod (undefined base)', ({ raw, expected }) => {
  expect(resolveCustomOAuthBase(raw)).toBe(expected);
});

test.for([
  { name: 'prod cai host', raw: 'https://claude.com' },
  { name: 'platform token host', raw: 'https://platform.claude.com' },
  { name: 'random https', raw: 'https://evil.example' },
  { name: 'allowlist path suffix', raw: 'https://claude.fedstart.com/extra' },
])('denies $name with Claude miss string', ({ raw }) => {
  expect(() => resolveCustomOAuthBase(raw)).toThrow(CUSTOM_OAUTH_URL_UNAPPROVED);
});

test('allowlist matches allowed-oauth-bases-2.1.312.json hosts in order', async () => {
  const fixture = JSON.parse(await readFile(ALLOWLIST_FIXTURE, 'utf8')) as {
    version: string;
    values: readonly string[];
  };
  expect(fixture.version).toBe('2.1.312');
  expect([...ALLOWED_OAUTH_BASE_URLS]).toStrictEqual([...fixture.values]);
});

test('readCustomOAuthBaseFromEnv ignores missing env', () => {
  expect(readCustomOAuthBaseFromEnv({})).toBeUndefined();
});

test('unset custom URL resolves to prod cai endpoints', () => {
  expect(resolveClaudeOAuthEndpoints(undefined)).toStrictEqual(prodClaudeOAuthEndpoints());
  expect(prodClaudeOAuthEndpoints()).toStrictEqual({
    authorizeUrl: CLAUDE_AUTHORIZE_URL,
    tokenUrl: CLAUDE_TOKEN_URL,
    revokeUrl: `${CLAUDE_TOKEN_URL}/revoke`,
    apiBaseUrl: 'https://api.anthropic.com',
    copyCodeRedirectUri: CLAUDE_COPY_CODE_REDIRECT_URI,
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    loginScope: PROD_LOGIN_SCOPE,
    refreshScope: PROD_REFRESH_SCOPE,
  });
});

test('allowlisted custom URL resolves the custom oauth profile', () => {
  const base = 'https://claude.fedstart.com';
  expect(resolveClaudeOAuthEndpoints(base)).toStrictEqual({
    authorizeUrl: `${base}/oauth/authorize`,
    tokenUrl: `${base}/v1/oauth/token`,
    revokeUrl: `${base}/v1/oauth/token/revoke`,
    apiBaseUrl: base,
    copyCodeRedirectUri: `${base}/oauth/code/callback`,
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    loginScope: CUSTOM_LOGIN_SCOPE,
    refreshScope: CUSTOM_REFRESH_SCOPE,
  });
});

test('createClaudeOAuth rejects an unapproved custom base at construction', () => {
  expect(() => createClaudeOAuth({ customOAuthUrl: 'https://evil.example' })).toThrow(CUSTOM_OAUTH_URL_UNAPPROVED);
});

test('custom copy-code flow stays on the allowlisted host', async () => {
  const base = 'https://claude.fedstart.com';
  const tokenBody = {
    access_token: 'sk-ant-oat01-custom-host',
    refresh_token: 'sk-ant-ort01-custom-host',
    expires_in: 3600,
  };
  const calls: { url: string; body: Record<string, string> }[] = [];
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, string> });
    return Response.json(tokenBody);
  });
  try {
    const oauth = createClaudeOAuth({ customOAuthUrl: base });
    let authorizeUrl: URL | undefined;
    const credential = await oauth.login({
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
    expect(credential).toMatchObject({
      type: 'oauth',
      access: tokenBody.access_token,
      refresh: tokenBody.refresh_token,
    });
    expect(authorizeUrl?.origin).toBe(base);
    expect(authorizeUrl?.pathname).toBe('/oauth/authorize');
    expect(authorizeUrl?.searchParams.get('redirect_uri')).toBe(`${base}/oauth/code/callback`);
    expect(authorizeUrl?.searchParams.get('scope')).toBe(CUSTOM_LOGIN_SCOPE);
    await oauth.refresh(credential, new AbortController().signal);
    expect(calls.map((call) => call.url)).toEqual([`${base}/v1/oauth/token`, `${base}/v1/oauth/token`]);
    expect(calls[0]?.body).toMatchObject({
      grant_type: 'authorization_code',
      code: 'local-code',
      redirect_uri: `${base}/oauth/code/callback`,
    });
    expect(calls[1]?.body).toMatchObject({
      grant_type: 'refresh_token',
      scope: CUSTOM_REFRESH_SCOPE,
      refresh_token: tokenBody.refresh_token,
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

test('createClaudeOAuth with empty customOAuthUrl forces prod even when env is set', () => {
  vi.stubEnv('CLAUDE_CODE_CUSTOM_OAUTH_URL', 'https://evil.example');
  try {
    const oauth = createClaudeOAuth({ customOAuthUrl: '' });
    expect(oauth.name).toBe('Claude subscription (Provider CLI)');
  } finally {
    vi.unstubAllEnvs();
  }
});

test('a client id override replaces the client id and drops the plugins scope', () => {
  const endpoints = resolveClaudeOAuthEndpoints(undefined, 'custom-client');
  expect(endpoints.clientId).toBe('custom-client');
  expect(endpoints.loginScope).toBe(CUSTOM_LOGIN_SCOPE);
  expect(endpoints.refreshScope).toBe(CUSTOM_REFRESH_SCOPE);
  expect(endpoints.tokenUrl).toBe(CLAUDE_TOKEN_URL);
});
