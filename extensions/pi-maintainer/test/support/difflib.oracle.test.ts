import { type Static, Type } from 'typebox';
import { describe, expect, test } from 'vitest';
import { type DifferOptions, getCloseMatches, type Hashable, isCharacterJunk, isLineJunk, type JunkPredicate, ndiff, SequenceMatcher, unifiedDiff } from '../../src/support/difflib.ts';
import { oracleCases, outcomeOf } from './oracle.ts';

const lines = Type.Array(Type.String());
const sequence = Type.Union([Type.String(), lines, Type.Array(Type.Number())]);
const junkSpec = Type.Union([Type.Null(), Type.Literal('IS_LINE_JUNK'), Type.Literal('IS_CHARACTER_JUNK'), lines]);
type JunkSpec = Static<typeof junkSpec>;

const namedJunk = { IS_LINE_JUNK: isLineJunk, IS_CHARACTER_JUNK: isCharacterJunk };

function junkOf(spec: JunkSpec): JunkPredicate<string> | null {
  if (spec === null) return null;
  if (typeof spec === 'string') return (element) => namedJunk[spec](element);
  const junk = new Set(spec);
  return (element) => junk.has(element);
}

function hashableJunkOf(spec: JunkSpec | undefined): JunkPredicate<Hashable> | null {
  const isjunk = junkOf(spec ?? null);
  return isjunk && ((element) => typeof element === 'string' && isjunk(element));
}

const differOptionsOf = ({ linejunk, charjunk }: { linejunk?: JunkSpec; charjunk?: JunkSpec }): DifferOptions => ({
  ...(linejunk === undefined ? {} : { linejunk: junkOf(linejunk) }),
  ...(charjunk === undefined ? {} : { charjunk: junkOf(charjunk) }),
});

const sequenceMatcherArgs = Type.Object({
  a: sequence,
  b: sequence,
  isjunk: Type.Optional(junkSpec),
  autojunk: Type.Optional(Type.Boolean()),
  n: Type.Optional(Type.Number()),
  longest: Type.Optional(Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()])),
});

const closeMatchArgs = Type.Object({ word: Type.String(), possibilities: lines, n: Type.Optional(Type.Number()), cutoff: Type.Optional(Type.Number()) });

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

const ndiffArgs = Type.Object({ a: lines, b: lines, linejunk: Type.Optional(junkSpec), charjunk: Type.Optional(junkSpec) });

describe('difflib matches CPython', () => {
  test.for(oracleCases('difflib', 'difflib.sequence_matcher', sequenceMatcherArgs))('SequenceMatcher $id', async ({ args, expected }) => {
    const { isjunk, n, longest, ...options } = args;
    const observe = () => {
      const s = new SequenceMatcher<Hashable>({ ...options, isjunk: hashableJunkOf(isjunk) });
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

  test.for(oracleCases('difflib', 'difflib.get_close_matches', closeMatchArgs))('getCloseMatches $id', async ({ args, expected }) => {
    const { word, possibilities, ...options } = args;
    expect(await outcomeOf(() => getCloseMatches(word, possibilities, options))).toEqual(expected);
  });

  test.for(oracleCases('difflib', 'difflib.unified_diff', unifiedDiffArgs))('unifiedDiff $id', async ({ args, expected }) => {
    const { a, b, ...options } = args;
    expect(await outcomeOf(() => unifiedDiff(a, b, options))).toEqual(expected);
  });

  test.for(oracleCases('difflib', 'difflib.ndiff', ndiffArgs))('ndiff $id', async ({ args, expected }) => {
    const { a, b, ...junk } = args;
    expect(await outcomeOf(() => ndiff(a, b, differOptionsOf(junk)))).toEqual(expected);
  });

  test.for(oracleCases('difflib', 'difflib.is_line_junk', Type.Object({ line: Type.String() })))('isLineJunk $id', async ({ args, expected }) => {
    expect(await outcomeOf(() => isLineJunk(args.line))).toEqual(expected);
  });

  test.for(oracleCases('difflib', 'difflib.is_character_junk', Type.Object({ ch: Type.String(), ws: Type.Optional(Type.String()) })))('isCharacterJunk $id', async ({ args, expected }) => {
    expect(await outcomeOf(() => isCharacterJunk(args.ch, args.ws))).toEqual(expected);
  });
});
