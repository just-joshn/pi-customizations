import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import {
  CLAUDE_AUTHORIZE_ORIGIN,
  CLAUDE_AUTHORIZE_PATH,
  CLAUDE_AUTHORIZE_QUERY_ORDER,
  CLAUDE_COPY_CODE_REDIRECT_URI,
  CLAUDE_OAUTH_CLIENT_ID,
  CLAUDE_OAUTH_SCOPES,
  buildAuthorizeUrl,
  createPkcePair,
} from '../src/auth.ts';

const FIXTURE = join(fileURLToPath(new URL('../../../parity/oauth-rea-2026-10-31/claude/fixtures', import.meta.url)), 'authorize-url-2.1.312.json');

test('authorize URL matches Claude 2.1.312 param order and fixed values', async () => {
  const fixture = JSON.parse(await readFile(FIXTURE, 'utf8')) as {
    authorize: {
      origin: string;
      pathname: string;
      query_param_order: readonly string[];
      params: {
        code: string;
        client_id: string;
        response_type: string;
        redirect_uri: string;
        scope: string;
        code_challenge_method: string;
      };
    };
  };
  const { challenge, state } = createPkcePair();
  const url = new URL(buildAuthorizeUrl({ challenge, state }));
  expect(url.origin).toBe(fixture.authorize.origin);
  expect(url.pathname).toBe(fixture.authorize.pathname);
  expect([...url.searchParams.keys()]).toStrictEqual([...fixture.authorize.query_param_order]);
  expect(url.searchParams.get('code')).toBe(fixture.authorize.params.code);
  expect(url.searchParams.get('client_id')).toBe(fixture.authorize.params.client_id);
  expect(url.searchParams.get('response_type')).toBe(fixture.authorize.params.response_type);
  expect(url.searchParams.get('redirect_uri')).toBe(fixture.authorize.params.redirect_uri);
  expect(url.searchParams.get('scope')).toBe(fixture.authorize.params.scope);
  expect(url.searchParams.get('code_challenge_method')).toBe(fixture.authorize.params.code_challenge_method);
  expect(url.searchParams.get('code_challenge')).toBe(challenge);
  expect(url.searchParams.get('state')).toBe(state);
});

test('authorize URL constants match the package exports', () => {
  expect(CLAUDE_AUTHORIZE_ORIGIN).toBe('https://claude.com');
  expect(CLAUDE_AUTHORIZE_PATH).toBe('/cai/oauth/authorize');
  expect(CLAUDE_OAUTH_CLIENT_ID).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
  expect(CLAUDE_OAUTH_SCOPES).toContain('user:plugins');
  expect(CLAUDE_COPY_CODE_REDIRECT_URI).toBe('https://platform.claude.com/oauth/code/callback');
  expect(CLAUDE_AUTHORIZE_QUERY_ORDER).toStrictEqual([
    'code',
    'client_id',
    'response_type',
    'redirect_uri',
    'scope',
    'code_challenge',
    'code_challenge_method',
    'state',
  ]);
});

test('PKCE state is independent of the verifier', () => {
  const { verifier, challenge, state } = createPkcePair();
  expect(state).not.toBe(verifier);
  expect(challenge).not.toBe(verifier);
  expect(challenge).not.toBe(state);
  expect(verifier.length).toBeGreaterThan(20);
  expect(state.length).toBeGreaterThan(20);
});
