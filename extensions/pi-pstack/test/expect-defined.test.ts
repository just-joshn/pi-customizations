import { expect, test } from 'vitest';
import { expectDefined } from './support/expect-defined.ts';

test.for([0, false, '', null])('defined test values preserve $0', (value) => {
  expect(expectDefined(value)).toBe(value);
});

test('missing test values fail their existence assertion', () => {
  expect(() => expectDefined(undefined)).toThrow('expected undefined to be defined');
});
