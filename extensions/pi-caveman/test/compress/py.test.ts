// biome-ignore-all lint/security/noSecrets: Python repr and whitespace fixtures, not credentials
import { expect, test } from 'vitest';
import { countOccurrences, pyCompare, pyLen, pyRepr, pySetRepr, pySorted, pySplitlines, pySplitlinesKeepends, pyStem, pyStrip, pySuffix, replaceFirst } from '../../src/compress/py.ts';

test.for([
  { input: 'abc', repr: "'abc'" },
  { input: '', repr: "''" },
  { input: "it's", repr: '"it\'s"' },
  { input: `'"`, repr: `'\\'"'` },
  { input: 'a\\b', repr: "'a\\\\b'" },
  { input: '\t\n\r', repr: "'\\t\\n\\r'" },
  { input: '\x00', repr: "'\\x00'" },
  { input: '\u200b', repr: "'\\u200b'" },
  { input: '\u{e0001}', repr: "'\\U000e0001'" },
  { input: 'é ', repr: "'é '" },
])('pyRepr renders $input as $repr', ({ input, repr }) => {
  expect(pyRepr(input)).toBe(repr);
});

test('pyCompare orders by code point, not UTF-16 unit', () => {
  expect(pySorted(['\uffff', '\u{10000}', 'a'])).toEqual(['a', '\uffff', '\u{10000}']);
});
test('pyCompare puts a prefix first', () => {
  expect([pyCompare('ab', 'abc'), pyCompare('abc', 'ab'), pyCompare('', '')]).toEqual([-1, 1, 0]);
});
test('pySetRepr renders an empty set as set()', () => {
  expect(pySetRepr([])).toBe('set()');
});
test('pySetRepr renders sorted members', () => {
  expect(pySetRepr(['b', 'a'])).toBe("{'a', 'b'}");
});
test('pyStrip removes Python whitespace but keeps the BOM', () => {
  expect(pyStrip('\u3000\ufeffx\x85 ')).toBe('\ufeffx');
});
test('pyLen counts astral characters once', () => {
  expect(pyLen('a😀')).toBe(2);
});
test('pySplitlinesKeepends keeps each terminator', () => {
  expect(pySplitlinesKeepends('a\r\nb\rc\u2028d')).toEqual(['a\r\n', 'b\r', 'c\u2028', 'd']);
});
test('pySplitlines drops terminators', () => {
  expect(pySplitlines('a\r\nb\n')).toEqual(['a', 'b']);
});
test('pySplitlines of the empty string is empty', () => {
  expect(JSON.stringify(pySplitlines(''))).toBe('[]');
});
test.for([
  { name: 'a.md', suffix: '.md', stem: 'a' },
  { name: '.env', suffix: '', stem: '.env' },
  { name: 'a.', suffix: '', stem: 'a.' },
  { name: 'a.b.c', suffix: '.c', stem: 'a.b' },
  { name: '', suffix: '', stem: '' },
])('pySuffix/pyStem split $name', ({ name, suffix, stem }) => {
  expect([pySuffix(name), pyStem(name)]).toEqual([suffix, stem]);
});
test('replaceFirst replaces only the first match', () => {
  expect(replaceFirst('aXbX', 'X', 'Y')).toBe('aYbX');
});
test('replaceFirst leaves text without a match unchanged', () => {
  expect(replaceFirst('abc', 'X', 'Y')).toBe('abc');
});
test('countOccurrences counts non-overlapping matches', () => {
  expect(countOccurrences('aaaa', 'aa')).toBe(2);
});
test('countOccurrences of the empty needle is length plus one', () => {
  expect(countOccurrences('abc', '')).toBe(4);
});
