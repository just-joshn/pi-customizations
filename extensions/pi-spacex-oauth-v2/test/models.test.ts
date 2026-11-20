import type { SDKModel } from '@cursor/sdk';
import { getSupportedThinkingLevels, type Model, type ThinkingLevel } from '@earendil-works/pi-ai';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeSdk, sdk } from './fake-sdk.ts';
import catalog from './fixtures/cursor-models.json' with { type: 'json' };
import { CURSOR_ID, loadExtension, makeRefresh, oauthCredential } from './host.ts';
import { ask, freshPrompt, system, user } from './stream-helpers.ts';

vi.mock('@cursor/sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fake-sdk.ts')).fakeSdk }));

const CONTEXT_200K = 200_000;
const CONTEXT_500K = 500_000;
const CONTEXT_1M = 1_000_000;
const MAX_OUTPUT_TOKENS = 64_000;

// test/fixtures/cursor-models.json is a real Cursor.models.list() response from @cursor/sdk 1.4.2.
const fixture = catalog as SDKModel[];

type PiModel = Model<'cursor-sdk'>;

async function listedModels(): Promise<PiModel[]> {
  const { ctx } = makeRefresh({ credential: oauthCredential('models-key') });
  const models = await loadExtension().provider(CURSOR_ID).refreshModels(ctx);
  return models as unknown as PiModel[];
}

async function listedModel(id: string): Promise<PiModel> {
  const found = (await listedModels()).find((m) => m.id === id);
  if (!found) throw new Error(`the Cursor model list has no ${id}`);
  return found;
}

beforeEach(() => sdk.reset());

describe('Cursor models in Pi', () => {
  test('every catalog model becomes a Pi model with a name, image input, and a context window', async () => {
    const models = await listedModels();
    expect(models.map((m) => m.id)).toStrictEqual(fixture.map((m) => m.id));
    for (const [index, model] of models.entries()) {
      expect(model).toMatchObject({ name: fixture[index]?.displayName, input: ['text', 'image'], maxTokens: MAX_OUTPUT_TOKENS });
      expect(model.contextWindow).toBeGreaterThan(0);
    }
  });

  test.each([
    ['composer-2.5', ['off'], CONTEXT_200K],
    ['default', ['off'], CONTEXT_200K],
    ['grok-4.7', ['low', 'medium', 'high', 'xhigh'], CONTEXT_500K],
    ['gpt-5.5', ['off', 'low', 'medium', 'high', 'xhigh'], CONTEXT_1M],
    ['claude-opus-4-8', ['off', 'low', 'medium', 'high', 'xhigh', 'max'], CONTEXT_1M],
    ['claude-opus-4-5', ['off', 'high'], CONTEXT_200K],
    ['muse-wonder-1.0', ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], CONTEXT_1M],
    ['claude-sonnet-4-5', ['off', 'high'], CONTEXT_200K],
  ])('%s offers thinking levels %j and a %i-token context', async (id, levels, context) => {
    const model = await listedModel(id);
    expect(getSupportedThinkingLevels(model)).toStrictEqual(levels);
    expect(model.contextWindow).toBe(context);
  });

  test('a thinking switch without the option to turn it off hides off', async () => {
    const alwaysOn: SDKModel = { id: 'always-on', displayName: 'Always On', parameters: [{ id: 'thinking', values: [{ value: 'true' }] }] };
    fakeSdk.Cursor.models.list.mockResolvedValue([alwaysOn]);
    const [model] = await listedModels();
    expect(model?.reasoning).toBe(true);
    expect(getSupportedThinkingLevels(model as PiModel)).toStrictEqual(['high']);
  });

  test('a model with no reasoning controls is not offered thinking', async () => {
    const plain: SDKModel = { id: 'plain', displayName: 'Plain' };
    fakeSdk.Cursor.models.list.mockResolvedValue([plain]);
    const [model] = await listedModels();
    expect(model).toMatchObject({ reasoning: false, contextWindow: CONTEXT_200K });
    expect(model).not.toHaveProperty('thinkingLevelMap');
  });

  test('a context default that is not a size falls back to 200k', async () => {
    const odd: SDKModel = { id: 'odd', displayName: 'Odd', variants: [{ displayName: 'Odd', isDefault: true, params: [{ id: 'context', value: 'huge' }] }] };
    fakeSdk.Cursor.models.list.mockResolvedValue([odd]);
    expect((await listedModels())[0]?.contextWindow).toBe(CONTEXT_200K);
  });
});

describe('the model selection Cursor receives', () => {
  /** Asks `modelId` at `reasoning` and returns the model selection the agent was created with and sent. */
  async function selectionFor(modelId: string, reasoning: ThinkingLevel | undefined) {
    sdk.script(async () => ({ status: 'finished' }));
    await ask([system(freshPrompt()), user('hi')], { apiKey: 'key', ...(reasoning ? { reasoning } : {}) }, modelId);
    const agent = sdk.agents.at(-1);
    expect(agent?.sends[0]?.options?.model).toStrictEqual(agent?.options.model);
    return agent?.options.model;
  }

  const paramsOf = async (modelId: string, reasoning: ThinkingLevel | undefined) => {
    const selection = await selectionFor(modelId, reasoning);
    return typeof selection === 'object' ? (selection.params ?? []) : [];
  };

  test('starts from the default variant and applies the thinking level to the effort parameter', async () => {
    expect(await selectionFor('grok-4.7', 'low')).toStrictEqual({
      id: 'grok-4.7',
      params: [
        { id: 'context', value: '500k' },
        { id: 'fast', value: 'true' },
        { id: 'reasoning_effort', value: 'low' },
      ],
    });
  });

  test('maps xhigh to extra-high and off to none where the model names them so', async () => {
    expect(await paramsOf('gpt-5.5', 'xhigh')).toContainEqual({ id: 'reasoning', value: 'extra-high' });
    expect(await paramsOf('gpt-5.5', undefined)).toContainEqual({ id: 'reasoning', value: 'none' });
  });

  test('turns thinking off with the thinking switch, and on for any level', async () => {
    const off = await paramsOf('claude-opus-4-8', undefined);
    expect(off).toContainEqual({ id: 'thinking', value: 'false' });
    expect(off).toContainEqual({ id: 'effort', value: 'high' });
    const on = await paramsOf('claude-opus-4-8', 'max');
    expect(on).toContainEqual({ id: 'thinking', value: 'true' });
    expect(on).toContainEqual({ id: 'effort', value: 'max' });
  });

  test('keeps the default effort when the level is not offered', async () => {
    expect(await paramsOf('grok-4.7', 'minimal')).toContainEqual({ id: 'reasoning_effort', value: 'high' });
  });

  test('sends a bare id for a model whose catalog entry has no parameters', async () => {
    expect(await selectionFor('default', 'high')).toStrictEqual({ id: 'default' });
  });

  test('sends a bare id for a model missing from the catalog', async () => {
    expect(await selectionFor('not-in-catalog', 'high')).toStrictEqual({ id: 'not-in-catalog' });
  });

  test('resolves a model alias to the catalog id', async () => {
    expect(await selectionFor('auto', undefined)).toStrictEqual({ id: 'default' });
  });
});
