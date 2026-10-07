import type { ModelsPublication, Provider, RefreshModelsContext } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { expect } from 'vitest';
import extension, { createAntigravityProvider } from '../src/index.ts';
import { catalogModels, parseVariant } from '../src/models.ts';
import { GOOGLE_OAUTH } from '../src/oauth.ts';
import { fakeServer, json } from './fake-server.ts';
import { test } from './network-guard.ts';

const AVAILABLE = {
  models: {
    'gemini-3.9-flash-high': { displayName: 'Gemini 3.9 Flash (High)', supportsImages: true, supportsThinking: true, thinkingBudget: -1, maxTokens: 1048576, maxOutputTokens: 65536 },
    'gemini-3.9-flash-low': { displayName: 'Gemini 3.9 Flash (Low)', supportsImages: true, supportsThinking: true, thinkingBudget: 1000, maxTokens: 1048576, maxOutputTokens: 65536 },
    'gemini-pro-agent': { displayName: 'Gemini 3.1 Pro (High)', supportsImages: true, supportsThinking: true, thinkingBudget: 10001, maxTokens: 1048576, maxOutputTokens: 65535 },
    'claude-opus-6-medium': { displayName: 'Claude Opus 6 (Medium)', supportsImages: true, supportsThinking: true, thinkingLevel: 2, maxTokens: 1000000, maxOutputTokens: 128000 },
    'gpt-oss-120b-medium': { displayName: 'GPT-OSS 120B (Medium)', supportsThinking: true, thinkingBudget: 8192, maxTokens: 131072, maxOutputTokens: 32768 },
    'gemini-3.5-flash-lite': { displayName: 'Gemini 3.5 Flash Lite', supportsThinking: true, thinkingBudget: -1 },
  },
  agentModelSorts: [{ groups: [{ modelIds: ['gemini-3.9-flash-high', 'gemini-3.9-flash-low', 'gemini-pro-agent', 'claude-opus-6-medium', 'gpt-oss-120b-medium', 'missing-high'] }] }],
  deprecatedModelIds: { 'gemini-3.1-pro-high': { newModelId: 'gemini-pro-agent' } },
};

function refreshContext(credential: RefreshModelsContext['credential']): RefreshModelsContext {
  return {
    ...(credential !== undefined && { credential }),
    allowNetwork: true,
    signal: new AbortController().signal,
    publish: async (publication: ModelsPublication) => {
      publication.update?.();
      return true;
    },
  };
}

const CREDENTIAL = { type: 'oauth' as const, access: 'ya29.t', refresh: 'r', expires: Date.now() + 60000, projectId: 'proj-9' };

const BASELINE_IDS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.1-pro', 'claude-opus-5-5', 'claude-sonnet-5-5', 'gpt-oss-120b'];

test('the extension registers the Google Antigravity subscription provider and command', () => {
  const providers: Provider[] = [];
  const commands: string[] = [];
  extension({
    registerProvider: (provider: Provider) => providers.push(provider),
    registerCommand: (name: string) => commands.push(name),
  } as unknown as ExtensionAPI);
  const [provider] = providers;
  expect(provider?.id).toBe('google-antigravity');
  expect(provider?.name).toBe('Google Antigravity');
  expect(provider?.auth.oauth?.loginLabel).toBe('Sign in with Google (Antigravity)');
  expect(provider?.auth.oauth?.isSubscription).toBe(true);
  expect(provider?.getModels().map((model) => model.id)).toEqual(BASELINE_IDS);
  expect(provider?.getModels()[0]?.baseUrl).toBe('https://daily-cloudcode-pa.googleapis.com');
  expect(commands).toEqual(['antigravity']);
});

test('the catalog groups the CLI agent models by effort the way `agy --model --effort` does', () => {
  const models = catalogModels(AVAILABLE, 'http://base');
  expect(models.map((model) => model.id)).toEqual(['gemini-3.9-flash', 'gemini-3.1-pro', 'claude-opus-6', 'gpt-oss-120b']);
  expect(models[0]).toEqual({
    id: 'gemini-3.9-flash',
    name: 'Gemini 3.9 Flash (Antigravity)',
    api: 'cloud-code-assist',
    provider: 'google-antigravity',
    baseUrl: 'http://base',
    reasoning: true,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: '{"model":"gemini-3.9-flash-low","thinkingBudget":1000}',
      medium: null,
      high: '{"model":"gemini-3.9-flash-high","thinkingBudget":-1}',
      xhigh: null,
      max: null,
    },
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
  });
});

