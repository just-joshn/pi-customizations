import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import { describe, expect, test } from 'vitest';
import { API_ID, CODE_ASSIST_BASE_URL, PROVIDER_ID } from './constants.ts';
import { createCodeAssistModels } from './models.ts';

const catalog = getBuiltinModels('google');
const entry = (id: string) => {
  const found = catalog.find((model) => model.id === id);
  if (!found) throw new Error(`catalog has no ${id}`);
  return found;
};

describe('createCodeAssistModels', () => {
  const models = createCodeAssistModels();

  test('lists the two Antigravity families with gemini-4-argon first', () => {
    expect(models.map((model) => model.id)).toEqual(['gemini-4-argon', 'gemini-3.8-flash']);
  });

  test('points every model at the Code Assist api and provider', () => {
    for (const model of models) {
      expect(model).toMatchObject({ api: API_ID, provider: PROVIDER_ID, baseUrl: CODE_ASSIST_BASE_URL });
    }
  });

  test('takes limits, prices, and thinking maps from a catalog entry of the same id', () => {
    const source = entry('gemini-3.8-flash');
    expect(models.find((model) => model.id === 'gemini-3.8-flash')).toMatchObject({
      name: source.name,
      input: source.input,
      cost: source.cost,
      reasoning: source.reasoning,
      contextWindow: source.contextWindow,
      maxTokens: source.maxTokens,
      thinkingLevelMap: source.thinkingLevelMap,
    });
  });

  test('stands in a Gemini Pro entry, marked unverified, when the catalog lacks gemini-4-argon', () => {
    const withoutArgon = catalog.filter((model) => model.id !== 'gemini-4-argon');
    const pro = entry('gemini-3.1-pro-preview');
    const argon = createCodeAssistModels(withoutArgon).find((model) => model.id === 'gemini-4-argon');
    expect(argon).toMatchObject({ name: 'gemini-4-argon (limits unverified)', contextWindow: pro.contextWindow, maxTokens: pro.maxTokens, cost: pro.cost, thinkingLevelMap: pro.thinkingLevelMap });
  });

  test('throws only when the catalog has neither the family nor the stand-in', () => {
    expect(() => createCodeAssistModels([])).toThrow('neither gemini-4-argon nor gemini-3.1-pro-preview');
  });

  test('does not copy google-generative-ai headers or compat fields', () => {
    for (const model of models) {
      expect(Object.keys(model)).not.toContain('headers');
      expect(Object.keys(model)).not.toContain('compat');
      expect(Object.keys(model)).not.toContain('promptCache');
    }
  });
});
