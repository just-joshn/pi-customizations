import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';
import { collapseModels, parseVariant, resolveCursorModelId } from '../src/cursor/models.ts';

const cursorModels = JSON.parse(readFileSync(new URL('./fixtures/cursor-usable-models.json', import.meta.url), 'utf8')).models;

describe('Cursor model collapsing (GetUsableModels, recorded)', () => {
  const models = collapseModels(cursorModels);
  const byId = new Map(models.map((m) => [m.id, m]));

  test('turns 280 effort/fast ids into one pi model per base and fast base', () => {
    expect(cursorModels).toHaveLength(280);
    expect(models.length).toBeLessThan(100);
    expect(byId.has('claude-opus-5-5')).toBe(true);
    expect(byId.has('claude-opus-5-5-fast')).toBe(true);
    expect(byId.has('claude-opus-5-5-high')).toBe(false);
  });

  test('maps pi thinking levels to real Cursor ids', () => {
    const grok = byId.get('grok-4.7-fast');
    expect(grok && 'thinkingLevelMap' in grok ? grok.thinkingLevelMap : undefined).toMatchObject({ low: 'grok-4.7-low-fast', xhigh: 'grok-4.7-xhigh-fast', minimal: null, max: null });
  });

  test('folds -none variants into thinking off', () => {
    const sol = byId.get('gpt-5.6-sol');
    expect(sol && 'thinkingLevelMap' in sol ? sol.thinkingLevelMap?.off : undefined).toBe('gpt-5.6-sol-none');
    expect(byId.has('gpt-5.6-sol-none')).toBe(false);
  });

  test('names drop the effort words and zero-width characters', () => {
    expect(byId.get('grok-4.7-fast')?.name).toBe('Grok 4.7 Fast');
    expect(byId.get('claude-opus-5-5')?.name).toBe('Claude Opus 5.5 1M');
  });

  test("exposes Auto, which requests Cursor's default model", () => {
    expect(byId.has('auto')).toBe(true);
    expect(resolveCursorModelId('auto', undefined, 'high')).toBe('default');
  });
});

describe('resolveCursorModelId', () => {
  const map = { off: null, minimal: null, low: 'm-low', medium: 'm-medium', high: 'm-high', xhigh: null, max: null };
  test.for([
    ['low', 'm-low'],
    ['high', 'm-high'],
    ['xhigh', 'm-medium'],
    [undefined, 'm-medium'],
  ] as const)('level %s requests %s', ([level, expected]) => {
    expect(resolveCursorModelId('m', map, level)).toBe(expected);
  });

  test('models without effort variants request their own id', () => {
    expect(resolveCursorModelId('composer-2.5', undefined, 'high')).toBe('composer-2.5');
  });
});

test.for([
  ['claude-opus-5-5-high-fast', { piId: 'claude-opus-5-5-fast', effort: 'high' }],
  ['composer-2.5', { piId: 'composer-2.5' }],
  ['gpt-5.6-sol-none', { piId: 'gpt-5.6-sol', effort: 'none' }],
] as const)('parseVariant(%s)', ([id, expected]) => {
  expect(parseVariant(id)).toStrictEqual(expected);
});
