import { Type } from 'typebox';
import { expect, test } from 'vitest';
import { chooseFence } from '../src/edit/fences.ts';
import { oracleCases, outcomeOf } from './support/oracle.ts';

const argsSchema = Type.Object({
  contents: Type.Optional(Type.Array(Type.String())),
  readonly_contents: Type.Optional(Type.Array(Type.Union([Type.String(), Type.Null()]))),
  fences: Type.Optional(Type.Array(Type.Tuple([Type.String(), Type.String()]))),
});

test.for(oracleCases('fences', 'fences.choose_fence', argsSchema))('chooseFence $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => chooseFence(args.contents, args.readonly_contents, args.fences))).toEqual(expected);
});
