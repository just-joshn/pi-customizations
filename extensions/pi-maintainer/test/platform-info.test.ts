import { describe, expect, test } from 'vitest';
import { parseLintCmds } from '../src/parse-lint-cmds.ts';
import { lintTestPromptSection } from '../src/platform-info.ts';
import type { LintCommands } from '../src/types.ts';

function lintCommands(...entries: string[]): LintCommands {
  const parsed = parseLintCmds(entries);
  if (parsed.commands === undefined) throw new Error(`unparsable entries: ${entries.join(', ')}`);
  return parsed.commands;
}

describe('lintTestPromptSection', () => {
  test('announces automatic lint commands as pre-commit gates', () => {
    const section = lintTestPromptSection(lintCommands('python: flake8 --select=E9'), undefined, true, false);
    expect(section).toBe("- The user's pre-commit runs these lint commands, don't suggest running them:\n  - python: flake8 --select=E9\n");
  });

  test('announces lint commands as preferences when auto lint is off', () => {
    const section = lintTestPromptSection(lintCommands('js: eslint'), undefined, false, false);
    expect(section).toBe('- The user prefers these lint commands:\n  - js: eslint\n');
  });

  test('prints the language-less command without a language prefix', () => {
    const section = lintTestPromptSection(lintCommands('ruff check'), undefined, true, false);
    expect(section).toBe("- The user's pre-commit runs these lint commands, don't suggest running them:\n  - ruff check\n");
  });

  test('lists a prefixed entry before a language-less entry in command-line order', () => {
    const section = lintTestPromptSection(lintCommands('python: x', 'y'), undefined, true, false);
    expect(section).toBe("- The user's pre-commit runs these lint commands, don't suggest running them:\n  - python: x\n  - y\n");
  });

  test('lists a language-less entry before a prefixed entry in command-line order', () => {
    const section = lintTestPromptSection(lintCommands('y', 'python: x'), undefined, true, false);
    expect(section).toBe("- The user's pre-commit runs these lint commands, don't suggest running them:\n  - y\n  - python: x\n");
  });

  test('lists a repeated language once at its first position with its last command', () => {
    const section = lintTestPromptSection(lintCommands('python: first', 'y', 'python: second'), undefined, true, false);
    expect(section).toBe("- The user's pre-commit runs these lint commands, don't suggest running them:\n  - python: second\n  - y\n");
  });

  test('announces the automatic test command as a pre-commit gate', () => {
    const section = lintTestPromptSection(lintCommands(), 'pytest', true, true);
    expect(section).toBe("- The user's pre-commit runs this test command, don't suggest running them: pytest\n");
  });

  test('announces the test command as a preference when auto test is off', () => {
    const section = lintTestPromptSection(lintCommands(), 'pytest', true, false);
    expect(section).toBe('- The user prefers this test command: pytest\n');
  });

  test('returns nothing when no commands are configured', () => {
    const section = lintTestPromptSection(lintCommands(), undefined, true, false);
    expect(section).toBe(undefined);
  });
});
