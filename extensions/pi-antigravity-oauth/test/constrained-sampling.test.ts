import { type Tool, Type } from '@earendil-works/pi-ai';
import { expect } from 'vitest';
import {
  appendGrammarToolInputJsonDelta,
  createGrammarToolInputProperties,
  getGrammarToolInput,
  getJsonSchemaToolParameters,
  makeStrictJsonSchema,
  resolveGrammarConstrainedSampling,
  resolveJsonSchemaStrictSampling,
} from '../src/pi-ai/constrained-sampling.ts';
import { test } from './network-guard.ts';

function tool(schema: Record<string, unknown> = { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] }): Tool {
  return { name: 'query', description: 'Run query', parameters: Type.Unsafe(schema) };
}
function grammar(schema?: Record<string, unknown>): Tool {
  return { ...tool(schema), constrainedSampling: { type: 'grammar', variants: { openai_lark: 'start: "x"', openai_regex: 'x+' } } };
}

test('strict schemas require every field while preserving caller input', () => {
  const schema = Type.Unsafe({ type: 'object', properties: { name: { type: 'string' }, nested: { type: 'object' }, list: { type: 'array', items: { type: 'number' } } }, required: ['name'] });
  expect(makeStrictJsonSchema(schema)).toEqual({
    type: 'object',
    properties: { name: { type: 'string' }, nested: { anyOf: [{ type: 'object', required: [], additionalProperties: false }, { type: 'null' }] }, list: { anyOf: [{ type: 'array', items: { type: 'number' } }, { type: 'null' }] } },
    required: ['name', 'nested', 'list'],
    additionalProperties: false,
  });
  expect(schema).toEqual({ type: 'object', properties: { name: { type: 'string' }, nested: { type: 'object' }, list: { type: 'array', items: { type: 'number' } } }, required: ['name'] });
});

test.for([{ type: 'null' }, { type: ['string', 'null'] }, { const: null }, { enum: ['a', null] }, { anyOf: [{ type: 'string' }, { type: 'null' }] }])('strict optional nullable fields keep their declared schema', (property) => {
  expect(makeStrictJsonSchema(Type.Unsafe({ type: 'object', properties: { value: property } }))).toEqual({ type: 'object', properties: { value: property }, required: ['value'], additionalProperties: false });
});

test.for([
  { schema: true, error: 'root schema' },
  { schema: null, error: 'root schema' },
  { schema: { type: 'string' }, error: 'root schema' },
  { schema: { type: 'object', properties: { x: false } }, error: 'boolean schemas' },
  { schema: { type: 'object', anyOf: [] }, error: 'at least one schema' },
  { schema: { type: 'object', anyOf: 'bad' }, error: 'at least one schema' },
  { schema: { type: 'object', anyOf: [{ type: 'array' }] }, error: 'object and array unions' },
  { schema: { type: 'object', anyOf: [{ properties: {} }] }, error: 'object and array unions' },
  { schema: { type: 'object', items: [] }, error: 'tuple schemas' },
  { schema: { properties: {} }, error: 'properties require type object' },
  { schema: { type: 'object', additionalProperties: true }, error: 'additionalProperties' },
  { schema: { type: 'object', properties: [] }, error: 'schema map' },
  { schema: { type: 'object', required: 'x' }, error: 'string array' },
  { schema: { type: 'object', required: [1] }, error: 'string array' },
  { schema: { type: 'object', required: ['missing'] }, error: 'unknown property' },
])('strict schemas reject unsupported shapes: $error', ({ schema, error }) => {
  expect(() => Reflect.apply(makeStrictJsonSchema, undefined, [schema])).toThrow(error);
});

test.for(['$ref', '$defs', 'definitions', 'allOf', 'oneOf', 'patternProperties', 'dependentSchemas', 'dependencies', 'unevaluatedProperties', 'propertyNames', 'contains', 'prefixItems', 'not', 'if', 'then', 'else'])(
  'strict schemas reject keyword %s',
  (keyword) => {
    expect(() => makeStrictJsonSchema(Type.Unsafe({ type: 'object', [keyword]: {} }))).toThrow(`${keyword} schemas are unsupported`);
  },
);

test('provider keyword checks traverse nested properties', () => {
  expect(() => makeStrictJsonSchema(Type.Unsafe({ type: 'object', properties: { x: { type: 'string', format: 'email' } } }), (key) => key === 'format')).toThrow('format: "email" is unsupported');
});

test('strict parameter selection preserves non-strict schema identity', () => {
  const subject = tool();
  expect(getJsonSchemaToolParameters(subject, false)).toBe(subject.parameters);
  expect(getJsonSchemaToolParameters(subject, true)).toEqual({ type: 'object', properties: { input: { type: 'string' } }, required: ['input'], additionalProperties: false });
  expect(resolveJsonSchemaStrictSampling(subject, true)).toBeUndefined();
});

