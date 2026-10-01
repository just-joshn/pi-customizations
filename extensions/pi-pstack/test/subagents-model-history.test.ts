import { expect, test } from 'vitest';
import { ModelHistory } from '../src/subagents/model-history.ts';

test('model history preserves model transitions while collapsing adjacent repeats', () => {
  const history = new ModelHistory(['a', 'a']);
  const initial = history.snapshot();
  history.record('b');
  history.record('b');
  history.record('a');
  expect(initial).toEqual(['a']);
  expect(history.snapshot()).toEqual(['a', 'b', 'a']);
  expect(history.snapshot()).not.toBe(history.snapshot());
});
