import { Type } from 'typebox';
import { describe, expect, test } from 'vitest';
import { count, expandtabs, isSpace, lstrip, replaceAll, rstrip, splitlines, splitWhitespace, strip } from '../src/support/pystr.ts';
import { oracleCases, outcomeOf } from './support/oracle.ts';

const text = Type.Object({ text: Type.String() });

describe('Python str semantics match CPython', () => {
  test.for(oracleCases('pystr', 'pystr.splitlines', Type.Object({ text: Type.String(), keepends: Type.Boolean() })))('splitlines $id', async ({ args, expected }) => {
    expect(await outcomeOf(() => splitlines(args.text, args.keepends))).toEqual(expected);
  });

  test.for(oracleCases('pystr', 'pystr.strip', Type.Object({ text: Type.String(), chars: Type.Optional(Type.String()) })))('strip $id', async ({ args, expected }) => {
    expect(await outcomeOf(() => ({ strip: strip(args.text, args.chars), lstrip: lstrip(args.text, args.chars), rstrip: rstrip(args.text, args.chars) }))).toEqual(expected);
  });

  test.for(oracleCases('pystr', 'pystr.isspace', text))('isspace $id', async ({ args, expected }) => {
    expect(await outcomeOf(() => isSpace(args.text))).toEqual(expected);
  });

  test.for(oracleCases('pystr', 'pystr.split', text))('split $id', async ({ args, expected }) => {
    expect(await outcomeOf(() => splitWhitespace(args.text))).toEqual(expected);
  });

  test.for(oracleCases('pystr', 'pystr.count', Type.Object({ text: Type.String(), sub: Type.String() })))('count $id', async ({ args, expected }) => {
    expect(await outcomeOf(() => count(args.text, args.sub))).toEqual(expected);
  });

  test.for(oracleCases('pystr', 'pystr.replace', Type.Object({ text: Type.String(), old: Type.String(), new: Type.String() })))('replace $id', async ({ args, expected }) => {
    expect(await outcomeOf(() => replaceAll(args.text, args.old, args.new))).toEqual(expected);
  });

  test.for(oracleCases('pystr', 'pystr.expandtabs', Type.Object({ text: Type.String(), tabsize: Type.Number() })))('expandtabs $id', async ({ args, expected }) => {
    expect(await outcomeOf(() => expandtabs(args.text, args.tabsize))).toEqual(expected);
  });
});
