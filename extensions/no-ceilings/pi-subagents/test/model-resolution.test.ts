import type { Api, Model } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { SubagentRunError } from '../src/failures.ts';
import { applyDefinitionToModel, resolveModelForSubagent, resolveSubagentModel } from '../src/model-resolution.ts';
import type { SubagentDefinition } from '../src/types.ts';
import { double, makeDefinition } from './harness.ts';

interface TestModel {
  readonly id: string;
  readonly provider: string;
}

const parent: TestModel = { id: 'parent', provider: 'test' };
const other: TestModel = { id: 'other', provider: 'test' };

const ctx = {
  model: parent,
  modelRegistry: {
    getAvailable: () => [parent, other],
    getAll: () => [parent, other],
    find: (provider: string, id: string) => (provider === 'test' && id === 'other' ? other : undefined),
  },
};

const definition: SubagentDefinition = makeDefinition();

describe('subagent model resolution', () => {
  it('inherits the parent for inherit, auto, and inherit-parent', () => {
    for (const model of ['inherit', 'auto', 'inherit-parent']) {
      expect(resolveModelForSubagent(model, definition, ctx)).toBe(parent);
    }
  });

  it('resolves a registered id and a provider/id pair', () => {
    expect(resolveModelForSubagent('other', definition, ctx)).toBe(other);
    expect(resolveModelForSubagent('test/other', definition, ctx)).toBe(other);
  });

  it('throws on an unregistered explicit id instead of silently using the parent', () => {
    expect(() => resolveModelForSubagent('missing', definition, ctx)).toThrow(SubagentRunError);
    expect(() => resolveModelForSubagent('missing', definition, ctx)).toThrow('Unknown model: "missing"');
  });

  it('falls back to the parent when the agent default is unavailable', () => {
    expect(resolveModelForSubagent(undefined, { ...definition, model: 'missing' }, ctx)).toBe(parent);
  });

  it('lets an explicit request win over the definition and falls back to the definition effort', () => {
    const tuned = makeDefinition({ model: 'other', thinking: 'high' });
    expect(resolveSubagentModel({ model: undefined, thinking: undefined }, tuned, ctx).thinking).toBe('high');
    expect(resolveSubagentModel({ model: 'inherit', thinking: 'low' }, tuned, ctx).thinking).toBe('low');
    expect(resolveSubagentModel({ model: 'inherit', thinking: undefined }, tuned, ctx).model).toBe(parent);
  });

  it('applies sampling and context window to a copy of the model', () => {
    const base = double<Model<Api>>({ provider: 'test', id: 'other', reasoning: true, contextWindow: 200_000, maxTokens: 8192, samplingParams: { top_k: 7 } });
    const tuned = applyDefinitionToModel(base, makeDefinition({ sampling: { temperature: 0.3, topP: 0.5, maxTokens: 1024 }, contextWindow: 64_000 }));
    expect(tuned.contextWindow).toBe(64_000);
    expect(tuned.maxTokens).toBe(1024);
    expect(tuned.samplingParams).toMatchObject({ top_k: 7, temperature: 0.3, top_p: 0.5 });
    expect(base.contextWindow).toBe(200_000);
    expect(base.samplingParams).toEqual({ top_k: 7 });
  });
});
