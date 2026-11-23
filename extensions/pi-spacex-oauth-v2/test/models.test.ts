import type { ModelParameterValue, SDKModel } from '@cursor/sdk';
import { type Api, getSupportedThinkingLevels, isModelType, type Model, type ThinkingLevel } from '@earendil-works/pi-ai';
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

type PiModel = Model<Api>;

async function listedModels(): Promise<PiModel[]> {
  const { ctx, published } = makeRefresh({ credential: oauthCredential('models-key') });
  await loadExtension().provider(CURSOR_ID).refreshModels(ctx);
  const persisted = published()[0]?.persist?.models ?? [];
  return persisted.filter((model): model is PiModel => isModelType(model, 'chat'));
}

async function listedModel(id: string): Promise<PiModel> {
  const found = (await listedModels()).find((m) => m.id === id);
  if (!found) throw new Error(`the Cursor model list has no ${id}`);
  return found;
}

/** Distinct advertised parameter sets. Empty parameter lists and duplicate parameter ids are not presets. */
function advertisedPresets(models: readonly SDKModel[]): number {
  const keyOf = (params: readonly ModelParameterValue[]): string | undefined => {
    if (params.length === 0 || params.some((param) => param.id.length === 0 || param.value.length === 0)) return undefined;
    const sorted = [...params].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (new Set(sorted.map((param) => param.id)).size !== sorted.length) return undefined;
    return JSON.stringify(sorted);
  };
  return models.reduce((count, model) => count + new Set((model.variants ?? []).map((variant) => keyOf(variant.params)).filter((key) => key !== undefined)).size, 0);
}

/** Asks `modelId` at `reasoning` and returns the model selection the agent was created with and sent. */
async function selectionFor(modelId: string, reasoning: ThinkingLevel | undefined, apiKey = 'key') {
  sdk.script(async () => ({ status: 'finished' }));
  await ask([system(freshPrompt()), user('hi')], { apiKey, ...(reasoning ? { reasoning } : {}) }, modelId);
  const agent = sdk.agents.at(-1);
  expect(agent?.sends[0]?.options?.model).toStrictEqual(agent?.options.model);
  return agent?.options.model;
}

type Selection = Awaited<ReturnType<typeof selectionFor>>;

async function paramsOf(modelId: string, reasoning: ThinkingLevel | undefined) {
  const selection = await selectionFor(modelId, reasoning);
  return typeof selection === 'object' ? (selection.params ?? []) : [];
}

/** Asks for each id in order and returns the selections, because the fake SDK tracks the latest agent. */
async function selectionForEach(ids: readonly string[]): Promise<Selection[]> {
  const [next, ...rest] = ids;
  if (next === undefined) return [];
  return [await selectionFor(next, undefined, 'models-key'), ...(await selectionForEach(rest))];
}

beforeEach(() => sdk.reset());

