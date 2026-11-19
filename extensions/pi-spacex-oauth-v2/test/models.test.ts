import type { SDKModel } from '@cursor/sdk';
import { getSupportedThinkingLevels, type Model } from '@earendil-works/pi-ai';
import { describe, expect, test } from 'vitest';
import { selectModel, toPiModel } from '../src/cursor/models.ts';
import catalog from './fixtures/cursor-models.json' with { type: 'json' };

// test/fixtures/cursor-models.json is a real Cursor.models.list() response from @cursor/sdk 1.4.2.
const models = catalog as SDKModel[];
const entry = (id: string) => {
  const found = models.find((m) => m.id === id);
  if (!found) throw new Error(`fixture has no ${id}`);
  return found;
};
const chat = (model: SDKModel) => toPiModel(model) as unknown as Model<'cursor-sdk'>;
const levels = (id: string) => getSupportedThinkingLevels(chat(entry(id)));

describe('catalog to Pi models', () => {
  test('every catalog model becomes a Pi model with a context window', () => {
    for (const model of models) {
      const pi = chat(model);
      expect(pi).toMatchObject({ id: model.id, name: model.displayName, input: ['text', 'image'], maxTokens: 64_000 });
      expect(pi.contextWindow).toBeGreaterThan(0);
    }
  });

  test.each([
    ['composer-2.5', ['off'], 200_000],
    ['default', ['off'], 200_000],
    ['grok-4.7', ['low', 'medium', 'high', 'xhigh'], 500_000],
    ['gpt-5.5', ['off', 'low', 'medium', 'high', 'xhigh'], 1_000_000],
    ['claude-opus-4-8', ['off', 'low', 'medium', 'high', 'xhigh', 'max'], 1_000_000],
    ['claude-opus-4-5', ['off', 'high'], 200_000],
    ['muse-wonder-1.0', ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], 1_000_000],
    ['claude-sonnet-4-5', ['off', 'high'], 200_000],
  ])('%s offers thinking levels %j and a %i-token context', (id, expected, context) => {
    expect(levels(id)).toStrictEqual(expected);
    expect(chat(entry(id)).contextWindow).toBe(context);
  });

  test('a thinking switch without the option to turn it off hides off', () => {
    const alwaysOn: SDKModel = { id: 'x', displayName: 'X', parameters: [{ id: 'thinking', values: [{ value: 'true' }] }] };
    expect(getSupportedThinkingLevels(chat(alwaysOn))).toStrictEqual(['high']);
  });
});

describe('model selection', () => {
  test('starts from the default variant and applies the thinking level to the effort parameter', () => {
    expect(selectModel(entry('grok-4.7'), 'grok-4.7', 'low')).toStrictEqual({
      id: 'grok-4.7',
      params: [
        { id: 'context', value: '500k' },
        { id: 'fast', value: 'true' },
        { id: 'reasoning_effort', value: 'low' },
      ],
    });
  });

  test('maps xhigh to extra-high and off to none where the model names them so', () => {
    expect(selectModel(entry('gpt-5.5'), 'gpt-5.5', 'xhigh').params).toContainEqual({ id: 'reasoning', value: 'extra-high' });
    expect(selectModel(entry('gpt-5.5'), 'gpt-5.5', undefined).params).toContainEqual({ id: 'reasoning', value: 'none' });
  });

  test('turns thinking off with the thinking switch, and on for any level', () => {
    const off = selectModel(entry('claude-opus-4-8'), 'claude-opus-4-8', undefined).params ?? [];
    expect(off).toContainEqual({ id: 'thinking', value: 'false' });
    expect(off).toContainEqual({ id: 'effort', value: 'high' });
    const on = selectModel(entry('claude-opus-4-8'), 'claude-opus-4-8', 'max').params ?? [];
    expect(on).toContainEqual({ id: 'thinking', value: 'true' });
    expect(on).toContainEqual({ id: 'effort', value: 'max' });
  });

  test('keeps the default effort when the level is not offered, and sends bare ids without parameters', () => {
    expect(selectModel(entry('grok-4.7'), 'grok-4.7', 'minimal').params).toContainEqual({ id: 'reasoning_effort', value: 'high' });
    expect(selectModel(entry('default'), 'default', 'high')).toStrictEqual({ id: 'default' });
    expect(selectModel(undefined, 'not-in-catalog', 'high')).toStrictEqual({ id: 'not-in-catalog' });
  });
});
