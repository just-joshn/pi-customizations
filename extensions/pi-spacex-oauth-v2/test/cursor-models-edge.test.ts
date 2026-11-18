import { afterEach, describe, expect, test, vi } from 'vitest';
import { collapseModels, fetchCursorModels, resolveCursorModelId } from '../src/cursor/models.ts';

afterEach(() => vi.unstubAllGlobals());

describe('resolveCursorModelId fallbacks', () => {
  test('falls back through medium, high, low, then any mapped id, then the pi id', () => {
    expect(resolveCursorModelId('m', { off: null, high: 'm-high' }, 'off')).toBe('m-high');
    expect(resolveCursorModelId('m', { low: 'm-low' }, undefined)).toBe('m-low');
    expect(resolveCursorModelId('m', { max: 'm-max' }, 'off')).toBe('m-max');
    expect(resolveCursorModelId('m', { off: null }, 'off')).toBe('m');
  });
});

describe('collapseModels edge cases', () => {
  test('skips the default alias and uses the id when Cursor sends no display name', () => {
    const out = collapseModels([{ modelId: 'default' }, { modelId: 'solo-model' }, { modelId: 'x-low', displayName: 'X Low' }, { modelId: 'x-medium', displayName: 'X Medium' }]);
    expect(out.map((m) => m.id)).toStrictEqual(['auto', 'solo-model', 'x']);
    expect(out[1]?.name).toBe('solo-model');
    expect(out[2]?.name).toBe('X');
    expect(out[2]).toMatchObject({ reasoning: true, thinkingLevelMap: { off: null, low: 'x-low', medium: 'x-medium' } });
  });

  test('names a model from its only variant when there is no plain or high one', () => {
    expect(collapseModels([{ modelId: 'y-low', displayName: 'Y Low' }])[1]?.name).toBe('Y');
  });
});

describe('fetchCursorModels', () => {
  test('surfaces the HTTP status when the model list fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    await expect(fetchCursorModels('tok')).rejects.toThrow('Cursor model list failed: HTTP 401');
  });

  test('passes the abort signal through and tolerates an empty list', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    expect((await fetchCursorModels('tok', signal)).map((m) => m.id)).toStrictEqual(['auto']);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ signal });
  });
});
