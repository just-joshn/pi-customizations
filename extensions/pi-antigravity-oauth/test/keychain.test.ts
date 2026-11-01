import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AuthEvent, AuthPrompt, ProviderAuthInteraction } from '@earendil-works/pi-ai';
import { expect } from 'vitest';
import {
  AGY_KEYCHAIN,
  decodeGoKeyringPassword,
  GO_KEYRING_PREFIX,
  keychainImportAvailable,
  parseAgyKeychainPayload,
  readAgyKeychainPassword,
  tokensFromGoKeyringPassword,
} from '../src/keychain.ts';
import { createAntigravityOAuth, importAgyKeychainCredential, LOGIN_BROWSER, LOGIN_KEYCHAIN, type OAuthEndpoints } from '../src/oauth.ts';
import { type FakeServer, fakeServer, json } from './fake-server.ts';
import { test } from './network-guard.ts';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '../../../parity/oauth-rea-2026-10-31/agy/fixtures');
const keychainSchema = JSON.parse(readFileSync(join(fixtureDir, 'keychain-credential.schema.json'), 'utf8')) as {
  keychain_item: { class: string; service: string; account: string; password_prefix: string };
  payload_example_redacted: {
    token: {
      access_token: string;
      token_type: string;
      refresh_token: string;
      expiry: string;
      expires_in: number;
    };
    auth_method: string;
    id_token_email: string;
  };
  absent_fields: string[];
};
const piAuthSchema = JSON.parse(readFileSync(join(fixtureDir, 'pi-auth-google-antigravity.schema.json'), 'utf8')) as {
  payload_example_redacted: {
    type: string;
    access: string;
    refresh: string;
    expires: number;
    projectId: string;
    email: string;
  };
};

const FIXTURE_PAYLOAD = {
  token: {
    access_token: 'ya29.fixture-access',
    token_type: 'Bearer',
    refresh_token: '1//fixture-refresh',
    expiry: '2026-10-30T08:27:19.21575-07:00',
    expires_in: 3599,
  },
  auth_method: 'consumer',
  id_token_email: 'dev@example.com',
} as const;

function goKeyringPassword(payload: unknown = FIXTURE_PAYLOAD): string {
  return `${GO_KEYRING_PREFIX}${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}`;
}

async function cloudCode(project: unknown = { cloudaicompanionProject: 'aicode-consumers' }): Promise<FakeServer> {
  return fakeServer((request, res) => {
    if (request.path === '/cc/v1internal:loadCodeAssist') return json(res, 200, project);
    if (request.path.startsWith('/tokeninfo')) return json(res, 200, { aud: 'test' });
    return json(res, 404, {});
  });
}

function endpoints(server: FakeServer): OAuthEndpoints {
  return {
    authUrl: `${server.url}/auth`,
    tokenUrl: `${server.url}/token`,
    userInfoUrl: `${server.url}/userinfo`,
    tokenInfoUrl: `${server.url}/tokeninfo`,
    cloudCode: `${server.url}/cc`,
  };
}

function interaction(answer: (prompt: AuthPrompt) => Promise<string>): { value: ProviderAuthInteraction; events: AuthEvent[] } {
  const events: AuthEvent[] = [];
  return {
    events,
    value: {
      signal: new AbortController().signal,
      notify: (event) => events.push(event),
      prompt: (prompt) => answer(prompt),
    },
  };
}

test('fixture schema names the measured gemini/antigravity go-keyring item', () => {
  expect(keychainSchema.keychain_item).toMatchObject({
    class: 'genp',
    service: AGY_KEYCHAIN.service,
    account: AGY_KEYCHAIN.account,
    password_prefix: GO_KEYRING_PREFIX,
  });
  expect(keychainSchema.payload_example_redacted).toMatchObject({
    token: { token_type: 'Bearer', expires_in: expect.any(Number) },
    auth_method: 'consumer',
  });
  expect(keychainSchema.absent_fields).toEqual(expect.arrayContaining(['projectId']));
  expect(piAuthSchema.payload_example_redacted).toMatchObject({ type: 'oauth', projectId: 'aicode-consumers' });
});

test('parseAgyKeychainPayload maps the fixture token shape into Pi access/refresh/expires/email', () => {
  const now = Date.parse('2026-10-30T00:00:00Z');
  const tokens = parseAgyKeychainPayload(FIXTURE_PAYLOAD, now);
  expect(tokens).toEqual({
    access: 'ya29.fixture-access',
    refresh: '1//fixture-refresh',
    expires: Date.parse(FIXTURE_PAYLOAD.token.expiry) - 10_000,
    email: 'dev@example.com',
  });
  expect(tokens).not.toHaveProperty('projectId');
});

