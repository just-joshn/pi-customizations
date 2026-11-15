import { type Credential, createModels, InMemoryCredentialStore, normalizeContext, type Provider } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, test, vi } from 'vitest';
import extension from '../src/index.ts';

const ID = 'anthropic-oauth-v2';
const FUTURE = Date.now() + 24 * 60 * 60 * 1000;
const NON_OAUTH_ENV = {
  ANTHROPIC_API_KEY: 'sk-ant-api03-env',
  ANTHROPIC_OAUTH_TOKEN: 'sk-ant-api03-env',
  ANTHROPIC_AUTH_TOKEN: 'bearer-env',
  ANTHROPIC_FEDERATION_RULE_ID: 'rule',
  ANTHROPIC_ORGANIZATION_ID: 'org',
  ANTHROPIC_IDENTITY_TOKEN_FILE: '/tmp/identity-token',
};

function registeredProvider(): Provider {
  const registered: Provider[] = [];
  extension({
    registerProvider: (provider: Provider | string) => {
      if (typeof provider === 'string') throw new Error(`expected a native Provider, got the legacy form for ${provider}`);
      registered.push(provider);
    },
    registerCommand: () => {},
  });
  const [provider, ...rest] = registered;
  if (!provider || rest.length > 0) throw new Error(`expected exactly one provider, got ${registered.length}`);
  return provider;
}

async function resolveAuth(credential?: Credential, env: Record<string, string> = {}, apiKeyOverride?: string) {
  const credentials = new InMemoryCredentialStore();
  if (credential) await credentials.modify(ID, async () => credential);
  const models = createModels({ credentials, authContext: { env: async (name) => env[name], fileExists: async () => true } });
  models.setProvider(registeredProvider());
  return models.getAuth(ID, apiKeyOverride === undefined ? undefined : { apiKey: apiKeyOverride });
}

const oauth = (access: string): Credential => ({ type: 'oauth', access, refresh: 'refresh-token', expires: FUTURE });

describe('anthropic-oauth-v2 provider', () => {
  test('registers every model under its own id with a subscription OAuth login', () => {
    const provider = registeredProvider();

    expect(provider.id).toBe(ID);
    expect(provider.auth.oauth?.isSubscription).toBe(true);
    expect(provider.getModels().length).toBeGreaterThan(0);
    expect(provider.getModels().every((model) => model.provider === ID && model.api === 'anthropic-messages')).toBe(true);
  });

  test('sends a stored subscription OAuth token as the request credential', async () => {
    await expect(resolveAuth(oauth('sk-ant-oat01-subscription'))).resolves.toMatchObject({ auth: { apiKey: 'sk-ant-oat01-subscription' }, source: 'OAuth' });
  });
});

describe('anthropic-oauth-v2 refuses every non-OAuth credential', () => {
  test('ignores Anthropic API key, token, and federation env vars when nothing is stored', async () => {
    await expect(resolveAuth(undefined, NON_OAUTH_ENV)).resolves.toBeUndefined();
  });

  test('ignores a stored api_key credential', async () => {
    await expect(resolveAuth({ type: 'api_key', key: 'sk-ant-api03-stored' }, NON_OAUTH_ENV)).resolves.toBeUndefined();
  });

  test('ignores an explicit API key override', async () => {
    await expect(resolveAuth(undefined, {}, 'sk-ant-api03-override')).resolves.toBeUndefined();
  });

  test.for(['sk-ant-api03-in-oauth-slot', 'plain-token', ''])('refuses a stored OAuth credential whose access token is %j without sending a request', async (access) => {
    const credentials = new InMemoryCredentialStore();
    await credentials.modify(ID, async () => oauth(access));
    const models = createModels({ credentials, authContext: { env: async () => undefined, fileExists: async () => true } });
    const provider = registeredProvider();
    models.setProvider(provider);
    const model = provider.getModels()[0];
    if (!model) throw new Error('no models registered');
    const fetch = vi.fn(async () => new Response('{}', { status: 401 }));

    const message = await models.stream(model, { messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }] }, { fetch }).result();

    expect(fetch).not.toHaveBeenCalled();
    expect(message).toMatchObject({ stopReason: 'error', errorMessage: expect.stringMatching(/refusing non-OAuth/) });
  });
});

