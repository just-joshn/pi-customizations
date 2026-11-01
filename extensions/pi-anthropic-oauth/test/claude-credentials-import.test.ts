import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { createClaudeOAuth, subscriptionAuth } from '../src/auth.ts';
import {
  CLAUDE_KEYCHAIN_SERVICE_DEFAULT,
  claudeKeychainAccount,
  claudeKeychainService,
  importClaudeAiOauth,
  parseClaudeCredentialsJson,
  resolveClaudeCredentialsLayout,
  toPiOAuthCredential,
} from '../src/claude-credentials.ts';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('credentials-layout fixture documents the default keychain service and account rules', async () => {
  const layout = JSON.parse(await readFile(join(fixturesDir, 'credentials-layout.json'), 'utf8')) as {
    keychain: { serviceDefault: string; account: { sanitizedFallback: string } };
    payload: { topLevelKey: string };
    piMapping: { type: string; access: string; refresh: string; expires: string };
  };
  expect(layout.keychain.serviceDefault).toBe(CLAUDE_KEYCHAIN_SERVICE_DEFAULT);
  expect(layout.keychain.account.sanitizedFallback).toBe('claude-code-user');
  expect(layout.payload.topLevelKey).toBe('claudeAiOauth');
  expect(layout.piMapping).toEqual({
    type: 'oauth',
    access: 'claudeAiOauth.accessToken',
    refresh: 'claudeAiOauth.refreshToken',
    expires: 'claudeAiOauth.expiresAt',
  });
});

test('parseClaudeCredentialsJson maps the sample fixture into Pi oauth fields', async () => {
  const raw = await readFile(join(fixturesDir, 'credentials-layout.sample.json'), 'utf8');
  const oauth = parseClaudeCredentialsJson(raw);
  expect(toPiOAuthCredential(oauth)).toEqual({
    type: 'oauth',
    access: 'sk-ant-oat01-fixture-access-token-value-aaaaaaaa',
    refresh: 'sk-ant-ort01-fixture-refresh-token-value-bbbbbbbb',
    expires: 1893456000000,
  });
});

test('parseClaudeCredentialsJson accepts hex-encoded keychain payloads', () => {
  const json = JSON.stringify({
    claudeAiOauth: {
      accessToken: 'sk-ant-oat01-hex-access',
      refreshToken: 'sk-ant-ort01-hex-refresh',
      expiresAt: 1_700_000_000_000,
    },
  });
  const oauth = parseClaudeCredentialsJson(Buffer.from(json, 'utf8').toString('hex'));
  expect(oauth.accessToken).toBe('sk-ant-oat01-hex-access');
  expect(oauth.refreshToken).toBe('sk-ant-ort01-hex-refresh');
  expect(oauth.expiresAt).toBe(1_700_000_000_000);
});

test.for([
  { name: 'missing object', raw: '[]', error: /must be a JSON object/ },
  { name: 'missing claudeAiOauth', raw: '{}', error: /lack claudeAiOauth/ },
  { name: 'missing refresh', raw: '{"claudeAiOauth":{"accessToken":"a","expiresAt":1}}', error: /lacks refreshToken/ },
  { name: 'invalid json', raw: 'not-json', error: /not valid JSON/ },
])('parseClaudeCredentialsJson rejects $name', ({ raw, error }) => {
  expect(() => parseClaudeCredentialsJson(raw)).toThrow(error);
});

test('default layout uses Claude Code-credentials and the sanitized USER', () => {
  const layout = resolveClaudeCredentialsLayout({
    env: {},
    homedir: () => '/Users/fixture',
    username: () => 'fixture-user',
  });
  expect(layout).toEqual({
    configDir: '/Users/fixture/.claude',
    credentialsPath: '/Users/fixture/.claude/.credentials.json',
    keychainService: 'Claude Code-credentials',
    keychainAccount: 'fixture-user',
  });
  expect(claudeKeychainService({}, () => '/tmp')).toBe('Claude Code-credentials');
  expect(claudeKeychainAccount({ USER: 'bad name!' }, () => 'ignored')).toBe('claude-code-user');
});

test('a custom CLAUDE_CONFIG_DIR hashes into the keychain service name', () => {
  const service = claudeKeychainService({ CLAUDE_CONFIG_DIR: '/custom/claude' }, () => '/Users/fixture');
  expect(service).toMatch(/^Claude Code-credentials-[0-9a-f]{8}$/);
});