test('a deprecated CLI id names the effort of its replacement model', () => {
  const pro = catalogModels(AVAILABLE, 'http://base').find((model) => model.id === 'gemini-3.1-pro');
  expect(parseVariant(pro?.thinkingLevelMap?.high)).toEqual({ model: 'gemini-pro-agent', thinkingBudget: 10001 });
});

test('a Claude effort carries its thinking level and a zero budget', () => {
  const claude = catalogModels(AVAILABLE, 'http://base').find((model) => model.id === 'claude-opus-6');
  expect(parseVariant(claude?.thinkingLevelMap?.medium)).toEqual({ model: 'claude-opus-6-medium', thinkingBudget: 0, thinkingLevel: 'MEDIUM' });
});

test('a model without images accepts only text', () => {
  const gpt = catalogModels(AVAILABLE, 'http://base').find((model) => model.id === 'gpt-oss-120b');
  expect(gpt?.input).toEqual(['text']);
  expect([gpt?.contextWindow, gpt?.maxTokens]).toEqual([131072, 32768]);
});

test('a model that does not think gets no thinking budget', () => {
  const [model] = catalogModels({ models: { 'm-high': { displayName: 'M (High)' } }, agentModelSorts: [{ groups: [{ modelIds: ['m-high'] }] }] }, 'http://base');
  expect(parseVariant(model?.thinkingLevelMap?.high)).toEqual({ model: 'm-high' });
  expect([model?.contextWindow, model?.maxTokens]).toEqual([0, 0]);
});

test('only ids that agentModelSorts lists become models', () => {
  expect(catalogModels(null, 'http://base')).toStrictEqual([]);
  expect(catalogModels({ models: AVAILABLE.models }, 'http://base')).toStrictEqual([]);
  const listed = { models: AVAILABLE.models, agentModelSorts: [{ groups: [{ modelIds: ['gpt-oss-120b-medium'] }] }] };
  expect(catalogModels(listed, 'http://base').map((model) => model.id)).toEqual(['gpt-oss-120b']);
});

test('parseVariant rejects a value without a model id', () => {
  expect(parseVariant(null)).toBe(undefined);
  expect(parseVariant('{}')).toBe(undefined);
});

test('fetchModels adds the account catalog to the baseline', async () => {
  const server = await fakeServer((_, res) => json(res, 200, AVAILABLE));
  try {
    const provider = createAntigravityProvider({ ...GOOGLE_OAUTH, cloudCode: server.url });
    await provider.refreshModels?.(refreshContext(CREDENTIAL));
    expect(server.requests[0]?.path).toBe('/v1internal:fetchAvailableModels');
    expect(server.requests[0]?.body).toBe('{"project":"proj-9"}');
    expect(server.requests[0]?.headers.authorization).toBe('Bearer ya29.t');
    expect(provider.getModels().map((model) => model.id)).toEqual([...BASELINE_IDS, 'gemini-3.9-flash', 'claude-opus-6']);
    expect(provider.getModels().find((model) => model.id === 'gemini-3.1-pro')?.thinkingLevelMap?.low).toBe(null);
  } finally {
    server.close();
  }
});

test('a failed fetchAvailableModels keeps the baseline', async () => {
  const server = await fakeServer((_, res) => json(res, 403, { error: { message: 'denied' } }));
  try {
    const provider = createAntigravityProvider({ ...GOOGLE_OAUTH, cloudCode: server.url });
    await expect(provider.refreshModels?.(refreshContext(CREDENTIAL))).rejects.toThrow('fetchAvailableModels failed (403): denied');
    expect(provider.getModels().map((model) => model.id)).toEqual(BASELINE_IDS);
  } finally {
    server.close();
  }
});

test('refreshing without an OAuth credential asks for a login', async () => {
  const server = await fakeServer((_, res) => json(res, 200, AVAILABLE));
  try {
    const provider = createAntigravityProvider({ ...GOOGLE_OAUTH, cloudCode: server.url });
    await expect(provider.refreshModels?.(refreshContext(undefined))).rejects.toThrow('Google Antigravity is not logged in');
    expect(server.requests).toEqual([]);
  } finally {
    server.close();
  }
});
