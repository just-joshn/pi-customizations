import { expect, test } from 'vitest';
import { getCloseMatches, SequenceMatcher, unifiedDiff } from '../../src/support/difflib.ts';

test('ratio compares strings by code point, not UTF-16 unit', () => {
  expect(new SequenceMatcher({ a: '\u{1F600}a', b: '\u{1F600}b' }).ratio()).toBe(0.5);
});

test('ratio compares arrays of lines element by element', () => {
  const search = ['def foo():\n', '    return 1\n'];
  const chunk = ['def foo():\n', '    return 2\n'];

  expect(new SequenceMatcher({ a: search, b: chunk }).ratio()).toBe(0.5);
});

test('a junk predicate keeps blanks from anchoring a match', () => {
  const matcher = new SequenceMatcher({ isjunk: (char) => char === ' ', a: 'private Thread currentThread;', b: 'private volatile Thread currentThread;' });

  expect(matcher.getMatchingBlocks()).toEqual([
    { a: 0, b: 0, size: 8 },
    { a: 8, b: 17, size: 21 },
    { a: 29, b: 38, size: 0 },
  ]);
});

test('opcodes describe every edit that turns a into b', () => {
  expect(new SequenceMatcher({ a: 'qabxcd', b: 'abycdf' }).getOpcodes()).toEqual([
    ['delete', 0, 1, 0, 0],
    ['equal', 1, 3, 0, 2],
    ['replace', 3, 4, 2, 3],
    ['equal', 4, 6, 3, 5],
    ['insert', 6, 6, 5, 6],
  ]);
});

test('an element filling over 1% of 200 or more cannot start a match', () => {
  const b = `x${'P'.repeat(4)}${'y'.repeat(195)}`;

  expect([new SequenceMatcher({ a: 'P', b }).ratio(), new SequenceMatcher({ a: 'P', b, autojunk: false }).ratio()]).toEqual([0, 0.009950248756218905]);
});

test('grouping trims the cached opcodes the way CPython does', () => {
  const matcher = new SequenceMatcher({ a: 'abcdefghij', b: 'abcdeXghij' });
  matcher.getGroupedOpcodes(1);

  expect(matcher.getOpcodes()).toEqual([
    ['equal', 4, 5, 4, 5],
    ['replace', 5, 6, 5, 6],
    ['equal', 6, 7, 6, 7],
  ]);
});

test('close matches come back most similar first', () => {
  expect(getCloseMatches('appel', ['ape', 'apple', 'peach', 'puppy'])).toEqual(['apple', 'ape']);
});

test('a misspelled file name finds its one close match', () => {
  expect(getCloseMatches('editblock_codr.py', ['editblock_coder.py', 'wholefile_coder.py', 'base_coder.py'], { n: 1, cutoff: 0.8 })).toEqual(['editblock_coder.py']);
});

test('a NaN cutoff is rejected with Python spelling', () => {
  expect(() => getCloseMatches('a', ['a'], { cutoff: Number.NaN })).toThrow('cutoff must be in [0.0, 1.0]: nan');
});

test('an infinite cutoff is rejected with Python spelling', () => {
  expect(() => getCloseMatches('a', ['a'], { cutoff: Number.NEGATIVE_INFINITY })).toThrow('cutoff must be in [0.0, 1.0]: -inf');
});

test('unified diff writes dated headers', () => {
  const diff = unifiedDiff(['one', 'two', 'three', 'four'], ['zero', 'one', 'tree', 'four'], {
    fromfile: 'Original',
    tofile: 'Current',
    fromfiledate: '2005-01-26 23:30:50',
    tofiledate: '2010-04-02 10:20:52',
    lineterm: '',
  });

  expect(diff).toEqual(['--- Original\t2005-01-26 23:30:50', '+++ Current\t2010-04-02 10:20:52', '@@ -1,4 +1,4 @@', '+zero', ' one', '-two', '-three', '+tree', ' four']);
});

test('unified diff marks an empty original range as 0,0', () => {
  expect(unifiedDiff([], ['a\n', 'b\n'])).toEqual(['--- \n', '+++ \n', '@@ -0,0 +1,2 @@\n', '+a\n', '+b\n']);
});

test('context as long as the input yields one whole-file hunk', () => {
  const before = ['a\n', 'b\n', 'c\n'];
  const after = ['a\n', 'B\n', 'c\n', 'd\n'];

  expect(unifiedDiff(before, after, { n: Math.max(before.length, after.length) })).toEqual(['--- \n', '+++ \n', '@@ -1,3 +1,4 @@\n', ' a\n', '-b\n', '+B\n', ' c\n', '+d\n']);
});
