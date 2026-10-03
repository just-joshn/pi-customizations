import { describe, expect, test } from 'vitest';
import { parseLintCmds } from '../src/parse-lint-cmds.ts';

describe('parseLintCmds', () => {
  test('splits a lowercase language prefix into a per-language command', () => {
    const result = parseLintCmds(['python: flake8 --select=E9']);
    expect(result.messages).toEqual([]);
    expect(result.commands?.byLanguage.get('python')).toBe('flake8 --select=E9');
    expect(result.commands?.global).toBeUndefined();
  });

  test('keeps a capitalised prefix inside the global command', () => {
    const result = parseLintCmds(['Python: flake8']);
    expect(result.commands?.global).toBe('Python: flake8');
    expect(result.commands?.byLanguage.size).toBe(0);
  });

  test('treats a command without a prefix as the global command', () => {
    const result = parseLintCmds(['eslint --fix']);
    expect(result.commands?.global).toBe('eslint --fix');
  });

  test('treats a language with symbols as a global command', () => {
    const result = parseLintCmds(['c++: cppcheck']);
    expect(result.commands?.global).toBe('c++: cppcheck');
  });

  test('fails the whole parse with the three guidance lines on their channels', () => {
    const result = parseLintCmds(['rust:']);
    expect(result.commands).toBeUndefined();
    expect(result.messages).toEqual([
      { channel: 'error', text: 'Unable to parse --lint-cmd "rust:"' },
      { channel: 'output', text: 'The arg should be "language: cmd --args ..."' },
      { channel: 'output', text: 'For example: --lint-cmd "python: flake8 --select=E9"' },
    ]);
  });

  test('parses several newline separated entries in order', () => {
    const result = parseLintCmds(['python: flake8', 'js: eslint', 'global-lint']);
    expect(result.commands?.byLanguage.get('python')).toBe('flake8');
    expect(result.commands?.byLanguage.get('js')).toBe('eslint');
    expect(result.commands?.global).toBe('global-lint');
  });

  test('keeps the command-line order in the entry list', () => {
    const prefixedFirst = parseLintCmds(['python: x', 'y']);
    expect(prefixedFirst.commands?.entries).toEqual([
      { lang: 'python', cmd: 'x' },
      { lang: undefined, cmd: 'y' },
    ]);
    const globalFirst = parseLintCmds(['y', 'python: x']);
    expect(globalFirst.commands?.entries).toEqual([
      { lang: undefined, cmd: 'y' },
      { lang: 'python', cmd: 'x' },
    ]);
  });

  test('a repeated language keeps one prompt entry with the last command', () => {
    const result = parseLintCmds(['go: first', 'go: second']);
    expect(result.commands?.byLanguage.get('go')).toBe('second');
    expect(result.commands?.entries).toEqual([{ lang: 'go', cmd: 'second' }]);
  });

  test('keeps colons inside the command text', () => {
    const result = parseLintCmds(['python: flake8:minus:style']);
    expect(result.commands?.byLanguage.get('python')).toBe('flake8:minus:style');
  });
});
