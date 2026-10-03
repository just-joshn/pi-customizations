import { describe, expect, test } from 'vitest';
import { errorsToLintResult, findFilenamesAndLinenums } from '../src/lint-regex.ts';

describe('findFilenamesAndLinenums', () => {
  test('extracts line numbers from flake8 style output', () => {
    const found = findFilenamesAndLinenums('src.py:2:12: F821 undefined name x\nsrc.py:5:1: E999 bad\n', ['src.py']);
    expect([...(found.get('src.py') ?? [])]).toEqual(expect.arrayContaining([2, 5]));
  });

  test('does not match python traceback file lines', () => {
    const found = findFilenamesAndLinenums('  File "src.py", line 2, in <module>\n', ['src.py']);
    expect(found.size).toBe(0);
  });

  test('matches any digit run terminated by a word boundary', () => {
    const found = findFilenamesAndLinenums('src.py:1234567 is not a real reference src.py:12: ok\n', ['src.py']);
    expect([...(found.get('src.py') ?? [])]).toEqual([1234567, 12]);
  });

  test('does not match digits run into letters', () => {
    const found = findFilenamesAndLinenums('src.py:12ab no boundary here\n', ['src.py']);
    expect(found.size).toBe(0);
  });

  test('ignores references to other files', () => {
    const found = findFilenamesAndLinenums('other.py:3:1: E9 oops\n', ['src.py']);
    expect(found.size).toBe(0);
  });
});

describe('errorsToLintResult', () => {
  test('keeps the full output and converts to zero-indexed lines', () => {
    const result = errorsToLintResult('src.py', '## Running: flake8\n\nsrc.py:2:1: F821 boom\n');
    expect(result).toEqual({ text: '## Running: flake8\n\nsrc.py:2:1: F821 boom\n', lines: [1] });
  });

  test('keeps output that has no line references', () => {
    const result = errorsToLintResult('src.py', 'command not found\n');
    expect(result).toEqual({ text: 'command not found\n', lines: [] });
  });

  test('returns undefined for empty output', () => {
    expect(errorsToLintResult('src.py', '')).toBe(undefined);
  });
});
