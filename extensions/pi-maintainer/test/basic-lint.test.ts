import { describe, expect, test } from 'vitest';
import { basicLint } from '../src/basic-lint.ts';
import { loadParser } from '../src/parsers.ts';

const io = { error: (message: string) => expect.fail(`unexpected error output: ${message}`) };

describe('basicLint', () => {
  test('finds the python syntax error row', async () => {
    const result = await basicLint({ fname: 'syntax_err.py', code: 'def broken(\n    return 1\n', loadParser, io });
    expect(result).toEqual({ text: '', lines: [0] });
  });

  test('records both parent and child error rows in broken javascript', async () => {
    const result = await basicLint({ fname: 'syntax_err.js', code: 'function broken( {\n  return 1;\n}\n', loadParser, io });
    expect(result).toEqual({ text: '', lines: [0, 1] });
  });

  test('records the missing brace on the last existing line', async () => {
    const result = await basicLint({ fname: 'missing.js', code: 'function ok() {\n  return 1;\n', loadParser, io });
    expect(result).toEqual({ text: '', lines: [1] });
  });

  test('returns nothing for a clean file', async () => {
    const result = await basicLint({ fname: 'clean.js', code: 'function ok() {\n  return 1;\n}\n', loadParser, io });
    expect(result).toBe(undefined);
  });

  test('returns nothing for typescript on purpose', async () => {
    const result = await basicLint({ fname: 'app.ts', code: 'function broken( {\n', loadParser, io });
    expect(result).toBe(undefined);
  });

  test('returns nothing for a tsx file as well', async () => {
    const result = await basicLint({ fname: 'app.tsx', code: 'function broken( {\n', loadParser, io });
    expect(result).toBe(undefined);
  });

  test('returns nothing for unknown extensions', async () => {
    const result = await basicLint({ fname: 'notes.txt', code: 'def broken(\n', loadParser, io });
    expect(result).toBe(undefined);
  });

  test('reports an unloadable parser and skips the check', async () => {
    const errors: string[] = [];
    const result = await basicLint({
      fname: 'check.py',
      code: 'a: [',
      loadParser: async () => {
        throw new Error('no such grammar');
      },
      io: { error: (message) => errors.push(message) },
    });
    expect(result).toBeUndefined();
    expect(errors[0]).toContain('Unable to load parser');
  });
});
