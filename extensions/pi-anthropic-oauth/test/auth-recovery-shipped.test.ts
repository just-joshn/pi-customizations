import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createModels, InMemoryCredentialStore, type MutableModels, type Provider } from '@earendil-works/pi-ai';
import { type TestContext, vi } from 'vitest';
import { AuthStorage } from '../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js';
import extension from '../src/index.ts';
import { refreshClaimDirectoryFor } from '../src/refresh-claim.ts';
import { test } from './network-guard.ts';
import { ask } from './support/context.ts';
import { OAUTH_ACCESS_TOKEN, oauthCredential, REFRESHED_ACCESS_TOKEN, REFRESHED_REFRESH_TOKEN } from './support/credentials.ts';
import { captureProvider } from './support/load-extension.ts';
import { errorReply, type RecordedRequest, sseReply, startMessagesServer } from './support/messages-server.ts';
import { collect } from './support/run-stream.ts';
import { textMessage } from './support/sse.ts';
import { stubTokenEndpoint, TOKEN_URL } from './support/token-endpoint.ts';

// These tests load the provider the way Pi does: the factory alone, with no
// credential store bound. Pi 1.5 gives an extension no writable store.

const AMBIENT_ACCESS_TOKEN = 'sk-ant-oat01-ambient-setup-token';
const SECOND_ACCOUNT_ACCESS_TOKEN = 'sk-ant-oat01-second-account';

function bearer(request: RecordedRequest): string | undefined {
  const value = request.headers.authorization;
  return Array.isArray(value) ? value[0] : value;
}

async function shippedProvider(onTestFinished: TestContext['onTestFinished']): Promise<{ provider: Provider; agentDir: string }> {
  const agentDir = await mkdtemp(join(tmpdir(), 'pi-anth-shipped-'));
  onTestFinished(() => rm(agentDir, { recursive: true, force: true }));
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
  return { provider: captureProvider(extension), agentDir };
}

async function modelOn(models: MutableModels, provider: Provider, baseUrl: string) {
  const model = models.getModel(provider.id, 'claude-sonnet-4-6');
  if (!model) throw new Error('claude-sonnet-4-6 is not registered');
  return { ...model, baseUrl };
}

test('after logout, a rejected ambient token is not retried with the logged-out account', async ({ onTestFinished, expect }) => {
  const { provider } = await shippedProvider(onTestFinished);
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(provider.id, async () => oauthCredential());
  let ambient: string | undefined;
  const models = createModels({ credentials, authContext: { env: async (name) => (name === 'ANTHROPIC_AUTH_TOKEN' ? ambient : undefined), fileExists: async () => false } });
  models.setProvider(provider);
  const server = await startMessagesServer((res, request) => (bearer(request) === `Bearer ${AMBIENT_ACCESS_TOKEN}` ? errorReply(401, 'invalid bearer token') : sseReply(textMessage('ok')))(res, request));
  onTestFinished(() => server.close());
  const model = await modelOn(models, provider, server.baseUrl);
  await collect(models.streamSimple(model, ask('as the stored account'), { maxRetries: 0 }));

  await models.logout(provider.id);
  ambient = AMBIENT_ACCESS_TOKEN;
  const { message } = await collect(models.streamSimple(model, ask('as the ambient account'), { maxRetries: 0 }));

  expect(server.requests.slice(1).map(bearer)).toStrictEqual([`Bearer ${AMBIENT_ACCESS_TOKEN}`]);
  expect(message.stopReason).toBe('error');
});

test('requests after a 401 recovery send the recovered token instead of failing first', async ({ onTestFinished, networkGuard, expect }) => {
  const { provider } = await shippedProvider(onTestFinished);
  const tokenEndpoint = stubTokenEndpoint(networkGuard);
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(provider.id, async () => oauthCredential());
  const models = createModels({ credentials });
  models.setProvider(provider);
  const server = await startMessagesServer((res, request) => (bearer(request) === `Bearer ${OAUTH_ACCESS_TOKEN}` ? errorReply(401, 'invalid bearer token') : sseReply(textMessage('ok')))(res, request));
  onTestFinished(() => server.close());
  const model = await modelOn(models, provider, server.baseUrl);

  const first = await collect(models.streamSimple(model, ask('one'), { maxRetries: 0 }));
  const second = await collect(models.streamSimple(model, ask('two'), { maxRetries: 0 }));

  expect([first.message.stopReason, second.message.stopReason]).toStrictEqual(['stop', 'stop']);
  expect(server.requests.map(bearer)).toStrictEqual([`Bearer ${OAUTH_ACCESS_TOKEN}`, `Bearer ${REFRESHED_ACCESS_TOKEN}`, `Bearer ${REFRESHED_ACCESS_TOKEN}`]);
  expect(tokenEndpoint.requests).toHaveLength(1);
});

