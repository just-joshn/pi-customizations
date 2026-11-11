import { expect, test } from 'vitest';
import { parseMarkdown } from './markdown.ts';
import { formatProblem } from './problem.ts';

test('a fence inside an HTML comment does not shift the next block', () => {
  const source = ['# T', '', '<!--', '```ts', '-->', '', '```ts', 'real()', '```'].join('\n');
  expect(parseMarkdown(source).blocks.map((block) => block.line)).toEqual([7]);
});

test('indented code blocks are counted, not returned with a made-up line', () => {
  const source = ['# T', '', '    indented()', '', '```kotlin compile-only', 'fenced()', '```'].join('\n');
  const parsed = parseMarkdown(source);
  expect(parsed.indentedBlocks).toBe(1);
  expect(parsed.blocks).toMatchObject([{ lang: 'kotlin', info: 'kotlin compile-only', line: 5 }]);
});

test.for([
  [{ kind: 'line', rel: 'a.md', line: 3, message: 'm' }, 'a.md:3 m'],
  [{ kind: 'file', rel: 'a.md', message: 'm' }, 'a.md: m'],
  [{ kind: 'skill', message: 'm' }, 'm'],
] as const)('formatProblem(%o) is %s', ([problem, expected]) => {
  expect(formatProblem(problem)).toBe(expected);
});
