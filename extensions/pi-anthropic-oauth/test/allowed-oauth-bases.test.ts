import { expect, test, vi } from 'vitest';
import {
  ALLOWED_OAUTH_BASE_URLS,
  CUSTOM_OAUTH_URL_UNAPPROVED,
  readCustomOAuthBaseFromEnv,
  resolveCustomOAuthBase,
} from '../src/allowed-oauth-bases.ts';
import {
  createClaudeOAuth,
  CLAUDE_AUTHORIZE_URL,
  CLAUDE_COPY_CODE_REDIRECT_URI,
  CLAUDE_TOKEN_URL,
  prodClaudeOAuthEndpoints,
  resolveClaudeOAuthEndpoints,
} from '../src/oauth.ts';

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

test('allowlist matches the Claude 2.1.316 fixture hosts in order', () => {
  expect([...ALLOWED_OAUTH_BASE_URLS]).toStrictEqual([
    'https://beacon.claude-ai.staging.ant.dev',
    'https://claude.fedstart.com',
    'https://claude-staging.fedstart.com',
  ]);
});

test('readCustomOAuthBaseFromEnv ignores missing env', () => {
  expect(readCustomOAuthBaseFromEnv({})).toBeUndefined();
});

test('unset custom URL resolves to prod cai endpoints', () => {
  expect(resolveClaudeOAuthEndpoints(undefined)).toStrictEqual(prodClaudeOAuthEndpoints());
  expect(prodClaudeOAuthEndpoints()).toStrictEqual({
    authorizeUrl: CLAUDE_AUTHORIZE_URL,
    tokenUrl: CLAUDE_TOKEN_URL,
    copyCodeRedirectUri: CLAUDE_COPY_CODE_REDIRECT_URI,
  });
});

test('allowlisted custom URL rewrites authorize, token, and paste-code redirect', () => {
  const base = 'https://claude.fedstart.com';
  expect(resolveClaudeOAuthEndpoints(base)).toStrictEqual({
    authorizeUrl: `${base}/oauth/authorize`,
    tokenUrl: `${base}/v1/oauth/token`,
    copyCodeRedirectUri: `${base}/oauth/code/callback`,
  });
});

test('createClaudeOAuth rejects an unapproved custom base at construction', () => {
  expect(() => createClaudeOAuth({ customOAuthUrl: 'https://evil.example' })).toThrow(CUSTOM_OAUTH_URL_UNAPPROVED);
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
