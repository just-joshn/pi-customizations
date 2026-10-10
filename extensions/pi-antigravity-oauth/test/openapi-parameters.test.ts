import { expect, test } from 'vitest';
import { sanitizeOpenApiParameters } from '../src/openapi-parameters.ts';

test('const becomes a single-value enum', () => {
  expect(sanitizeOpenApiParameters({ type: 'string', const: 'webhook' })).toEqual({ type: 'string', enum: ['webhook'] });
});

test('existing enum absorbs const without duplicates', () => {
  expect(sanitizeOpenApiParameters({ type: 'string', const: 'a', enum: ['a', 'b'] })).toEqual({ type: 'string', enum: ['a', 'b'] });
  expect(sanitizeOpenApiParameters({ type: 'string', const: 'c', enum: ['a', 'b'] })).toEqual({ type: 'string', enum: ['a', 'b', 'c'] });
});

test('uniqueItems is removed recursively', () => {
  expect(
    sanitizeOpenApiParameters({
      type: 'object',
      properties: {
        tools: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        kind: { const: 'disabled', type: 'string' },
      },
    }),
  ).toEqual({
    type: 'object',
    properties: {
      tools: { type: 'array', items: { type: 'string' } },
      kind: { type: 'string', enum: ['disabled'] },
    },
  });
});

test('anyOf and allOf are preserved while nested keys are sanitized', () => {
  expect(
    sanitizeOpenApiParameters({
      anyOf: [{ const: 'x' }, { type: 'string', uniqueItems: true }],
      allOf: [{ type: 'object', properties: { n: { const: 1 } } }],
    }),
  ).toEqual({
    anyOf: [{ enum: ['x'] }, { type: 'string' }],
    allOf: [{ type: 'object', properties: { n: { enum: [1] } } }],
  });
});
