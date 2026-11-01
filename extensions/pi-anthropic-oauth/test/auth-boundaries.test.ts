import { createModels, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { expect, vi } from 'vitest';
import { ask } from './support/context.ts';
import { OAUTH_ACCESS_TOKEN, oauthCredential } from './support/credentials.ts';
import { test } from './support/fixtures.ts';
import { collect } from './support/run-stream.ts';

const noFile = async () => false;

test.for(['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'])('the native %s token variable resolves a subscription token', async (source, { provider }) => {
  const models = createModels({ authContext: { env: async (name) => (name === source ? OAUTH_ACCESS_TOKEN : undefined), fileExists: noFile } });
  models.setProvider(provider);
  await expect(models.getAuth(provider.id)).resolves.toMatchObject({ auth: { apiKey: OAUTH_ACCESS_TOKEN }, source });
});

const AUTH_TOKEN = 'sk-ant-oat01-auth-token-wins';
const SETUP_TOKEN = 'sk-ant-oat01-setup-token-loses';

test('ANTHROPIC_AUTH_TOKEN outranks a setup token', async ({ provider }) => {
  const models = createModels({
    authContext: {
      env: async (name) => (name === 'ANTHROPIC_AUTH_TOKEN' ? AUTH_TOKEN : name === 'CLAUDE_CODE_OAUTH_TOKEN' ? SETUP_TOKEN : undefined),
      fileExists: noFile,
    },
  });
  models.setProvider(provider);
  await expect(models.getAuth(provider.id)).resolves.toMatchObject({ auth: { apiKey: AUTH_TOKEN }, source: 'ANTHROPIC_AUTH_TOKEN' });
});

test('ANTHROPIC_OAUTH_TOKEN is ignored as an ambient source', async ({ provider }) => {
  const models = createModels({
    authContext: {
      env: async (name) => (name === 'ANTHROPIC_OAUTH_TOKEN' ? OAUTH_ACCESS_TOKEN : undefined),
      fileExists: noFile,
    },
  });
  models.setProvider(provider);
  await expect(models.getAuth(provider.id)).resolves.toBeUndefined();
});

test.for([
  { name: 'missing', token: undefined },
  { name: 'empty', token: '' },
])('a $name token leaves no available subscription models', async ({ token }, { provider, model }) => {
  const models = createModels({ authContext: { env: async () => token, fileExists: noFile } });
  models.setProvider(provider);
  await expect(models.getAuth(provider.id)).resolves.toBeUndefined();
  await expect(models.getAvailable(provider.id)).resolves.toStrictEqual([]);
  const { message } = await collect(models.streamSimple(model, ask('hi')));
  expect(message).toMatchObject({ stopReason: 'error', errorMessage: 'Provider is not configured: claude-subscription' });
});

test('a stored OAuth credential wins over an ambient Claude token', async ({ provider, credentials }) => {
  const env = vi.fn().mockResolvedValue('sk-ant-oat01-other');
  const models = createModels({ credentials, authContext: { env, fileExists: noFile } });
  models.setProvider(provider);
  await expect(models.getAuth(provider.id)).resolves.toMatchObject({ auth: { apiKey: OAUTH_ACCESS_TOKEN }, source: 'OAuth' });
  expect(env).not.toHaveBeenCalled();
});

test('stored setup tokens resolve through native auth', async ({ provider }) => {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(provider.id, async () => ({ type: 'api_key', key: OAUTH_ACCESS_TOKEN }));
  const models = createModels({ credentials });
  models.setProvider(provider);
  await expect(models.getAuth(provider.id)).resolves.toMatchObject({ auth: { apiKey: OAUTH_ACCESS_TOKEN }, source: 'stored credential' });
});

test('concurrent requests refresh once', async ({ models, model, server, credentials, tokenEndpoint }) => {
  await credentials.modify(model.provider, async () => oauthCredential({ expires: 0 }));
  const results = await Promise.all([collect(models.streamSimple(model, ask('one'))), collect(models.streamSimple(model, ask('two')))]);
  expect(results.map(({ message }) => message.stopReason)).toStrictEqual(['stop', 'stop']);
  expect(server.requests).toHaveLength(2);
  expect(tokenEndpoint.requests).toHaveLength(1);
});

test('ambient auth preserves cancellation before environment access', async ({ provider }) => {
  const resolve = provider.auth.apiKey?.resolve;
  if (!resolve) throw new Error('No ambient auth resolver');
  const signal = AbortSignal.abort();
  const env = vi.fn().mockResolvedValue(OAUTH_ACCESS_TOKEN);
  await expect(resolve({ ctx: { env, fileExists: noFile }, signal })).rejects.toBe(signal.reason);
  expect(env).not.toHaveBeenCalled();
});

test('ambient auth preserves cancellation during environment access', async ({ provider }) => {
  const resolve = provider.auth.apiKey?.resolve;
  if (!resolve) throw new Error('No ambient auth resolver');
  const controller = new AbortController();
  const env = async () => {
    controller.abort();
    return OAUTH_ACCESS_TOKEN;
  };
  await expect(resolve({ ctx: { env, fileExists: noFile }, signal: controller.signal })).rejects.toBe(controller.signal.reason);
});

test('refresh cancellation keeps its abort reason', async ({ provider }) => {
  const oauth = provider.auth.oauth;
  if (!oauth) throw new Error('No OAuth');
  const controller = new AbortController();
  const reason = new DOMException('Cancelled', 'AbortError');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => {
      controller.abort(reason);
      throw reason;
    }),
  );
  await expect(oauth.refresh(oauthCredential(), controller.signal)).rejects.toBe(reason);
});

