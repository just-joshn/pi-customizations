import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import { describe, expect, test } from 'vitest';
import { API_ID, CODE_ASSIST_BASE_URL, PROVIDER_ID } from './constants.ts';
import { CODE_ASSIST_MODEL_IDS, createCodeAssistModels } from './models.ts';

describe('createCodeAssistModels', () => {
  const models = createCodeAssistModels();

  test('lists the seven plan models with gemini-2.5-pro first', () => {
    expect(models.map((model) => model.id)).toEqual([...CODE_ASSIST_MODEL_IDS]);
    expect(models.map((model) => model.id)).toEqual(['gemini-2.5-pro', 'gemini-3.1-pro-preview', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']);
  });

  test('points every model at the Code Assist api and provider', () => {
    for (const model of models) {
      expect(model).toMatchObject({ api: API_ID, provider: PROVIDER_ID, baseUrl: CODE_ASSIST_BASE_URL });
    }
  });

  test('takes limits, prices, and thinking maps from the Pi catalog', () => {
    const catalog = getBuiltinModels('google');
    for (const model of models) {
      const source = catalog.find((candidate) => candidate.id === (model.id === 'gemini-3-flash' ? 'gemini-3-flash-preview' : model.id));
      expect(model).toMatchObject({ name: source?.name, input: source?.input, cost: source?.cost, reasoning: source?.reasoning, contextWindow: source?.contextWindow, maxTokens: source?.maxTokens });
      expect(model.thinkingLevelMap).toEqual(source?.thinkingLevelMap);
    }
  });

  test('keeps null entries of a catalog thinking map', () => {
    const pro = models.find((model) => model.id === 'gemini-3.1-pro-preview');
    expect(pro?.thinkingLevelMap).toMatchObject({ off: null, minimal: null, low: 'low' });
  });

  test('has no thinking map key where the catalog has none', () => {
    const pro25 = models.find((model) => model.id === 'gemini-2.5-pro');
    expect(pro25).not.toHaveProperty('thinkingLevelMap');
  });

  test('does not copy google-generative-ai headers or compat fields', () => {
    for (const model of models) {
      expect(Object.keys(model)).not.toContain('headers');
      expect(Object.keys(model)).not.toContain('compat');
      expect(Object.keys(model)).not.toContain('promptCache');
    }
  });
});
