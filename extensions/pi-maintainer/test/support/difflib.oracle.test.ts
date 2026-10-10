import { Type } from 'typebox';
import { describe, expect, test } from 'vitest';
import { getCloseMatches, type Hashable, type JunkPredicate, SequenceMatcher, unifiedDiff } from '../../src/support/difflib.ts';
import { oracleCases, outcomeOf } from './oracle.ts';

const lines = Type.Array(Type.String());
const sequence = Type.Union([Type.String(), lines, Type.Array(Type.Number())]);
const junkSpec = Type.Union([Type.Null(), lines]);

const sequenceMatcherArgs = Type.Object({
  a: sequence,
  b: sequence,
  isjunk: Type.Optional(junkSpec),
  autojunk: Type.Optional(Type.Boolean()),
  n: Type.Optional(Type.Number()),
  longest: Type.Optional(Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()])),
});

function junkOf(spec: readonly string[] | null | undefined): JunkPredicate<Hashable> | null {
  if (!spec) return null;
  const junk = new Set<Hashable>(spec);
  return (element) => junk.has(element);
}

describe('difflib matches CPython', () => {
  test.for(oracleCases('difflib', 'difflib.sequence_matcher', sequenceMatcherArgs))('SequenceMatcher $id', async ({ args, expected }) => {
    const { isjunk, n, longest, ...options } = args;
    const observe = () => {
      const s = new SequenceMatcher<Hashable>({ ...options, isjunk: junkOf(isjunk) });
      const found = longest === undefined ? s.findLongestMatch() : s.findLongestMatch(...longest);
      const [matchingBlocks, opcodes, groupedOpcodes] = [s.getMatchingBlocks(), s.getOpcodes(), s.getGroupedOpcodes(n)];
      return {
        find_longest_match: found,
        matching_blocks: matchingBlocks,
        opcodes,
        grouped_opcodes: groupedOpcodes,
        opcodes_after_grouping: s.getOpcodes(),
        ratio: s.ratio(),
        quick_ratio: s.quickRatio(),
        real_quick_ratio: s.realQuickRatio(),
      };
    };
    expect(await outcomeOf(observe)).toEqual(expected);
  });

  const closeMatchArgs = Type.Object({ word: Type.String(), possibilities: lines, n: Type.Optional(Type.Number()), cutoff: Type.Optional(Type.Number()) });
  test.for(oracleCases('difflib', 'difflib.get_close_matches', closeMatchArgs))('getCloseMatches $id', async ({ args, expected }) => {
    const { word, possibilities, ...options } = args;
    expect(await outcomeOf(() => getCloseMatches(word, possibilities, options))).toEqual(expected);
  });

  const unifiedDiffArgs = Type.Object({
    a: lines,
    b: lines,
    fromfile: Type.Optional(Type.String()),
    tofile: Type.Optional(Type.String()),
    fromfiledate: Type.Optional(Type.String()),
    tofiledate: Type.Optional(Type.String()),
    n: Type.Optional(Type.Number()),
    lineterm: Type.Optional(Type.String()),
  });
  test.for(oracleCases('difflib', 'difflib.unified_diff', unifiedDiffArgs))('unifiedDiff $id', async ({ args, expected }) => {
    const { a, b, ...options } = args;
    expect(await outcomeOf(() => unifiedDiff(a, b, options))).toEqual(expected);
  });
});