test('import prefers keychain on darwin and does not read plaintext when keychain hits', async () => {
  const sample = await readFile(join(fixturesDir, 'credentials-layout.sample.json'), 'utf8');
  let plaintextReads = 0;
  const credential = await importClaudeAiOauth({
    platform: 'darwin',
    env: {},
    homedir: () => '/Users/fixture',
    username: () => 'fixture-user',
    readKeychain: async (service, account) => {
      expect(service).toBe('Claude Code-credentials');
      expect(account).toBe('fixture-user');
      return sample;
    },
    readPlaintext: async () => {
      plaintextReads += 1;
      throw new Error('plaintext should not be read');
    },
  });
  expect(plaintextReads).toBe(0);
  expect(credential).toMatchObject({
    type: 'oauth',
    access: 'sk-ant-oat01-fixture-access-token-value-aaaaaaaa',
    refresh: 'sk-ant-ort01-fixture-refresh-token-value-bbbbbbbb',
    expires: 1893456000000,
  });
});

test('import falls back to plaintext when keychain misses on darwin', async () => {
  const sample = await readFile(join(fixturesDir, 'credentials-layout.sample.json'), 'utf8');
  const credential = await importClaudeAiOauth({
    platform: 'darwin',
    env: {},
    homedir: () => '/Users/fixture',
    username: () => 'fixture-user',
    readKeychain: async () => undefined,
    readPlaintext: async (path) => {
      expect(path).toBe('/Users/fixture/.claude/.credentials.json');
      return sample;
    },
  });
  expect(credential.access).toBe('sk-ant-oat01-fixture-access-token-value-aaaaaaaa');
});

test('import uses plaintext only on non-darwin platforms', async () => {
  const sample = await readFile(join(fixturesDir, 'credentials-layout.sample.json'), 'utf8');
  let keychainReads = 0;
  const credential = await importClaudeAiOauth({
    platform: 'linux',
    env: { CLAUDE_CONFIG_DIR: '/opt/claude' },
    homedir: () => '/home/fixture',
    username: () => 'fixture-user',
    readKeychain: async () => {
      keychainReads += 1;
      return sample;
    },
    readPlaintext: async (path) => {
      expect(path).toBe('/opt/claude/.credentials.json');
      return sample;
    },
  });
  expect(keychainReads).toBe(0);
  expect(credential.refresh).toBe('sk-ant-ort01-fixture-refresh-token-value-bbbbbbbb');
});

test('import throws when neither store has credentials', async () => {
  await expect(
    importClaudeAiOauth({
      platform: 'darwin',
      env: {},
      homedir: () => '/Users/fixture',
      username: () => 'fixture-user',
      readKeychain: async () => undefined,
      readPlaintext: async () => undefined,
    }),
  ).rejects.toThrow(/No Claude Code credentials found/);
});

test('subscription login import path returns a Pi oauth credential without fetch or claude', async () => {
  const sample = await readFile(join(fixturesDir, 'credentials-layout.sample.json'), 'utf8');
  const imported = toPiOAuthCredential(parseClaudeCredentialsJson(sample));
  const oauth = subscriptionAuth(
    createClaudeOAuth({
      importCredentials: async () => imported,
    }),
  ).oauth;
  if (!oauth) throw new Error('subscriptionAuth must provide an OAuth method');
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('import must not contact the token endpoint');
  }) as typeof fetch;
  try {
    const progress: string[] = [];
    const credential = await oauth.login({
      signal: new AbortController().signal,
      notify: (event) => {
        if (event.type === 'progress') progress.push(event.message);
      },
      prompt: async (prompt) => {
        if (prompt.type === 'select') return 'import';
        throw new Error(`unexpected prompt ${prompt.type}`);
      },
    });
    expect(fetchCalls).toBe(0);
    expect(progress.some((message) => /Importing Claude Code/.test(message))).toBe(true);
    expect(credential).toEqual(imported);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('subscription login surfaces a missing Claude Code store without wrapping it away', async () => {
  const oauth = subscriptionAuth(
    createClaudeOAuth({
      importCredentials: async () => {
        throw new Error('No Claude Code credentials found to import.');
      },
    }),
  ).oauth;
  if (!oauth) throw new Error('subscriptionAuth must provide an OAuth method');
  await expect(
    oauth.login({
      signal: new AbortController().signal,
      notify: () => undefined,
      prompt: async (prompt) => {
        if (prompt.type === 'select') return 'import';
        throw new Error(`unexpected prompt ${prompt.type}`);
      },
    }),
  ).rejects.toThrow(/No Claude Code credentials found to import/);
});