test.for([
  { name: 'with no stored credential the rotation log is cleared', stored: false, remaining: [] },
  { name: 'with a stored credential the rotation log is kept', stored: true, remaining: ['0123456789abcdef0123456789abcdef.1'] },
])('$name', async ({ stored, remaining }, { onTestFinished, expect }) => {
  const { provider, agentDir } = await shippedProvider(onTestFinished);
  const authPath = join(agentDir, 'auth.json');
  const claims = refreshClaimDirectoryFor(authPath);
  await mkdir(claims, { recursive: true });
  await writeFile(join(claims, '0123456789abcdef0123456789abcdef.1'), `${JSON.stringify(oauthCredential({ access: REFRESHED_ACCESS_TOKEN }))}\n`, { mode: 0o600 });
  const credentials = new InMemoryCredentialStore();
  if (stored) {
    await credentials.modify(provider.id, async () => oauthCredential());
    await writeFile(authPath, JSON.stringify({ [provider.id]: oauthCredential() }), { mode: 0o600 });
  }
  const models = createModels({ credentials, authContext: { env: async () => undefined, fileExists: async () => false } });
  models.setProvider(provider);

  await models.getAuth(provider.id);

  await expect(readdir(claims).catch(() => [])).resolves.toStrictEqual(remaining);
});

test('after logout, the rejected pre-recovery token is not retried with the logged-out credential', async ({ onTestFinished, networkGuard, expect }) => {
  const { provider } = await shippedProvider(onTestFinished);
  stubTokenEndpoint(networkGuard);
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(provider.id, async () => oauthCredential());
  let ambient: string | undefined;
  const models = createModels({ credentials, authContext: { env: async (name) => (name === 'ANTHROPIC_AUTH_TOKEN' ? ambient : undefined), fileExists: async () => false } });
  models.setProvider(provider);
  const server = await startMessagesServer((res, request) => (bearer(request) === `Bearer ${OAUTH_ACCESS_TOKEN}` ? errorReply(401, 'invalid bearer token') : sseReply(textMessage('ok')))(res, request));
  onTestFinished(() => server.close());
  const model = await modelOn(models, provider, server.baseUrl);
  await collect(models.streamSimple(model, ask('recovers to the refreshed token'), { maxRetries: 0 }));

  await models.logout(provider.id);
  ambient = OAUTH_ACCESS_TOKEN;
  const { message } = await collect(models.streamSimple(model, ask('as the ambient token'), { maxRetries: 0 }));

  expect(server.requests.slice(2).map(bearer)).toStrictEqual([`Bearer ${OAUTH_ACCESS_TOKEN}`]);
  expect(message.stopReason).toBe('error');
});

test('after an account switch, an old account token is not retried as the new account', async ({ onTestFinished, networkGuard, expect }) => {
  const { provider } = await shippedProvider(onTestFinished);
  stubTokenEndpoint(networkGuard);
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(provider.id, async () => oauthCredential());
  const models = createModels({ credentials });
  models.setProvider(provider);
  const server = await startMessagesServer((res, request) => (bearer(request) === `Bearer ${OAUTH_ACCESS_TOKEN}` ? errorReply(401, 'invalid bearer token') : sseReply(textMessage('ok')))(res, request));
  onTestFinished(() => server.close());
  const model = await modelOn(models, provider, server.baseUrl);
  await collect(models.streamSimple(model, ask('recovers to the refreshed token'), { maxRetries: 0 }));

  await credentials.modify(provider.id, async () => oauthCredential({ access: SECOND_ACCOUNT_ACCESS_TOKEN, refresh: 'second-account-refresh' }));
  await models.getAuth(provider.id);
  const { message } = await collect(models.streamSimple(model, ask('explicitly as the old account'), { maxRetries: 0, apiKey: OAUTH_ACCESS_TOKEN }));

  expect(server.requests.slice(2).map(bearer)).toStrictEqual([`Bearer ${OAUTH_ACCESS_TOKEN}`]);
  expect(message.stopReason).toBe('error');
});