test('tokensFromGoKeyringPassword decodes the measured go-keyring-base64 password', () => {
  const tokens = tokensFromGoKeyringPassword(goKeyringPassword());
  expect(tokens.access).toBe('ya29.fixture-access');
  expect(tokens.refresh).toBe('1//fixture-refresh');
  expect(tokens.email).toBe('dev@example.com');
  expect(decodeGoKeyringPassword(goKeyringPassword())).toMatchObject({ auth_method: 'consumer' });
});

test('parseAgyKeychainPayload falls back to expires_in when expiry is missing', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const tokens = parseAgyKeychainPayload(
    {
      token: {
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 3600,
      },
      auth_method: 'consumer',
    },
    now,
  );
  expect(tokens.expires).toBe(Date.parse('2026-01-01T00:59:50Z'));
});

test.for([
  { name: 'a non-object payload', payload: null as unknown, error: /not an object/ },
  { name: 'a missing token', payload: { auth_method: 'consumer' }, error: /lacks a token object/ },
  { name: 'a missing access_token', payload: { token: { refresh_token: 'r', expiry: '2026-01-01T00:00:00Z' } }, error: /access_token/ },
  { name: 'a missing refresh_token', payload: { token: { access_token: 'a', expiry: '2026-01-01T00:00:00Z' } }, error: /refresh_token/ },
  { name: 'a non-Bearer token_type', payload: { token: { access_token: 'a', refresh_token: 'r', token_type: 'Basic', expiry: '2026-01-01T00:00:00Z' } }, error: /token_type/ },
  { name: 'a non-consumer auth_method', payload: { token: { access_token: 'a', refresh_token: 'r', expiry: '2026-01-01T00:00:00Z' }, auth_method: 'workforce' }, error: /auth_method/ },
  { name: 'no expiry fields', payload: { token: { access_token: 'a', refresh_token: 'r' } }, error: /expiry or expires_in/ },
])('parseAgyKeychainPayload rejects $name', ({ payload, error }) => {
  expect(() => parseAgyKeychainPayload(payload)).toThrow(error);
});

test('importAgyKeychainCredential fills projectId through loadCodeAssist', async () => {
  const server = await cloudCode({ cloudaicompanionProject: 'aicode-consumers' });
  try {
    const credential = await importAgyKeychainCredential(endpoints(server), goKeyringPassword(), new AbortController().signal);
    const load = server.requests.find((request) => request.path.endsWith('loadCodeAssist'));
    expect(load?.body).toBe('{"metadata":{"ideType":"ANTIGRAVITY"}}');
    expect(load?.headers.authorization).toBe('Bearer ya29.fixture-access');
    expect(credential).toEqual({
      type: 'oauth',
      access: 'ya29.fixture-access',
      refresh: '1//fixture-refresh',
      expires: Date.parse(FIXTURE_PAYLOAD.token.expiry) - 10_000,
      projectId: 'aicode-consumers',
      email: 'dev@example.com',
    });
    expect(Object.keys(credential).sort()).toEqual(['access', 'email', 'expires', 'projectId', 'refresh', 'type']);
  } finally {
    server.close();
  }
});

test('importAgyKeychainCredential surfaces tokeninfo when Cloud Code rejects the access token', async () => {
  const server = await fakeServer((request, res) => {
    if (request.path === '/cc/v1internal:loadCodeAssist') return json(res, 401, { error: { message: 'invalid_token' } });
    if (request.path.startsWith('/tokeninfo')) return json(res, 400, { error: 'invalid_token' });
    return json(res, 404, {});
  });
  try {
    await expect(importAgyKeychainCredential(endpoints(server), goKeyringPassword(), new AbortController().signal)).rejects.toThrow(
      'tokeninfo returned status 400',
    );
    expect(server.requests.some((request) => request.path.startsWith('/tokeninfo?access_token=ya29.fixture-access'))).toBe(true);
  } finally {
    server.close();
  }
});

test('importAgyKeychainCredential keeps an aborted discovery as AbortError and skips tokeninfo', async () => {
  const server = await fakeServer(() => {});
  const controller = new AbortController();
  const pending = importAgyKeychainCredential(endpoints(server), goKeyringPassword(), controller.signal);
  const aborted = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  try {
    await expect.poll(() => server.requests.some((request) => request.path.endsWith('loadCodeAssist'))).toBe(true);
    controller.abort();
    await aborted;
    expect(server.requests.some((request) => request.path.startsWith('/tokeninfo'))).toBe(false);
  } finally {
    server.close();
  }
});

test('importAgyKeychainCredential returns an auth-like abort reason without calling tokeninfo', async () => {
  const server = await fakeServer(() => {});
  const controller = new AbortController();
  const reason = new Error('invalid_token');
  const pending = importAgyKeychainCredential(endpoints(server), goKeyringPassword(), controller.signal);
  const aborted = expect(pending).rejects.toBe(reason);
  try {
    await expect.poll(() => server.requests.some((request) => request.path.endsWith('loadCodeAssist'))).toBe(true);
    controller.abort(reason);
    await aborted;
    expect(server.requests.some((request) => request.path.startsWith('/tokeninfo'))).toBe(false);
  } finally {
    server.close();
  }
});

