import { expect, test } from 'vitest';
import { stateEntryRenderText } from '../../src/core/state-entry-render.ts';

test('notice entries render their text', () => {
  expect(stateEntryRenderText({ schema: 1, kind: 'notice', level: 'info', text: 'hello' })).toBe('hello');
});

test('snapshot entries stay hidden', () => {
  expect(stateEntryRenderText({ schema: 1, kind: 'snapshot', root: '/tmp', mode: 'diff' })).toBeNull();
});

test('unknown entries stay hidden', () => {
  expect(stateEntryRenderText({ schema: 1, kind: 'settled', outcome: 'idle' })).toBeNull();
  expect(stateEntryRenderText(null)).toBeNull();
  expect(stateEntryRenderText('plain')).toBeNull();
});