test('login cancellation keeps its abort reason', async ({ provider }) => {
  const oauth = provider.auth.oauth;
  if (!oauth) throw new Error('No OAuth');
  const controller = new AbortController();
  const reason = new DOMException('Cancelled', 'AbortError');
  await expect(
    oauth.login({
      signal: controller.signal,
      notify: () => undefined,
      prompt: async () => {
        controller.abort(reason);
        throw reason;
      },
    }),
  ).rejects.toBe(reason);
});

test('Pi login cancellation stays cancellation', async ({ provider }) => {
  const oauth = provider.auth.oauth;
  if (!oauth) throw new Error('No OAuth');
  const cancelled = new Error('Login cancelled');
  await expect(
    oauth.login({
      signal: new AbortController().signal,
      notify: () => undefined,
      prompt: async () => {
        throw cancelled;
      },
    }),
  ).rejects.toBe(cancelled);
});

test('a state mismatch never exchanges the authorization code', async ({ provider, tokenEndpoint }) => {
  const oauth = provider.auth.oauth;
  if (!oauth) throw new Error('No OAuth');
  await expect(
    oauth.login({
      signal: new AbortController().signal,
      notify: () => undefined,
      prompt: async (prompt) => {
        if (prompt.type === 'select') return 'copy-code';
        return 'local-code#wrong-state';
      },
    }),
  ).rejects.toThrow('That code is not from this sign-in. Paste the code shown after opening the address above.');
  expect(tokenEndpoint.requests).toStrictEqual([]);
});

test('a pasted code without a state is rejected with Claude wording and never exchanged', async ({ provider, tokenEndpoint }) => {
  const oauth = provider.auth.oauth;
  if (!oauth) throw new Error('No OAuth');
  await expect(
    oauth.login({
      signal: new AbortController().signal,
      notify: () => undefined,
      prompt: async (prompt) => (prompt.type === 'select' ? 'copy-code' : 'local-code'),
    }),
  ).rejects.toThrow('Invalid code. Please make sure the full code was copied.');
  expect(tokenEndpoint.requests).toStrictEqual([]);
});

test('the paste prompt is the text Claude Code shows', async ({ provider }) => {
  const oauth = provider.auth.oauth;
  if (!oauth) throw new Error('No OAuth');
  const messages: string[] = [];
  await oauth
    .login({
      signal: new AbortController().signal,
      notify: () => undefined,
      prompt: async (prompt) => {
        if (prompt.type === 'select') return 'copy-code';
        messages.push(prompt.message);
        throw new Error('Login cancelled');
      },
    })
    .catch(() => undefined);
  expect(messages).toStrictEqual(['Paste code here if prompted > ']);
});

test('failed refresh keeps account ownership', async ({ provider, credentials }) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ refresh_token: 'sensitive-server-value' }, { status: 400 })));
  const credential = oauthCredential({ expires: 0 });
  await credentials.modify(provider.id, async () => credential);
  const env = vi.fn().mockResolvedValue(OAUTH_ACCESS_TOKEN);
  const models = createModels({ credentials, authContext: { env, fileExists: noFile } });
  models.setProvider(provider);
  const failure = models.getAuth(provider.id);
  await expect(failure).rejects.toMatchObject({ code: 'oauth' });
  await expect(failure).rejects.not.toThrow('sensitive-server-value');
  await expect(credentials.read(provider.id)).resolves.toStrictEqual(credential);
  expect(env).not.toHaveBeenCalled();
});
