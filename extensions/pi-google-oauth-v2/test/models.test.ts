import { InMemoryModelsStore, type Provider, type RefreshModelsContext } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { loadCatalogFixture } from './catalog-fixture.ts';
import { CODE_ASSIST_BASE_URL, HTTP_FORBIDDEN, PROVIDER_ID, ROUTE_CATALOG } from './constants.ts';
import { json } from './google.ts';
import { liveCredential, startSession } from './session.ts';

const HYDROGEN_CONTEXT_WINDOW = 1_048_576;
const HYDROGEN_MAX_OUTPUT = 262_144;
const SONNET_CONTEXT_WINDOW = 1_000_000;
const SONNET_MAX_OUTPUT = 128_000;
const GPT_OSS_CONTEXT_WINDOW = 131_072;
const GPT_OSS_MAX_OUTPUT = 32_768;
const SMALL_OUTPUT_TOKENS = 65_536;
const PLAIN_MAX_TOKENS = 10;
const PLAIN_MAX_OUTPUT = 5;
const USER_AGENT = /^antigravity\/cli\/\S+ \(aidev_client; os_type=\w+; arch=\w+; cl=\d+; auth_method=consumer\)$/;
const BASELINE_IDS = ['gemini-4-argon', 'gemini-3.8-flash'];

const accountCatalog = {
  models: {
    'gemini-4-hydrogen-medium': { displayName: 'Gemini 4 Hydrogen (Medium)', supportsThinking: true, maxTokens: HYDROGEN_CONTEXT_WINDOW, maxOutputTokens: HYDROGEN_MAX_OUTPUT },
    'gemini-3.8-flash-medium': { displayName: 'Gemini 3.8 Flash (Medium)', supportsThinking: true, maxTokens: HYDROGEN_CONTEXT_WINDOW, maxOutputTokens: SMALL_OUTPUT_TOKENS },
  },
  agentModelSorts: [{ groups: [{ modelIds: ['gemini-4-hydrogen-medium', 'gemini-3.8-flash-medium'] }] }],
};
const accountModelIds = ['gemini-3.8-flash', 'gemini-4-hydrogen'];

afterEach(() => vi.unstubAllGlobals());

const idsOf = (provider: Provider) => provider.getModels().map((model) => model.id);

type ContextOverrides = Partial<RefreshModelsContext> & { signedOut?: boolean };

function refreshContext({ signedOut = false, ...overrides }: ContextOverrides = {}): RefreshModelsContext {
  const base = { allowNetwork: true, signal: new AbortController().signal, publish: async () => true };
  return signedOut ? { ...base, ...overrides } : { ...base, credential: liveCredential(), ...overrides };
}

describe('the account catalog', () => {
  test('replaces the baseline families once the account catalog is fetched', async () => {
    const session = await startSession({ catalog: accountCatalog });
    expect(idsOf(session.provider).toSorted()).toEqual(accountModelIds);
    expect(session.models.getModel(PROVIDER_ID, 'gemini-4-argon')).toBeUndefined();
  });

  test('is fetched as Antigravity with the stored project', async () => {
    const session = await startSession({ catalog: accountCatalog });
    const [request] = session.google.requestsTo(ROUTE_CATALOG);
    expect(request).toMatchObject({ url: `${CODE_ASSIST_BASE_URL}:fetchAvailableModels`, method: 'POST', json: { project: 'proj-77' }, headers: { authorization: 'Bearer access-live' } });
    expect(request?.headers['user-agent']).toMatch(USER_AGENT);
  });

  test('restores an accepted account catalog offline without baseline families or network access', async () => {
    const modelsStore = new InMemoryModelsStore();
    await startSession({ catalog: accountCatalog, modelsStore });
    const restored = await startSession({ modelsStore });

    const result = await restored.models.refresh({ allowNetwork: false });

    expect(result.errors.size).toBe(0);
    expect(restored.google.requests).toEqual([]);
    expect(idsOf(restored.provider).toSorted()).toEqual(accountModelIds);
  });

  test('keeps the baseline offline when nothing was stored', async () => {
    const session = await startSession();
    const result = await session.models.refresh({ allowNetwork: false });
    expect(result.errors.size).toBe(0);
    expect(session.google.requests).toEqual([]);
    expect(idsOf(session.provider)).toEqual(BASELINE_IDS);
  });
});

