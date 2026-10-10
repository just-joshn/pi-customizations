import { Type } from 'typebox';
import { expect, test } from 'vitest';
import { pyFormat } from '../src/support/pyformat.ts';
import { oracleCases, outcomeOf } from './support/oracle.ts';

const schema = Type.Object({
  template: Type.String(),
  values: Type.Record(Type.String(), Type.Union([Type.String(), Type.Array(Type.String())])),
});

test.for(oracleCases('pyformat', 'pyformat.format', schema))('str.format $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => pyFormat(args.template, args.values))).toEqual(expected);
});

test.for([
  { template: '{}', reason: 'only named fields' },
  { template: '{0}', reason: 'only named fields' },
  { template: '{x.upper}', reason: 'only named fields' },
  { template: '{x[a]}', reason: 'only named fields' },
  { template: '{x!r}', reason: 'no conversion or format spec' },
  { template: '{x:>5}', reason: 'no conversion or format spec' },
  { template: '{fence}', reason: 'only string values' },
])('rejects $template, which no Aider template uses', ({ template, reason }) => {
  expect(() => pyFormat(template, { x: 'value', fence: ['```', '```'] })).toThrow(reason);
});
