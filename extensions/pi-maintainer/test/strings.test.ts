import { describe, expect, test } from 'vitest';
import { parseLintCmds } from '../src/parse-lint-cmds.ts';
import { addedOutputMessage, addOutputQuestion, FIX_LINT_QUESTION, FIX_TEST_QUESTION, fixFileQuestion, formatRunOutput, LINT_HEADER, RUN_OUTPUT_TEMPLATE, RUN_PLACEHOLDER, reflectionCapWarning } from '../src/strings.ts';

describe('exact message strings', () => {
  test('the lint header matches the recorded text', () => {
    expect(LINT_HEADER).toBe('# Fix any errors below, if possible.\n\n');
  });

  test('both repair questions match the recorded text', () => {
    expect(FIX_LINT_QUESTION).toBe('Attempt to fix lint errors?');
    expect(FIX_TEST_QUESTION).toBe('Attempt to fix test errors?');
  });

  test('the per-file question names the file', () => {
    expect(fixFileQuestion('/repo/src/broken.py')).toBe('Fix lint errors in /repo/src/broken.py?');
  });

  test('the reflection cap warning names the cap', () => {
    expect(reflectionCapWarning(3)).toBe('Only 3 reflections allowed, stopping.');
  });

  test('the run-output template matches the recorded text', () => {
    expect(RUN_OUTPUT_TEMPLATE).toBe('I ran this command:\n\n{command}\n\nAnd got this output:\n\n{output}\n');
    expect(formatRunOutput('ls', 'out\n')).toBe('I ran this command:\n\nls\n\nAnd got this output:\n\nout\n\n');
  });

  test('the run placeholder matches the recorded text', () => {
    expect(RUN_PLACEHOLDER).toBe("What's wrong? Fix");
  });

  test('the added-output line counts lines', () => {
    expect(addedOutputMessage(1)).toBe('Added 1 line of output to the chat.');
    expect(addedOutputMessage(7)).toBe('Added 7 lines of output to the chat.');
  });

  test('the add-output question names the token estimate', () => {
    expect(addOutputQuestion('1.2')).toBe('Add 1.2k tokens of command output to the chat?');
  });

  test('the parse failure lines match the recorded text and channels', () => {
    expect(parseLintCmds(['rust:']).messages).toEqual([
      { channel: 'error', text: 'Unable to parse --lint-cmd "rust:"' },
      { channel: 'output', text: 'The arg should be "language: cmd --args ..."' },
      { channel: 'output', text: 'For example: --lint-cmd "python: flake8 --select=E9"' },
    ]);
  });
});
