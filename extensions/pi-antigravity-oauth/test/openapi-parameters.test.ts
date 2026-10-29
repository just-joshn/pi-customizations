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

test('a union of same-type literal branches becomes one enum', () => {
  expect(
    sanitizeOpenApiParameters({
      type: 'object',
      properties: {
        kind: {
          description: 'Chart kind',
          anyOf: [
            { type: 'string', enum: ['bar'] },
            { type: 'string', enum: ['line'] },
          ],
        },
      },
    }),
  ).toEqual({
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['bar', 'line'], description: 'Chart kind' },
    },
  });
});

test('a union of different types stays a union', () => {
  expect(
    sanitizeOpenApiParameters({
      anyOf: [
        { type: 'string', enum: ['x'] },
        { type: 'number', enum: [1] },
      ],
    }),
  ).toEqual({
    anyOf: [
      { type: 'string', enum: ['x'] },
      { type: 'number', enum: [1] },
    ],
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