describe('Cursor catalog entries', () => {
  test('every catalog model stays selectable, and each advertised variant is its own preset', async () => {
    const models = await listedModels();
    const bases = models.filter((model) => fixture.some((entry) => entry.id === model.id));
    expect(bases.map((model) => model.id)).toStrictEqual(fixture.map((model) => model.id));
    for (const [index, model] of bases.entries()) {
      expect(model).toMatchObject({ name: fixture[index]?.displayName, input: ['text', 'image'], maxTokens: MAX_OUTPUT_TOKENS });
      expect(model.contextWindow).toBeGreaterThan(0);
    }
    expect(models).toHaveLength(fixture.length + advertisedPresets(fixture));
    expect(new Set(models.map((model) => model.id)).size).toBe(models.length);
    expect(models.every((model) => /^[A-Za-z0-9._@%=+-]+$/.test(model.id) && !model.id.endsWith(':'))).toBe(true);
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
    const model = await listedModel('always-on');
    expect(model.reasoning).toBe(true);
    expect(getSupportedThinkingLevels(model)).toStrictEqual(['high']);
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

describe('Cursor preset entries', () => {
  test('a preset pins context and effort in its id and name, and does not offer a thinking level', async () => {
    const models = await listedModels();
    const low = models.find((model) => model.id === 'grok-4.7@context=256k+fast=false+reasoning_effort=low');
    const fast = models.find((model) => model.id === 'grok-4.7@context=256k+fast=true+reasoning_effort=low');
    const composer = models.find((model) => model.id === 'composer-2.5@fast=false');
    const thinking = models.find((model) => model.id === 'claude-opus-4-5@thinking=true');
    if (!low) throw new Error('missing Grok 4.7 256K Low preset');
    expect(low).toMatchObject({ name: 'Grok 4.7 256K Low', contextWindow: 256_000, reasoning: false });
    expect(low).not.toHaveProperty('thinkingLevelMap');
    expect(getSupportedThinkingLevels(low)).toStrictEqual(['off']);
    expect(fast).toMatchObject({ name: 'Grok 4.7 256K Low Fast', contextWindow: 256_000, reasoning: false });
    expect(composer).toMatchObject({ name: 'Composer 2.5 fast=false', contextWindow: CONTEXT_200K, reasoning: false });
    expect(thinking).toMatchObject({ name: 'Claude Opus 4.5 Thinking', reasoning: false });
  });

  test('preset ids and names do not change when the catalog lists variants in another order', async () => {
    const original = await listedModels();
    const shuffled: SDKModel[] = fixture.map((model) => ({
      ...model,
      ...(model.parameters ? { parameters: [...model.parameters].toReversed() } : {}),
      ...(model.variants ? { variants: model.variants.toReversed().map((variant) => ({ ...variant, params: [...variant.params].toReversed() })) } : {}),
    }));
    fakeSdk.Cursor.models.list.mockResolvedValue(shuffled);
    const again = await listedModels();
    const view = (models: PiModel[]) => models.map((model) => ({ id: model.id, name: model.name, contextWindow: model.contextWindow, reasoning: model.reasoning }));
    expect(view(again)).toStrictEqual(view(original));
  });
});

describe('Cursor presets saved for offline starts', () => {
  test('an offline refresh lists the stored presets without asking Cursor', async () => {
    const { ctx, published } = makeRefresh({ credential: oauthCredential('models-key') });
    const provider = loadExtension().provider(CURSOR_ID);
    const live = await provider.refreshModels(ctx);
    const stored = published()[0]?.persist?.models;
    if (!stored) throw new Error('live refresh did not persist models');
    fakeSdk.Cursor.models.list.mockClear();
    const offline = makeRefresh({ allowNetwork: false, credential: oauthCredential('models-key'), stored: { models: stored } });
    const listed = await provider.refreshModels(offline.ctx);
    expect(fakeSdk.Cursor.models.list).not.toHaveBeenCalled();
    expect(listed.map((model) => model.id)).toStrictEqual(live.map((model) => model.id));
    expect(listed.some((model) => model.id === 'grok-4.7@context=256k+fast=false+reasoning_effort=low')).toBe(true);
  });
});

describe('Cursor preset encoding', () => {
  test('a preset keeps an encoded parameter value and skips a variant whose parameters are not a set', async () => {
    const odd: SDKModel = {
      id: 'sized',
      displayName: 'Sized',
      parameters: [{ id: 'context', values: [{ value: '256k', displayName: '256K' }, { value: 'huge' }] }],
      variants: [
        { displayName: 'Sized', isDefault: true, params: [{ id: 'context', value: '256k' }] },
        { displayName: 'Sized again', params: [{ id: 'context', value: '256k' }] },
        {
          displayName: 'Sized',
          params: [
            { id: 'context', value: 'huge' },
            { id: 'mode', value: 'a+b' },
          ],
        },
        {
          displayName: 'Bad',
          params: [
            { id: 'mode', value: 'a+b' },
            { id: 'mode', value: 'nope' },
          ],
        },
      ],
    };
    fakeSdk.Cursor.models.list.mockResolvedValue([odd]);
    const models = await listedModels();
    expect(models.map((model) => model.id)).toStrictEqual(['sized', 'sized@context=256k', 'sized@context=huge+mode=a%2Bb']);
    expect(models[2]).toMatchObject({ name: 'Sized huge a+b', contextWindow: 256_000, reasoning: false });
  });
});

describe('Cursor preset names', () => {
  test('presets that would share a label show the parameter values', async () => {
    const twin: SDKModel = {
      id: 'twin',
      displayName: 'Twin',
      parameters: [
        {
          id: 'effort',
          values: [
            { value: 'low', displayName: 'Low' },
            { value: 'high', displayName: 'Low' },
          ],
        },
      ],
      variants: [
        { displayName: 'Twin', params: [{ id: 'effort', value: 'low' }] },
        { displayName: 'Twin', params: [{ id: 'effort', value: 'high' }] },
      ],
    };
    fakeSdk.Cursor.models.list.mockResolvedValue([twin]);
    const models = await listedModels();
    expect(models.find((model) => model.id === 'twin@effort=low')?.name).toBe('Twin Low effort=low');
    expect(models.find((model) => model.id === 'twin@effort=high')?.name).toBe('Twin Low effort=high');
  });
});

describe('the selection Cursor receives for a catalog model', () => {
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

describe('every advertised Cursor preset reaches the SDK', () => {
  test.each(fixture)('$id sends every advertised preset to the SDK', async (model) => {
    const listed = await listedModels();
    expect(await selectionFor(model.id, undefined)).toMatchObject({ id: model.id });
    const expected = (model.variants ?? []).filter((variant) => variant.params.length > 0);
    const presets = listed.filter((entry) => entry.id.startsWith(`${model.id}@`));
    expect(presets).toHaveLength(expected.length);

    const selections = await selectionForEach(presets.map((entry) => entry.id));
    for (const variant of expected) {
      const containsPreset = selections.some((selection) => {
        if (typeof selection !== 'object' || selection.id !== model.id || Boolean(selection.maxMode) !== Boolean(variant.isMaxMode)) return false;
        const params = selection.params ?? [];
        return params.length === variant.params.length && variant.params.every(({ id, value }) => params.some((param) => param.id === id && param.value === value));
      });
      expect(containsPreset, `Missing request for ${model.id} with ${JSON.stringify(variant.params)}`).toBe(true);
    }
  });
});

describe('the selection Cursor receives for a preset', () => {
  test('sends the preset parameters exactly and does not apply a thinking level', async () => {
    expect(await selectionFor('grok-4.7@context=256k+fast=false+reasoning_effort=low', 'high')).toStrictEqual({
      id: 'grok-4.7',
      params: [
        { id: 'context', value: '256k' },
        { id: 'fast', value: 'false' },
        { id: 'reasoning_effort', value: 'low' },
      ],
    });
    expect(await selectionFor('grok-4.7@reasoning_effort=high+fast=true+context=500k', 'low')).toStrictEqual({
      id: 'grok-4.7',
      params: [
        { id: 'context', value: '500k' },
        { id: 'fast', value: 'true' },
        { id: 'reasoning_effort', value: 'high' },
      ],
      maxMode: true,
    });
  });

  test('resolves a preset written with a catalog alias', async () => {
    expect(await selectionFor('composer@fast=false', undefined)).toStrictEqual({ id: 'composer-2.5', params: [{ id: 'fast', value: 'false' }] });
  });
});

describe('Cursor preset selection without a live catalog', () => {
  test('sends a percent-encoded preset value unchanged', async () => {
    const odd: SDKModel = {
      id: 'sized',
      displayName: 'Sized',
      variants: [
        {
          displayName: 'Sized',
          params: [
            { id: 'context', value: 'huge' },
            { id: 'mode', value: 'a+b' },
          ],
        },
      ],
    };
    fakeSdk.Cursor.models.list.mockResolvedValue([odd]);
    expect(await selectionFor('sized@mode=a%2Bb+context=huge', 'low', 'encode-key')).toStrictEqual({
      id: 'sized',
      params: [
        { id: 'context', value: 'huge' },
        { id: 'mode', value: 'a+b' },
      ],
    });
  });

  test('sends a preset from its id when the catalog cannot be read', async () => {
    fakeSdk.Cursor.models.list.mockRejectedValue(new Error('offline'));
    expect(await selectionFor('grok-4.7@context=256k+fast=false+reasoning_effort=low', 'high', 'offline-key')).toStrictEqual({
      id: 'grok-4.7',
      params: [
        { id: 'context', value: '256k' },
        { id: 'fast', value: 'false' },
        { id: 'reasoning_effort', value: 'low' },
      ],
    });
  });
});

describe('rejected Cursor model ids', () => {
  test.each(['grok-4.7@', 'grok-4.7@fast', 'grok-4.7@fast=true+fast=false', 'grok-4.7@fast=%ZZ', 'grok-4.7@fast=%FF'])('rejects malformed preset id %s', async (modelId) => {
    const answer = await ask([system(freshPrompt()), user('hi')], { apiKey: 'key' }, modelId);
    expect(answer.message).toMatchObject({ stopReason: 'error', errorMessage: `Malformed Cursor model id: ${modelId}` });
    expect(fakeSdk.Agent.create).not.toHaveBeenCalled();
  });

  test('rejects a parameter set the catalog does not advertise', async () => {
    const answer = await ask([system(freshPrompt()), user('hi')], { apiKey: 'key' }, 'grok-4.7@fast=true');
    expect(answer.message).toMatchObject({ stopReason: 'error', errorMessage: 'Unknown Cursor model preset: grok-4.7@fast=true' });
    expect(fakeSdk.Agent.create).not.toHaveBeenCalled();
  });

  test('rejects a preset whose model is not in the catalog', async () => {
    const answer = await ask([system(freshPrompt()), user('hi')], { apiKey: 'key' }, 'not-a-model@fast=true');
    expect(answer.message.errorMessage).toBe('Unknown Cursor model preset: not-a-model@fast=true');
    expect(fakeSdk.Agent.create).not.toHaveBeenCalled();
  });
});
