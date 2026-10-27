import { expect, test } from 'vitest';
import { CLAUDE_AUTHORIZE_ORIGIN, CLAUDE_AUTHORIZE_PATH, CLAUDE_OAUTH_SCOPES, rewriteClaudeAuthorizeUrl } from '../src/auth.ts';

test('rewriteClaudeAuthorizeUrl replaces the host path and scopes while keeping PKCE params', () => {
  const source = new URL('https://claude.ai/oauth/authorize');
  source.searchParams.set('code', 'true');
  source.searchParams.set('client_id', '9d1c250a-e61b-44d9-88ed-5944d1962f5e');
  source.searchParams.set('response_type', 'code');
  source.searchParams.set('redirect_uri', 'https://platform.claude.com/oauth/code/callback');
  source.searchParams.set('scope', 'org:create_api_key user:profile user:inference');
  source.searchParams.set('code_challenge', 'challenge');
  source.searchParams.set('code_challenge_method', 'S256');
  source.searchParams.set('state', 'state-value');

  const rewritten = new URL(rewriteClaudeAuthorizeUrl(source.toString()));
  expect(rewritten.origin).toBe(CLAUDE_AUTHORIZE_ORIGIN);
  expect(rewritten.pathname).toBe(CLAUDE_AUTHORIZE_PATH);
  expect(rewritten.searchParams.get('scope')).toBe(CLAUDE_OAUTH_SCOPES);
  expect(rewritten.searchParams.get('client_id')).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
  expect(rewritten.searchParams.get('redirect_uri')).toBe('https://platform.claude.com/oauth/code/callback');
  expect(rewritten.searchParams.get('code_challenge')).toBe('challenge');
  expect(rewritten.searchParams.get('state')).toBe('state-value');
});