test('importAgyKeychainCredential rethrows a missing project without calling tokeninfo', async () => {
  const server = await fakeServer((request, res) => {
    if (request.path === '/cc/v1internal:loadCodeAssist') return json(res, 200, {});
    if (request.path === '/cc/v1internal:onboardUser') return json(res, 200, {});
    if (request.path.startsWith('/tokeninfo')) return json(res, 500, { error: 'unavailable' });
    return json(res, 404, {});
  });
  try {
    await expect(importAgyKeychainCredential(endpoints(server), goKeyringPassword(), new AbortController().signal)).rejects.toThrow(
      'Cloud Code named no Antigravity project for this account after onboarding.',
    );
    expect(server.requests.some((request) => request.path.startsWith('/tokeninfo'))).toBe(false);
  } finally {
    server.close();
  }
});

test('importAgyKeychainCredential rethrows a Cloud Code outage without calling tokeninfo', async () => {
  const server = await fakeServer((request, res) => {
    if (request.path === '/cc/v1internal:loadCodeAssist') return json(res, 503, { error: { message: 'unavailable' } });
    if (request.path.startsWith('/tokeninfo')) return json(res, 400, { error: 'invalid_token' });
    return json(res, 404, {});
  });
  try {
    await expect(importAgyKeychainCredential(endpoints(server), goKeyringPassword(), new AbortController().signal)).rejects.toThrow(
      'loadCodeAssist failed (503): unavailable',
    );
    expect(server.requests.some((request) => request.path.startsWith('/tokeninfo'))).toBe(false);
  } finally {
    server.close();
  }
});

test('login can import the keychain credential when opted in', async () => {
  const server = await cloudCode();
  try {
    const prompts: AuthPrompt[] = [];
    const flow = interaction(async (prompt) => {
      prompts.push(prompt);
      if (prompt.type === 'select') return LOGIN_KEYCHAIN;
      throw new Error(`unexpected prompt ${prompt.type}`);
    });
    const credential = await createAntigravityOAuth(endpoints(server), {
      offerKeychainImport: true,
      readKeychainPassword: async () => goKeyringPassword(),
    }).login(flow.value);
    expect(prompts.map((prompt) => prompt.type)).toEqual(['select']);
    expect(prompts[0]).toMatchObject({
      type: 'select',
      options: [{ id: LOGIN_BROWSER }, { id: LOGIN_KEYCHAIN }],
    });
    expect(credential['projectId']).toBe('aicode-consumers');
    expect(credential.access).toBe('ya29.fixture-access');
    expect(flow.events).toContainEqual({ type: 'progress', message: 'Reading the Antigravity keychain credential' });
    expect(flow.events).toContainEqual({ type: 'progress', message: 'Finding your Antigravity project' });
  } finally {
    server.close();
  }
});

test('login still offers the browser path when keychain import is enabled', async () => {
  const server = await fakeServer((request, res) => {
    if (request.path === '/token') return json(res, 200, { access_token: 'ya29.first', refresh_token: '1//refresh', expires_in: 3600 });
    if (request.path === '/userinfo') return json(res, 200, { email: 'dev@example.com' });
    if (request.path === '/cc/v1internal:loadCodeAssist') return json(res, 200, { cloudaicompanionProject: 'aicode-consumers' });
    return json(res, 404, {});
  });
  try {
    const flow = interaction(async (prompt) => {
      if (prompt.type === 'select') return LOGIN_BROWSER;
      if (prompt.type === 'manual_code') return 'code';
      throw new Error(`unexpected prompt ${prompt.type}`);
    });
    const credential = await createAntigravityOAuth(endpoints(server), {
      offerKeychainImport: true,
      readKeychainPassword: async () => {
        throw new Error('keychain should not be read');
      },
    }).login(flow.value);
    expect(credential.access).toBe('ya29.first');
    expect(credential['projectId']).toBe('aicode-consumers');
  } finally {
    server.close();
  }
});

test('readAgyKeychainPassword asks security for the measured service and account', async () => {
  const calls: string[][] = [];
  const password = goKeyringPassword();
  const spawnImpl = ((_cmd: string, args: readonly string[]) => {
    calls.push([...args]);
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(`${password}\n`));
      child.emit('close', 0);
    });
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
  await expect(readAgyKeychainPassword(spawnImpl)).resolves.toBe(password);
  expect(calls).toEqual([['find-generic-password', '-s', 'gemini', '-a', 'antigravity', '-w']]);
});

test('keychainImportAvailable is true only on darwin', () => {
  expect(keychainImportAvailable('darwin')).toBe(true);
  expect(keychainImportAvailable('linux')).toBe(false);
  expect(keychainImportAvailable('win32')).toBe(false);
});