describe('catalog failures', () => {
  test('keeps the last accepted catalog when a later request fails', async () => {
    let failing = false;
    const routes = { [ROUTE_CATALOG]: () => (failing ? Promise.reject(new Error('synthetic network failure')) : json(accountCatalog)) };
    const session = await startSession({ routes });
    expect((await session.models.refresh({ allowNetwork: true })).errors.size).toBe(0);
    const known = session.models.getModels(PROVIDER_ID);
    const persisted = await session.modelsStore.read(PROVIDER_ID);
    failing = true;

    const result = await session.models.refresh({ allowNetwork: true, force: true });

    expect(result.errors.get(PROVIDER_ID)?.message).toContain('synthetic network failure');
    expect(session.models.getModels(PROVIDER_ID)).toEqual(known);
    expect(await session.modelsStore.read(PROVIDER_ID)).toEqual(persisted);
  });

  test('shows Google message when the catalog request is refused and keeps the baseline', async () => {
    const session = await startSession({ routes: { [ROUTE_CATALOG]: () => json({ error: { message: 'nope' } }, HTTP_FORBIDDEN) } });
    const result = await session.models.refresh({ allowNetwork: true });
    expect(result.errors.get(PROVIDER_ID)?.message).toContain('nope');
    expect(idsOf(session.provider)).toEqual(BASELINE_IDS);
  });

  test('fails when the account lists no models and keeps the baseline', async () => {
    const session = await startSession({ routes: { [ROUTE_CATALOG]: () => json({}) } });
    const result = await session.models.refresh({ allowNetwork: true });
    expect(result.errors.get(PROVIDER_ID)?.message).toContain('Google returned no models for this account');
    expect(idsOf(session.provider)).toEqual(BASELINE_IDS);
  });

  test('skips shown ids that have no model metadata', async () => {
    const catalog = { models: {}, agentModelSorts: [{ groups: [{ modelIds: ['gemini-4-argon-low'] }] }] };
    const session = await startSession({ routes: { [ROUTE_CATALOG]: () => json(catalog) } });
    const result = await session.models.refresh({ allowNetwork: true });
    expect(result.errors.get(PROVIDER_ID)?.message).toContain('no models');
  });
});

describe('refresh publication', () => {
  test('a rejected stored catalog publication keeps the baseline and skips the network', async () => {
    const modelsStore = new InMemoryModelsStore();
    await startSession({ catalog: accountCatalog, modelsStore });
    const stored = await modelsStore.read(PROVIDER_ID);
    const restored = await startSession({ modelsStore });
    const before = idsOf(restored.provider);
    const publish = vi.fn(async () => false);

    await restored.provider.refreshModels?.(refreshContext({ ...(stored ? { stored } : {}), publish }));

    expect(publish).toHaveBeenCalledOnce();
    expect(restored.google.requests).toEqual([]);
    expect(idsOf(restored.provider)).toEqual(before);
  });

  test('a rejected catalog publication leaves the provider unchanged', async () => {
    const session = await startSession({ catalog: accountCatalog });
    const before = session.models.getModels(PROVIDER_ID);
    const publish = vi.fn(async () => false);

    await session.provider.refreshModels?.(refreshContext({ publish }));

    expect(publish).toHaveBeenCalledOnce();
    expect(session.models.getModels(PROVIDER_ID)).toEqual(before);
  });
});