test('a refresh response without a refresh token is used by the next request', async ({ onTestFinished, networkGuard, expect }) => {
  const { provider } = await shippedProvider(onTestFinished);
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    String(input) === TOKEN_URL ? Response.json({ access_token: REFRESHED_ACCESS_TOKEN, expires_in: 3600 }) : networkGuard(input, init),
  );
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(provider.id, async () => oauthCredential());
  const models = createModels({ credentials });
  models.setProvider(provider);
  const server = await startMessagesServer((res, request) => (bearer(request) === `Bearer ${OAUTH_ACCESS_TOKEN}` ? errorReply(401, 'invalid bearer token') : sseReply(textMessage('ok')))(res, request));
  onTestFinished(() => server.close());
  const model = await modelOn(models, provider, server.baseUrl);

  await collect(models.streamSimple(model, ask('one'), { maxRetries: 0 }));
  await collect(models.streamSimple(model, ask('two'), { maxRetries: 0 }));

  expect(server.requests.map(bearer)).toStrictEqual([`Bearer ${OAUTH_ACCESS_TOKEN}`, `Bearer ${REFRESHED_ACCESS_TOKEN}`, `Bearer ${REFRESHED_ACCESS_TOKEN}`]);
});

test('with no stored credential the 0.1.5 share file is deleted too', async ({ onTestFinished, expect }) => {
  const { provider, agentDir } = await shippedProvider(onTestFinished);
  await writeFile(join(agentDir, 'claude-subscription-refresh.json'), `${JSON.stringify(oauthCredential())}\n`, { mode: 0o600 });
  const models = createModels({ credentials: new InMemoryCredentialStore(), authContext: { env: async () => undefined, fileExists: async () => false } });
  models.setProvider(provider);

  await models.getAuth(provider.id);

  await expect(readdir(agentDir)).resolves.toStrictEqual([]);
});

test('an unreadable rotation log does not fail requests', async ({ onTestFinished, expect }) => {
  const { provider, agentDir } = await shippedProvider(onTestFinished);
  const claims = refreshClaimDirectoryFor(join(agentDir, 'auth.json'));
  await mkdir(claims, { recursive: true, mode: 0o000 });
  onTestFinished(() => chmod(claims, 0o700));
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(provider.id, async () => oauthCredential());
  const models = createModels({ credentials });
  models.setProvider(provider);
  const server = await startMessagesServer(sseReply(textMessage('ok')));
  onTestFinished(() => server.close());
  const model = await modelOn(models, provider, server.baseUrl);

  const { message } = await collect(models.streamSimple(model, ask('hi'), { maxRetries: 0 }));

  expect(message.errorMessage).toBeUndefined();
  expect(message.stopReason).toBe('stop');
  expect(server.requests.map(bearer)).toStrictEqual([`Bearer ${OAUTH_ACCESS_TOKEN}`]);
});

test.for([
  { name: 'a logout', change: (store: AuthStorage, providerId: string) => store.delete(providerId) },
  { name: 'an account switch', change: (store: AuthStorage, providerId: string) => store.modify(providerId, async () => oauthCredential({ access: SECOND_ACCOUNT_ACCESS_TOKEN, refresh: 'second-account-refresh' })) },
])('after $name during a 401 refresh, the request is not retried as the old account', async ({ change }, { onTestFinished, networkGuard, expect }) => {
  const { provider, agentDir } = await shippedProvider(onTestFinished);
  const credentials = AuthStorage.create(join(agentDir, 'auth.json'));
  await credentials.modify(provider.id, async () => oauthCredential());
  let refreshStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    refreshStarted = resolve;
  });
  let releaseRefresh: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (String(input) !== TOKEN_URL) return networkGuard(input, init);
    refreshStarted();
    await released;
    return Response.json({ access_token: REFRESHED_ACCESS_TOKEN, refresh_token: REFRESHED_REFRESH_TOKEN, expires_in: 3600 });
  });
  const models = createModels({ credentials });
  models.setProvider(provider);
  const server = await startMessagesServer((res, request) => (bearer(request) === `Bearer ${OAUTH_ACCESS_TOKEN}` ? errorReply(401, 'invalid bearer token') : sseReply(textMessage('ok')))(res, request));
  onTestFinished(() => server.close());
  const model = await modelOn(models, provider, server.baseUrl);

  const pending = collect(models.streamSimple(model, ask('as the old account'), { maxRetries: 0 }));
  await started;
  await change(credentials, provider.id);
  releaseRefresh();
  const { message } = await pending;

  expect(server.requests.map(bearer)).toStrictEqual([`Bearer ${OAUTH_ACCESS_TOKEN}`]);
  expect(message.stopReason).toBe('error');
});

