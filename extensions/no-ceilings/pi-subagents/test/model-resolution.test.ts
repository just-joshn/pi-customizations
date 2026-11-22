import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { resolveModelForSubagent } from '../src/runner.ts';
import type { SubagentDefinition } from '../src/types.ts';

const parent = { id: 'parent', provider: 'test' };
const other = { id: 'other', provider: 'test' };

const ctx = {
  model: parent,
  modelRegistry: {
    getAvailable: () => [parent, other],
    getAll: () => [parent, other],
    find: (provider: string, id: string) => (provider === 'test' && id === 'other' ? other : undefined),
  },
} as unknown as ExtensionContext;

const definition: SubagentDefinition = {
  name: 'test',
  description: '',
  tools: [],
  model: 'inherit',
  forceDefaultModel: false,
  prompt: '',
  permissionMode: 'default',
  isBackground: false,
  nestedTasks: false,
  source: 'builtin',
};

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
    expect(() => resolveModelForSubagent('missing', definition, ctx)).toThrow('Unknown model "missing"');
  });

  it('falls back to the parent when the agent default is unavailable', () => {
    expect(resolveModelForSubagent(undefined, { ...definition, model: 'missing' }, ctx)).toBe(parent);
  });
});