describe('anthropic-oauth-v2 sends nothing but the OAuth bearer on the wire', () => {
  const OAT = 'sk-ant-oat01-subscription';
  const METHODS = ['stream', 'streamSimple'] as const;

  interface Attempt {
    method: (typeof METHODS)[number];
    apiKey?: string;
    headers?: Record<string, string>;
    modelHeaders?: Record<string, string>;
    client?: object;
  }

  async function send({ method, apiKey, headers, modelHeaders, client }: Attempt) {
    const provider = registeredProvider();
    const base = provider.getModels()[0];
    if (!base) throw new Error('no models registered');
    const model = modelHeaders ? { ...base, headers: modelHeaders } : base;
    const fetch = vi.fn(async () => new Response('{"type":"error","error":{"type":"authentication_error","message":"x"}}', { status: 401 }));
    const options = { fetch, ...(apiKey === undefined ? {} : { apiKey }), ...(headers ? { headers } : {}), ...(client ? { client } : {}) };
    const error = await Promise.resolve()
      .then(() => provider[method](model, normalizeContext({ messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }] }), options).result())
      .then((message) => (message.stopReason === 'error' ? (message.errorMessage ?? '') : undefined))
      .catch((thrown: unknown) => String(thrown));
    return { requests: fetch.mock.calls.length, error };
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test.for(METHODS)('%s sends a request for a subscription OAuth token with no extra credential headers', async (method) => {
    await expect(send({ method, apiKey: OAT })).resolves.toMatchObject({ requests: 1 });
  });

  test.for(METHODS)('%s still sends an allowed anthropic-beta header from models.json', async (method) => {
    await expect(send({ method, apiKey: OAT, headers: { 'anthropic-beta': 'some-beta-2026-01-01' } })).resolves.toMatchObject({ requests: 1 });
  });

  const credentialHeaders = ['x-api-key', 'Authorization', 'X-Api_Key', 'Cookie'];
  const refused: readonly (readonly [string, Omit<Attempt, 'method'>])[] = [
    ['an API key from models.json apiKey', { apiKey: 'sk-ant-api03-models-json' }],
    ['no credential at all', {}],
    ['a key that only contains the OAuth prefix', { apiKey: 'x-sk-ant-oat01-lookalike' }],
    ['an x-api-key model header from modelOverrides', { apiKey: OAT, modelHeaders: { 'X-Api-Key': 'sk-ant-api03-model' } }],
    ['an API key in the value of an innocuous header', { apiKey: OAT, headers: { 'x-trace-id': 'sk-ant-api03-in-value' } }],
    ['an API key in the value of an allowed header', { apiKey: OAT, headers: { 'anthropic-beta': 'sk-ant-api03-in-value' } }],
    [
      'a pre-built SDK client',
      {
        apiKey: OAT,
        client: new Proxy(
          {},
          {
            get: (_target, property) => {
              throw new Error(`client.${String(property)} used`);
            },
          },
        ),
      },
    ],
    ...credentialHeaders.map((name) => [`a ${name} header next to the OAuth token`, { apiKey: OAT, headers: { [name]: 'sk-ant-api03-header' } }] as const),
  ];

  test.for(METHODS.flatMap((method) => refused.map(([label, attempt]) => [method, label, attempt] as const)))('%s refuses %s without sending a request', async ([method, , attempt]) => {
    const { requests, error } = await send({ method, ...attempt });

    expect(requests).toBe(0);
    expect(error).toMatch(/refusing non-OAuth/);
  });

  test.for(METHODS.flatMap((method) => ['x-api-key: sk-ant-api03-env', 'anthropic-beta: some-beta-2026-01-01'].map((value) => [method, value] as const)))(
    '%s refuses ANTHROPIC_CUSTOM_HEADERS=%j without sending a request',
    async ([method, value]) => {
      vi.stubEnv('ANTHROPIC_CUSTOM_HEADERS', value);

      const { requests, error } = await send({ method, apiKey: OAT });

      expect(requests).toBe(0);
      expect(error).toMatch(/refusing non-OAuth/);
    },
  );
});