test.for([
  { name: 'has no entry for this provider', stored: { anthropic: { type: 'api_key', key: 'sk-ant-api-unrelated' } } },
  { name: 'holds another login', stored: { 'claude-subscription': oauthCredential({ access: SECOND_ACCOUNT_ACCESS_TOKEN, refresh: 'second-account-refresh' }) } },
])('a host whose credentials are not in auth.json still recovers when auth.json $name', async ({ stored }, { onTestFinished, networkGuard, expect }) => {
  const { provider, agentDir } = await shippedProvider(onTestFinished);
  await writeFile(join(agentDir, 'auth.json'), JSON.stringify(stored), { mode: 0o600 });
  stubTokenEndpoint(networkGuard);
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(provider.id, async () => oauthCredential());
  const models = createModels({ credentials });
  models.setProvider(provider);
  const server = await startMessagesServer((res, request) => (bearer(request) === `Bearer ${OAUTH_ACCESS_TOKEN}` ? errorReply(401, 'invalid bearer token') : sseReply(textMessage('ok')))(res, request));
  onTestFinished(() => server.close());
  const model = await modelOn(models, provider, server.baseUrl);

  const { message } = await collect(models.streamSimple(model, ask('hi'), { maxRetries: 0 }));

  expect(server.requests.map(bearer)).toStrictEqual([`Bearer ${OAUTH_ACCESS_TOKEN}`, `Bearer ${REFRESHED_ACCESS_TOKEN}`]);
  expect(message.stopReason).toBe('stop');
});

test.for([
  { name: 'a logout', change: (store: AuthStorage, providerId: string) => store.delete(providerId) },
  { name: 'an account switch', change: (store: AuthStorage, providerId: string) => store.modify(providerId, async () => oauthCredential({ access: SECOND_ACCOUNT_ACCESS_TOKEN, refresh: 'second-account-refresh' })) },
  { name: 'a switch to an API key', change: (store: AuthStorage, providerId: string) => store.modify(providerId, async () => ({ type: 'api_key', key: 'sk-ant-api-second-account' })) },
])('after $name lands before the 401 arrives, the request is not retried as the old account', async ({ change }, { onTestFinished, networkGuard, expect }) => {
  const { provider, agentDir } = await shippedProvider(onTestFinished);
  const tokenEndpoint = stubTokenEndpoint(networkGuard);
  const credentials = AuthStorage.create(join(agentDir, 'auth.json'));
  await credentials.modify(provider.id, async () => oauthCredential());
  const models = createModels({ credentials });
  models.setProvider(provider);
  const server = await startMessagesServer((res, request) => {
    if (bearer(request) !== `Bearer ${OAUTH_ACCESS_TOKEN}`) {
      sseReply(textMessage('ok'))(res, request);
      return;
    }
    void change(credentials, provider.id).then(() => errorReply(401, 'invalid bearer token')(res, request));
  });
  onTestFinished(() => server.close());
  const model = await modelOn(models, provider, server.baseUrl);

  const { message } = await collect(models.streamSimple(model, ask('as the old account'), { maxRetries: 0 }));

  expect(server.requests.map(bearer)).toStrictEqual([`Bearer ${OAUTH_ACCESS_TOKEN}`]);
  expect(message.stopReason).toBe('error');
  expect(tokenEndpoint.requests).toHaveLength(0);
});

test('a switch before the 401 with an unreadable rotation log returns the 401', async ({ onTestFinished, networkGuard, expect }) => {
  const { provider, agentDir } = await shippedProvider(onTestFinished);
  const claims = refreshClaimDirectoryFor(join(agentDir, 'auth.json'));
  onTestFinished(() => chmod(claims, 0o700).catch(() => undefined));
  stubTokenEndpoint(networkGuard);
  const credentials = AuthStorage.create(join(agentDir, 'auth.json'));
  await credentials.modify(provider.id, async () => oauthCredential());
  const models = createModels({ credentials });
  models.setProvider(provider);
  const server = await startMessagesServer((res, request) => {
    if (bearer(request) !== `Bearer ${OAUTH_ACCESS_TOKEN}`) {
      sseReply(textMessage('ok'))(res, request);
      return;
    }
    void (async () => {
      await credentials.modify(provider.id, async () => oauthCredential({ access: SECOND_ACCOUNT_ACCESS_TOKEN, refresh: 'second-account-refresh' }));
      await mkdir(claims, { recursive: true, mode: 0o000 });
      errorReply(401, 'invalid bearer token')(res, request);
    })();
  });
  onTestFinished(() => server.close());
  const model = await modelOn(models, provider, server.baseUrl);

  const { message } = await collect(models.streamSimple(model, ask('as the old account'), { maxRetries: 0 }));

  expect(message.errorMessage).toMatch(/^401\b/);
  expect(server.requests.map(bearer)).toStrictEqual([`Bearer ${OAUTH_ACCESS_TOKEN}`]);
});
