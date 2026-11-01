import { readFile } from 'node:fs/promises';

import { createModels, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { expect, vi } from 'vitest';
import { CLAUDE_AUTHORIZE_ORIGIN, CLAUDE_AUTHORIZE_PATH, CLAUDE_OAUTH_SCOPES } from '../src/auth.ts';
import { ask, PIXEL, user } from './support/context.ts';
import { OAUTH_ACCESS_TOKEN } from './support/credentials.ts';
import { test } from './support/fixtures.ts';
import { soleRequest, systemTexts } from './support/request-body.ts';
import { collect } from './support/run-stream.ts';

const CAPTURED_BILLING = 'x-anthropic-billing-header: cc_version=2.1.316.959; cc_entrypoint=sdk-cli;';

const fingerprintCases = [
  { name: 'short text', content: 'hi', expected: '2e4' },
  { name: 'length 4', content: 'abcd', expected: '2e4' },
  { name: 'length 5', content: 'abcde', expected: 'd32' },
  { name: 'length 7', content: 'abcdefg', expected: 'd32' },
  { name: 'length 8', content: 'abcdefgh', expected: 'ecf' },
  { name: 'length 20', content: 'abcdefghijklmnopqrst', expected: 'ecf' },
  { name: 'length 21', content: 'abcdefghijklmnopqrstu', expected: '710' },
  { name: 'empty text (target-only)', content: '', expected: '2e4' },
  { name: 'Unicode text', content: '😀 hello 😀 world of Claude', expected: '8a1' },
  { name: 'an image without text (target-only)', content: [PIXEL], expected: '2e4' },
  { name: 'the first text block after an image (target-only)', content: [PIXEL, { type: 'text', text: 'Reply LOCAL_OK.' }], expected: '959' },
] satisfies readonly { name: string; content: Parameters<typeof user>[0]; expected: string }[];

test.for(fingerprintCases)('billing derives from $name', async ({ content, expected }, { models, model, server }) => {
  await collect(models.streamSimple(model, { messages: [user(content)] }));
  expect(systemTexts(soleRequest(server).body)[0]).toBe(`x-anthropic-billing-header: cc_version=2.1.316.${expected}; cc_entrypoint=sdk-cli;`);
});

test('later messages keep the first-user identity', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, { messages: [user('Reply LOCAL_OK.'), user('changed first message')] }));
  expect(systemTexts(soleRequest(server).body)[0]).toBe(CAPTURED_BILLING);
});

test('billing skips a leading isMeta user for the fingerprint sample', async ({ models, model, server }) => {
  const meta = Object.assign(user('changed first message'), { isMeta: true });
  await collect(models.streamSimple(model, { messages: [meta, user('Reply LOCAL_OK.')] }));
  expect(systemTexts(soleRequest(server).body)[0]).toBe(CAPTURED_BILLING);
});

test('billing skips a leading isCompactSummary user for the fingerprint sample', async ({ models, model, server }) => {
  const summary = Object.assign(user('changed first message'), { isCompactSummary: true });
  await collect(models.streamSimple(model, { messages: [summary, user('Reply LOCAL_OK.')] }));
  expect(systemTexts(soleRequest(server).body)[0]).toBe(CAPTURED_BILLING);
});

test('concurrent requests keep identity request-local', async ({ models, model, server }) => {
  const first = ask('Reply LOCAL_OK.');
  const second = ask('changed first message');
  const before = structuredClone([first, second]);
  await Promise.all([collect(models.streamSimple(model, first)), collect(models.streamSimple(model, second))]);
  expect(new Set(server.requests.map(({ body }) => systemTexts(body)[0]))).toStrictEqual(new Set([CAPTURED_BILLING, 'x-anthropic-billing-header: cc_version=2.1.316.c94; cc_entrypoint=sdk-cli;']));
  expect([first, second]).toStrictEqual(before);
});

