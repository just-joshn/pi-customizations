import { expect } from 'vitest';

export function expectDefined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  if (value === undefined) throw new Error('Expected a defined test value');
  return value;
}