test.for([
  { supported: true, strict: 'prefer', valid: true, expected: true },
  { supported: true, strict: 'prefer', valid: false, expected: undefined },
  { supported: false, strict: 'prefer', valid: true, expected: undefined },
] as const)('strict preference respects provider support', ({ supported, strict, valid, expected }) => {
  const subject = { ...tool(valid ? undefined : { type: 'object', $ref: 'x' }), constrainedSampling: { type: 'json_schema', strict } } satisfies Tool;
  expect(resolveJsonSchemaStrictSampling(subject, supported)).toBe(expected);
});

test.for([true, false])('required strict sampling fails rather than downgrading', (supported) => {
  const subject = { ...tool({ type: 'object', $ref: 'x' }), constrainedSampling: { type: 'json_schema', strict: 'require' } } satisfies Tool;
  expect(() => resolveJsonSchemaStrictSampling(subject, supported)).toThrow('Tool "query" requires JSON-schema constrained sampling');
});

test('unexpected provider validation errors propagate unchanged', () => {
  const failure = new Error('validator unavailable');
  const subject = { ...tool(), constrainedSampling: { type: 'json_schema', strict: 'prefer' } } satisfies Tool;
  expect(() =>
    resolveJsonSchemaStrictSampling(subject, true, () => {
      throw failure;
    }),
  ).toThrow(failure);
});

test('grammar prefers Lark with regex fallback', () => {
  expect(resolveGrammarConstrainedSampling(grammar(), true)).toEqual({ format: 'lark', definition: 'start: "x"', inputProperty: 'input' });
  expect(resolveGrammarConstrainedSampling({ ...tool(), constrainedSampling: { type: 'grammar', variants: { openai_lark: ' ', openai_regex: 'x+' } } }, true)).toEqual({ format: 'regex', definition: 'x+', inputProperty: 'input' });
  expect(resolveGrammarConstrainedSampling(grammar(), false)).toBeUndefined();
  expect(resolveGrammarConstrainedSampling(tool(), true)).toBeUndefined();
  expect([...createGrammarToolInputProperties([grammar(), tool()], true)]).toEqual([['query', 'input']]);
  expect(createGrammarToolInputProperties(undefined, true).size).toBe(0);
});

test.for([
  { schema: { type: 'string' }, error: 'object parameter schema' },
  { schema: { type: 'object' }, error: 'exactly one required' },
  { schema: { type: 'object', required: [1] }, error: 'exactly one required' },
  { schema: { type: 'object', required: ['x'] }, error: 'properties entry' },
  { schema: { type: 'object', required: ['x'], properties: { x: { type: 'number' } } }, error: 'must have type string' },
])('grammar rejects invalid input contracts: $error', ({ schema, error }) => {
  expect(() => resolveGrammarConstrainedSampling(grammar(schema), true)).toThrow(error);
});

test('grammar rejects a missing supported variant', () => {
  expect(() => resolveGrammarConstrainedSampling({ ...tool(), constrainedSampling: { type: 'grammar', variants: {} } }, true)).toThrow('no supported grammar variant');
});

test('grammar input requires a string including empty strings', () => {
  expect(getGrammarToolInput('query', { input: '' }, 'input')).toBe('');
  expect(getGrammarToolInput('query', { input: '😀' }, 'input')).toBe('😀');
  expect(() => getGrammarToolInput('query', {}, 'input')).toThrow('requires argument "input" to be a string');
});

test('grammar JSON deltas escape streamed input once', () => {
  const buffer = { input: '', started: false, closed: false };
  expect(appendGrammarToolInputJsonDelta(buffer, 'input', '', false)).toBeUndefined();
  expect(appendGrammarToolInputJsonDelta(buffer, 'input', '😀\n', false)).toBe('{"input":"😀\\n');
  expect(appendGrammarToolInputJsonDelta(buffer, 'input', '😀\n"', true)).toBe('\\""}');
  expect(appendGrammarToolInputJsonDelta(buffer, 'input', '😀\n"', true)).toBeUndefined();
  expect(() => appendGrammarToolInputJsonDelta(buffer, 'input', 'changed', false)).toThrow('changed after it was closed');
});

test('grammar deltas reject rewrites before close', () => {
  const buffer = { input: 'abc', started: true, closed: false };
  expect(() => appendGrammarToolInputJsonDelta(buffer, 'input', 'ab', false)).toThrow('changed non-monotonically');
  expect(appendGrammarToolInputJsonDelta({ input: '', started: false, closed: false }, 'input', '', true)).toBe('{"input":""}');
});
