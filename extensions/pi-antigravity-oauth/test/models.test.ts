import type { ModelsPublication, Provider, RefreshModelsContext } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import extension, { createAntigravityProvider } from '../src/index.ts';
import { FAMILY, familyOf, catalogFromAvailable, parseAvailableModels } from '../src/models.ts';
import { GOOGLE_OAUTH } from '../src/oauth.ts';
import { fakeServer, json } from './fake-server.ts';

const AVAILABLE = {
  models: {
    'gemini-3.1-pro-low': { displayName: 'Gemini 3.1 Pro (Low)', supportsThinking: true, quotaInfo: { remainingFraction: 0.8 } },
    'gemini-3.8-flash-high': { displayName: 'Gemini 3.8 Flash (High)', supportsThinking: true, supportsImages: true },
    'claude-opus-4-6-thinking': { displayName: 'Claude Opus 4.6 (Thinking)', supportsThinking: true },
    'gpt-oss-120b-medium': { displayName: 'GPT-OSS 120B (Medium)', supportsImages: false },
    chat_20706: { displayName: 'internal chat' },
    'gemini-internal-eval': { displayName: 'Eval', isInternal: true },
  },
  defaultAgentModelId: 'gemini-3.1-pro-low',
};

function refreshContext(credential: RefreshModelsContext['credential']): RefreshModelsContext {
  return {
    credential,
    allowNetwork: true,
    signal: new AbortController().signal,
    publish: async (publication: ModelsPublication) => {
      publication.update?.();
      return true;
    },
  };
}

const CREDENTIAL = { type: 'oauth' as const, access: 'ya29.t', refresh: 'r', expires: Date.now() + 60000, projectId: 'proj-9' };

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
  expect(provider?.getModels().map((model) => model.id)).toEqual(['gemini-3.1-pro-low', 'gemini-3-flash-agent', 'claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-oss-120b-medium']);
  expect(provider?.getModels()[0]?.baseUrl).toBe('https://daily-cloudcode-pa.googleapis.com');
  expect(commands).toEqual(['antigravity']);
});

test('the family registry routes model ids to their wire behavior', () => {
  expect(familyOf('claude-opus-4-6-thinking')).toBe('claude');
  expect(familyOf('gpt-oss-120b-medium')).toBe('gpt-oss');
  expect(familyOf('gemini-pro-agent')).toBe('gemini');
  expect([FAMILY.gemini.toolParameters, FAMILY.claude.toolParameters, FAMILY['gpt-oss'].toolParameters]).toEqual([false, true, false]);
  expect([FAMILY.gemini.thinking, FAMILY.claude.thinking, FAMILY['gpt-oss'].thinking]).toEqual(['level', 'budget', 'none']);
});

test('fetchModels overlays fetchAvailableModels onto the baseline', async () => {
  const server = await fakeServer((_, res) => json(res, 200, AVAILABLE));
  try {
    const provider = createAntigravityProvider({ endpoints: [server.url], oauth: GOOGLE_OAUTH });
    await provider.refreshModels?.(refreshContext(CREDENTIAL));
    expect(server.requests[0]?.path).toBe('/v1internal:fetchAvailableModels');
    expect(JSON.parse(server.requests[0]?.body)).toEqual({ project: 'proj-9' });
    expect(server.requests[0]?.headers.authorization).toBe('Bearer ya29.t');
    expect(provider.getModels().map((model) => model.id)).toEqual(['gemini-3.1-pro-low', 'gemini-3-flash-agent', 'claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-oss-120b-medium', 'gemini-3.8-flash-high']);
    const flash = provider.getModels().find((model) => model.id === 'gemini-3.8-flash-high');
    expect(flash).toEqual({
      id: 'gemini-3.8-flash-high',
      name: 'Gemini 3.8 Flash (High) (Antigravity)',
      api: 'cloud-code-assist',
      provider: 'google-antigravity',
      baseUrl: server.url,
      reasoning: true,
      thinkingLevelMap: undefined,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1048576,
      maxTokens: 65535,
    });
    const pro = provider.getModels().find((model) => model.id === 'gemini-3.1-pro-low');
    expect(pro?.name).toBe('Gemini 3.1 Pro Low (Antigravity)');
    expect(pro?.cost).toEqual({ input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.375 });
  } finally {
    server.close();
  }
});

test('a failed fetchAvailableModels keeps the baseline', async () => {
  const server = await fakeServer((_, res) => json(res, 403, { error: { message: 'denied' } }));
  try {
    const provider = createAntigravityProvider({ endpoints: [server.url], oauth: GOOGLE_OAUTH });
    await expect(provider.refreshModels?.(refreshContext(CREDENTIAL))).rejects.toThrow('fetchAvailableModels failed (403): denied');
    expect(provider.getModels().length).toBe(5);
  } finally {
    server.close();
  }
});

test('refreshing without an OAuth credential asks for a login', async () => {
  const server = await fakeServer((_, res) => json(res, 200, AVAILABLE));
  try {
    const provider = createAntigravityProvider({ endpoints: [server.url], oauth: GOOGLE_OAUTH });
    await expect(provider.refreshModels?.(refreshContext(undefined))).rejects.toThrow('Google Antigravity is not logged in');
    expect(server.requests).toEqual([]);
    expect(provider.getModels().length).toBe(5);
  } finally {
    server.close();
  }
});

test('an empty endpoint list falls back to the default endpoint', () => {
  const provider = createAntigravityProvider({ endpoints: [], oauth: GOOGLE_OAUTH });
  expect(provider.getModels()[0]?.baseUrl).toBe('https://daily-cloudcode-pa.googleapis.com');
});

test('parseAvailableModels ignores a response without a model map', () => {
  const parsed = parseAvailableModels({ models: { 'gemini-3.9-flash': { displayName: 'F' } } });
  expect(parsed.map((model) => [model.id, model.displayName, model.supportsThinking, model.supportsImages, model.remainingFraction, model.resetTime])).toEqual([['gemini-3.9-flash', 'F', undefined, undefined, undefined, undefined]]);
  expect(parseAvailableModels({})).toEqual([]);
  expect(parseAvailableModels(null)).toEqual([]);
});

test('catalogFromAvailable infers wire defaults for unknown models', () => {
  const models = catalogFromAvailable(
    [
      { id: 'gemini-3.9-pro', supportsThinking: true, supportsImages: true },
      { id: 'gemini-3.9-flash', supportsThinking: false, supportsImages: false },
      { id: 'gpt-oss-300b' },
      { id: 'claude-4-9' },
    ],
    'http://base',
  );
  expect(models.map((model) => [model.id, model.name, model.reasoning, model.thinkingLevelMap, model.input])).toEqual([
    ['gemini-3.9-pro', 'gemini-3.9-pro (Antigravity)', true, { minimal: 'low', low: 'low', medium: 'high', high: 'high' }, ['text', 'image']],
    ['gemini-3.9-flash', 'gemini-3.9-flash (Antigravity)', false, undefined, ['text']],
    ['gpt-oss-300b', 'gpt-oss-300b (Antigravity)', false, undefined, ['text', 'image']],
    ['claude-4-9', 'claude-4-9 (Antigravity)', true, undefined, ['text', 'image']],
  ]);
});
