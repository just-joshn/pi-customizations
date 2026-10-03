import { describe, expect, test } from 'vitest';
import { quoteShellWord } from '../src/shell-quote.ts';

describe('quoteShellWord', () => {
  test('leaves plain words unquoted on posix', () => {
    if (process.platform === 'win32') return;
    expect(quoteShellWord('src/main.py')).toBe('src/main.py');
  });

  test('single-quotes words with spaces on posix', () => {
    if (process.platform === 'win32') return;
    expect(quoteShellWord('my file.py')).toBe("'my file.py'");
  });

  test('escapes single quotes inside the word on posix', () => {
    if (process.platform === 'win32') return;
    expect(quoteShellWord("it's.py")).toBe(`'it'"'"'s.py'`);
  });

  test('quotes the empty word on posix', () => {
    if (process.platform === 'win32') return;
    expect(quoteShellWord('')).toBe("''");
  });

  test('keeps safe punctuation unquoted on posix', () => {
    if (process.platform === 'win32') return;
    expect(quoteShellWord('a.b-c_d/e:f@g+h=x')).toBe('a.b-c_d/e:f@g+h=x');
  });
});