describe('refresh that must not publish', () => {
  test('a request aborted in flight publishes nothing', async () => {
    const controller = new AbortController();
    const routes = {
      [ROUTE_CATALOG]: () => {
        controller.abort();
        return json(accountCatalog);
      },
    };
    const session = await startSession({ routes });
    const publish = vi.fn(async () => true);

    await session.provider.refreshModels?.(refreshContext({ publish, signal: controller.signal }));

    expect(publish).not.toHaveBeenCalled();
    expect(idsOf(session.provider)).toEqual(BASELINE_IDS);
  });

  test.for([
    ['offline', { allowNetwork: false }],
    ['signed out', { signedOut: true }],
    ['already aborted', { signal: AbortSignal.abort() }],
  ] as const)('does not touch the network when %s', async ([, overrides]) => {
    const session = await startSession();
    const publish = vi.fn(async () => true);

    await session.provider.refreshModels?.(refreshContext({ ...overrides, publish }));

    expect(session.google.requests).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('models built from the recorded Google catalog', () => {
  const fixture = loadCatalogFixture();
  const modelsOf = async () => (await startSession({ catalog: fixture })).models.getModels(PROVIDER_ID);
  const modelOf = async (id: string) => {
    const found = (await modelsOf()).find((model) => model.id === id);
    if (!found) throw new Error(`no model ${id}`);
    return found;
  };

  test('makes one model per base family in the order Google lists them, skipping -disabled ids', async () => {
    expect((await modelsOf()).map((model) => model.id)).toEqual(['gemini-4-argon', 'gemini-4-hydrogen', 'gemini-pro-orchestrator-g1-pro', 'gemini-3.8-flash', 'claude-opus-5-5', 'claude-sonnet-5-5', 'gpt-oss-120b']);
  });

  test('points every model at the Code Assist api and provider with zero cost', async () => {
    for (const model of await modelsOf()) {
      expect(model).toMatchObject({ api: 'google-code-assist', provider: PROVIDER_ID, baseUrl: CODE_ASSIST_BASE_URL, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
    }
  });

  test('maps each present effort to its wire id and hides levels Google lacks', async () => {
    expect(await modelOf('gemini-4-hydrogen')).toMatchObject({
      name: 'Gemini 4 Hydrogen',
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: null, low: 'gemini-4-hydrogen-low', medium: 'gemini-4-hydrogen-medium', high: 'gemini-4-hydrogen-high', xhigh: 'gemini-4-hydrogen-xhigh' },
    });
    expect((await modelOf('gemini-4-argon')).thinkingLevelMap).toEqual({ off: null, minimal: null, low: 'gemini-4-argon-low', medium: 'gemini-4-argon-medium', high: 'gemini-4-argon-high' });
  });

  test('treats an id without an effort suffix as a single medium variant', async () => {
    expect(await modelOf('gemini-pro-orchestrator-g1-pro')).toMatchObject({
      name: 'Orchestrator (Argon)',
      thinkingLevelMap: { off: null, minimal: null, low: null, medium: 'gemini-pro-orchestrator-g1-pro', high: null },
    });
    expect((await modelOf('gpt-oss-120b')).thinkingLevelMap).toMatchObject({ medium: 'gpt-oss-120b-medium', low: null, high: null });
  });
});

describe('model limits and modalities from the recorded Google catalog', () => {
  const fixture = loadCatalogFixture();
  const modelOf = async (id: string) => {
    const found = (await startSession({ catalog: fixture })).models.getModels(PROVIDER_ID).find((model) => model.id === id);
    if (!found) throw new Error(`no model ${id}`);
    return found;
  };

  test('takes input modalities and the largest limits across variants', async () => {
    expect(await modelOf('gemini-4-hydrogen')).toMatchObject({ input: ['text', 'image'], contextWindow: HYDROGEN_CONTEXT_WINDOW, maxTokens: HYDROGEN_MAX_OUTPUT });
    expect(await modelOf('claude-sonnet-5-5')).toMatchObject({ name: 'Claude Sonnet 5.5', contextWindow: SONNET_CONTEXT_WINDOW, maxTokens: SONNET_MAX_OUTPUT });
    expect(await modelOf('gpt-oss-120b')).toMatchObject({ input: ['text'], contextWindow: GPT_OSS_CONTEXT_WINDOW, maxTokens: GPT_OSS_MAX_OUTPUT });
  });

  test('gives a model without thinking support only an off wire id', async () => {
    const catalog = {
      models: { 'plain-model': { displayName: 'Plain', supportsThinking: false, maxTokens: PLAIN_MAX_TOKENS, maxOutputTokens: PLAIN_MAX_OUTPUT } },
      agentModelSorts: [{ groups: [{ modelIds: ['plain-model'] }] }],
    };
    const session = await startSession({ catalog });
    expect(session.model('plain-model')).toMatchObject({ reasoning: false, thinkingLevelMap: { off: 'plain-model' } });
  });
});
