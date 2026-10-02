import { expect, test } from 'vitest';
import { capResultText, resultTextLimit } from '../src/subagents/limits.ts';

test('the result text limit stays the documented 100000 characters', () => {
  expect(resultTextLimit).toBe(100_000);
});

test('a result within the limit is returned whole and a longer one is cut to the limit', () => {
  expect(capResultText('short')).toBe('short');
  const long = 'x'.repeat(resultTextLimit + 10);
  expect(capResultText(long)).toHaveLength(resultTextLimit);
});