test('identity matches the current Claude SDK fixture', async ({ models, model, server }) => {
  const reference = JSON.parse(await readFile(new URL('./fixtures/claude-code-2.1.316.json', import.meta.url), 'utf8'));
  await collect(models.streamSimple(model, ask(reference.prompt)));
  expect(systemTexts(soleRequest(server).body)[0]).toBe(reference.billing);
  expect(soleRequest(server).headers['user-agent']).toBe(reference.headers['user-agent']);
});

test('the user agent matches the installed Claude Code capture', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, ask('Reply LOCAL_OK.')));
  expect(soleRequest(server).headers['user-agent']).toBe('claude-cli/2.1.316 (external, sdk-cli)');
});

test('ambient setup tokens stay outside credential storage', async ({ provider, model, server }) => {
  const credentials = new InMemoryCredentialStore();
  const models = createModels({ credentials, authContext: { env: async (name) => (name === 'CLAUDE_CODE_OAUTH_TOKEN' ? OAUTH_ACCESS_TOKEN : undefined), fileExists: async () => false } });
  models.setProvider(provider);
  await collect(models.streamSimple(model, ask('Reply LOCAL_OK.')));
  expect(soleRequest(server).headers.authorization).toBe(`Bearer ${OAUTH_ACCESS_TOKEN}`);
  await expect(credentials.list()).resolves.toStrictEqual([]);
});

test('ambient API keys are rejected without exposure', async ({ provider }) => {
  const models = createModels({ authContext: { env: async () => 'not-an-oauth-token', fileExists: async () => false } });
  models.setProvider(provider);
  const failure = models.getAuth(provider.id);
  await expect(failure).rejects.toMatchObject({ code: 'auth' });
  await expect(failure).rejects.not.toThrow('not-an-oauth-token');
});

test('login uses Claude paste-code authorize URL with independent exchange state', async ({ provider, models, tokenEndpoint, credentials }) => {
  let urls: readonly URL[] = [];
  const credential = await models.login(provider.id, 'oauth', {
    notify: (event) => {
      if (event.type === 'auth_url') urls = [...urls, new URL(event.url)];
    },
    prompt: async (prompt) => {
      if (prompt.type === 'select') return 'copy-code';
      const [url] = urls;
      if (!url) throw new Error('No authorization URL was shown');
      return `local-code#${url.searchParams.get('state')}`;
    },
  });
  expect(urls).toHaveLength(1);
  expect(urls[0]?.origin).toBe(CLAUDE_AUTHORIZE_ORIGIN);
  expect(urls[0]?.pathname).toBe(CLAUDE_AUTHORIZE_PATH);
  expect(urls[0]?.searchParams.get('scope')).toBe(CLAUDE_OAUTH_SCOPES);
  expect(urls[0]?.searchParams.get('code_challenge_method')).toBe('S256');
  expect([...urls[0]!.searchParams.keys()]).toStrictEqual([
    'code',
    'client_id',
    'response_type',
    'redirect_uri',
    'scope',
    'code_challenge',
    'code_challenge_method',
    'state',
  ]);
  const state = urls[0]?.searchParams.get('state');
  expect(tokenEndpoint.requests).toMatchObject([
    {
      body: {
        grant_type: 'authorization_code',
        code: 'local-code',
        client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
        redirect_uri: 'https://platform.claude.com/oauth/code/callback',
        state,
      },
    },
  ]);
  const exchange = tokenEndpoint.requests[0]?.body as { code_verifier?: string; state?: string };
  expect(exchange.state).toBe(state);
  expect(exchange.code_verifier).not.toBe(state);
  await expect(credentials.read(provider.id)).resolves.toStrictEqual(credential);
});

test('refresh errors do not expose server tokens', async ({ provider }) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ access_token: 'sensitive-server-value' }, { status: 400 })));
  const oauth = provider.auth.oauth;
  if (!oauth) throw new Error('No OAuth login');
  const failure = oauth.refresh({ type: 'oauth', access: OAUTH_ACCESS_TOKEN, refresh: 'local-refresh', expires: 0 }, new AbortController().signal);
  await expect(failure).rejects.toThrow('Claude subscription token refresh failed');
  await expect(failure).rejects.not.toThrow('sensitive-server-value');
});
