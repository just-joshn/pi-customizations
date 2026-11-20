import type { OAuthCredential, RefreshModelsContext } from '@earendil-works/pi-ai';
import { describe, expect, test, vi } from 'vitest';
import { loadCatalogFixture } from '../test/catalog-fixture.ts';
import { parseJsonBody } from '../test/json-body.ts';
import { ANTIGRAVITY_USER_AGENT, API_ID, CODE_ASSIST_BASE_URL, PROVIDER_ID } from './constants.ts';
import { BASELINE_MODELS, type Catalog, catalogModels, createFetchModels } from './models.ts';

const HYDROGEN_CONTEXT_WINDOW = 1_048_576;
const HYDROGEN_MAX_OUTPUT = 262_144;
const SONNET_CONTEXT_WINDOW = 1_000_000;
const SONNET_MAX_OUTPUT = 128_000;
const GPT_OSS_CONTEXT_WINDOW = 131_072;
const GPT_OSS_MAX_OUTPUT = 32_768;
const PLAIN_MAX_TOKENS = 10;
const PLAIN_MAX_OUTPUT = 5;
const CREDENTIAL_TTL_MS = 3_600_000;
const HTTP_FORBIDDEN = 403;

const fixture: Catalog = loadCatalogFixture();
const models = catalogModels(fixture);
const byId = (id: string) => {
  const found = models.find((model) => model.id === id);
  if (!found) throw new Error(`no model ${id}`);
  return found;
};

describe('catalogModels', () => {
  test('makes one model per base family in the order Google lists them, skipping -disabled ids', () => {
    expect(models.map((model) => model.id)).toEqual(['gemini-4-argon', 'gemini-4-hydrogen', 'gemini-pro-orchestrator-g1-pro', 'gemini-3.8-flash', 'claude-opus-5-5', 'claude-sonnet-5-5', 'gpt-oss-120b']);
  });

  test('points every model at the Code Assist api and provider with zero cost', () => {
    for (const model of models) {
      expect(model).toMatchObject({ api: API_ID, provider: PROVIDER_ID, baseUrl: CODE_ASSIST_BASE_URL, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
    }
  });

  test('maps each present effort to its wire id and hides levels Google lacks', () => {
    expect(byId('gemini-4-hydrogen')).toMatchObject({
      name: 'Gemini 4 Hydrogen',
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: null, low: 'gemini-4-hydrogen-low', medium: 'gemini-4-hydrogen-medium', high: 'gemini-4-hydrogen-high', xhigh: 'gemini-4-hydrogen-xhigh' },
    });
    expect(byId('gemini-4-argon').thinkingLevelMap).toEqual({ off: null, minimal: null, low: 'gemini-4-argon-low', medium: 'gemini-4-argon-medium', high: 'gemini-4-argon-high' });
  });

  test('treats an id without an effort suffix as a single medium variant', () => {
    expect(byId('gemini-pro-orchestrator-g1-pro')).toMatchObject({
      name: 'Orchestrator (Argon)',
      thinkingLevelMap: { off: null, minimal: null, low: null, medium: 'gemini-pro-orchestrator-g1-pro', high: null },
    });
    expect(byId('gpt-oss-120b').thinkingLevelMap).toMatchObject({ medium: 'gpt-oss-120b-medium', low: null, high: null });
  });

  test('takes input modalities and the largest limits across variants', () => {
    expect(byId('gemini-4-hydrogen')).toMatchObject({ input: ['text', 'image'], contextWindow: HYDROGEN_CONTEXT_WINDOW, maxTokens: HYDROGEN_MAX_OUTPUT });
    expect(byId('claude-sonnet-5-5')).toMatchObject({ name: 'Claude Sonnet 5.5', contextWindow: SONNET_CONTEXT_WINDOW, maxTokens: SONNET_MAX_OUTPUT });
    expect(byId('gpt-oss-120b')).toMatchObject({ input: ['text'], contextWindow: GPT_OSS_CONTEXT_WINDOW, maxTokens: GPT_OSS_MAX_OUTPUT });
  });

  test('gives a model without thinking support only an off wire id', () => {
    const [model] = catalogModels({
      models: { 'plain-model': { displayName: 'Plain', supportsThinking: false, maxTokens: PLAIN_MAX_TOKENS, maxOutputTokens: PLAIN_MAX_OUTPUT } },
      agentModelSorts: [{ groups: [{ modelIds: ['plain-model'] }] }],
    });
    expect(model).toMatchObject({ reasoning: false, thinkingLevelMap: { off: 'plain-model' } });
  });

  test('skips shown ids that have no model metadata', () => {
    expect(catalogModels({ models: {}, agentModelSorts: [{ groups: [{ modelIds: ['gemini-4-argon-low'] }] }] })).toEqual([]);
  });
});

describe('createFetchModels', () => {
  const oauth: OAuthCredential = { type: 'oauth', access: 'tok', refresh: 'ref', expires: Date.now() + CREDENTIAL_TTL_MS, projectId: 'proj-1' };
  const context = (overrides: Partial<RefreshModelsContext>): RefreshModelsContext => ({ allowNetwork: true, signal: new AbortController().signal, publish: async () => true, credential: oauth, ...overrides });

  test('returns the baseline without touching the network when offline', async () => {
    const fetchImpl = vi.fn();
    expect(await createFetchModels(fetchImpl)(context({ allowNetwork: false }))).toBe(BASELINE_MODELS);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(BASELINE_MODELS.map((model) => model.id)).toEqual(['gemini-4-argon', 'gemini-3.8-flash']);
  });

  test('returns the baseline when there is no OAuth credential', async () => {
    const fetchImpl = vi.fn();
    const { credential: _, ...withoutCredential } = context({});
    expect(await createFetchModels(fetchImpl)(withoutCredential)).toBe(BASELINE_MODELS);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('posts the project to fetchAvailableModels as Antigravity and builds models from the answer', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json(fixture));
    const result = await createFetchModels(fetchImpl)(context({}));
    expect(result.map((model) => model.id)).toContain('claude-sonnet-5-5');
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(`${CODE_ASSIST_BASE_URL}:fetchAvailableModels`);
    expect(parseJsonBody(init?.body)).toEqual({ project: 'proj-1' });
    expect(Object.fromEntries(new Headers(init?.headers))).toMatchObject({ authorization: 'Bearer tok', 'user-agent': ANTIGRAVITY_USER_AGENT });
  });

  test('fails with Google message when the request is refused', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: { message: 'nope' } }, { status: HTTP_FORBIDDEN }));
    await expect(createFetchModels(fetchImpl)(context({}))).rejects.toThrow('nope');
  });

  test('fails when the account lists no models', async () => {
    const fetchImpl = vi.fn(async () => Response.json({}));
    await expect(createFetchModels(fetchImpl)(context({}))).rejects.toThrow('no models');
  });
});
