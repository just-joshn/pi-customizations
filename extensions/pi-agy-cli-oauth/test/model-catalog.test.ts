import type { Model } from '@earendil-works/pi-ai';
import { expect, it } from 'vitest';
import { API_ID, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, PROCESS_BASE_URL, PROVIDER_ID, SMALL_CONTEXT_WINDOW } from '../src/constants.ts';
import { BASELINE_MODELS, catalogToModels, resolveSelection } from '../src/model-catalog.ts';
import { EFFORTS, type CatalogEntry, type Discovery } from '../src/types.ts';

type AgenticModel = Model<typeof API_ID>;

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function discovery(models: readonly CatalogEntry[]): Discovery {
  return { version: 'test', tierName: undefined, models };
}

function onlyModel(models: readonly CatalogEntry[]): AgenticModel {
  const model = catalogToModels(discovery(models))[0];
  if (model === undefined) throw new Error('expected one model');
  return model;
}

it('omits the thinking map when the CLI offers no efforts', () => {
  const model = onlyModel([
    {
      baseId: 'claude-sonnet-4-6',
      name: 'Claude Sonnet 4.6 (Thinking)',
      efforts: [],
      variants: ['claude-sonnet-4-6'],
    },
  ]);
  expect(model).toEqual({
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6 (Thinking) (Antigravity)',
    api: API_ID,
    provider: PROVIDER_ID,
    baseUrl: PROCESS_BASE_URL,
    input: ['text', 'image'],
    cost: ZERO_COST,
    reasoning: false,
    contextWindow: SMALL_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  });
  expect('thinkingLevelMap' in model).toBe(false);
});

it('maps every effort the CLI offers, including xhigh and max', () => {
  const model = onlyModel([
    {
      baseId: 'gemini-3.8-flash',
      name: 'Gemini 3.8 Flash',
      efforts: EFFORTS,
      variants: ['gemini-3.8-flash'],
    },
  ]);
  expect(model.reasoning).toBe(true);
  expect(model.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
  expect(model.thinkingLevelMap).toEqual({
    off: null,
    minimal: null,
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  });
});

it('uses the smaller window for gpt-oss and leaves unoffered levels null', () => {
  const model = onlyModel([
    {
      baseId: 'gpt-oss-120b',
      name: 'GPT-OSS 120B',
      efforts: ['medium'],
      variants: ['gpt-oss-120b-medium'],
    },
  ]);
  expect(model.contextWindow).toBe(SMALL_CONTEXT_WINDOW);
  expect(model.thinkingLevelMap).toEqual({
    off: null,
    minimal: null,
    low: null,
    medium: 'medium',
    high: null,
  });
});

it('passes a CLI effort for a bare id', () => {
  expect(resolveSelection('gemini-3.8-flash', 'high')).toEqual({
    modelId: 'gemini-3.8-flash',
    thoughtLevel: 'high',
  });
  expect(resolveSelection('claude-sonnet-4-6', 'max')).toEqual({
    modelId: 'claude-sonnet-4-6',
    thoughtLevel: 'max',
  });
});

it('sends nothing for off, minimal, an unknown level, or a suffixed id', () => {
  expect(resolveSelection('gemini-3.8-flash', 'off')).toEqual({ modelId: 'gemini-3.8-flash' });
  expect(resolveSelection('gemini-3.8-flash', 'minimal')).toEqual({ modelId: 'gemini-3.8-flash' });
  expect(resolveSelection('gemini-3.8-flash', undefined)).toEqual({ modelId: 'gemini-3.8-flash' });
  expect(resolveSelection('gemini-3.8-flash', 'nope')).toEqual({ modelId: 'gemini-3.8-flash' });
  expect(resolveSelection('gemini-3.8-flash-xhigh', 'high')).toEqual({ modelId: 'gemini-3.8-flash-xhigh' });
  expect(resolveSelection('gpt-oss-120b-medium', 'low')).toEqual({ modelId: 'gpt-oss-120b-medium' });
});

it('collapses the 1.5.15 catalog to base ids with the efforts a live session advertises', () => {
  expect(BASELINE_MODELS.map((model) => model.id)).toEqual(['gemini-3.8-flash', 'claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-oss-120b']);
  const gemini = BASELINE_MODELS[0];
  const sonnet = BASELINE_MODELS[1];
  const opus = BASELINE_MODELS[2];
  const oss = BASELINE_MODELS[3];
  if (gemini === undefined || sonnet === undefined || opus === undefined || oss === undefined) {
    throw new Error('expected the four baseline models');
  }
  expect(gemini.thinkingLevelMap).toEqual({ off: null, minimal: null, low: 'low', medium: 'medium', high: 'high' });
  expect(sonnet.reasoning).toBe(false);
  expect('thinkingLevelMap' in sonnet).toBe(false);
  expect(opus.reasoning).toBe(false);
  expect(oss.thinkingLevelMap).toEqual({ off: null, minimal: null, low: null, medium: 'medium', high: null });
  expect(oss.contextWindow).toBe(SMALL_CONTEXT_WINDOW);
  expect(gemini.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
});
