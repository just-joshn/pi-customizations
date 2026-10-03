import { describe, expect, test } from 'vitest';
import { cmdRun, estimateTokens } from '../src/test-run.ts';

function makeIo(exitStatus: number, output: string, answers: boolean[]) {
  const written: string[] = [];
  const questions: string[] = [];
  const io = {
    output: (message: string) => written.push(message),
    confirm: async (question: string) => {
      questions.push(question);
      return answers.shift() ?? false;
    },
    runShell: async (command: string) => {
      expect(typeof command).toBe('string');
      return [exitStatus, output] as const;
    },
  };
  return { io, written, questions };
}

describe('cmdRun', () => {
  test('adds and returns the formatted output for a failing test command', async () => {
    const { io, written, questions } = makeIo(1, 'FAILED test_x\n', []);
    const result = await cmdRun(io, "echo 'FAILED test_x'; exit 1", true);
    expect(result.returnedMessage).toBe("I ran this command:\n\necho 'FAILED test_x'; exit 1\n\nAnd got this output:\n\nFAILED test_x\n\n");
    expect(result.formattedMessage).toBe(result.returnedMessage);
    expect(result.placeholder).toBe(false);
    expect(questions).toHaveLength(0);
    expect(written).toEqual(['Added 1 line of output to the chat.']);
  });

  test('adds nothing for a passing test command', async () => {
    const { io, written } = makeIo(0, 'all green\n', []);
    const result = await cmdRun(io, 'pytest', true);
    expect(result.formattedMessage).toBeUndefined();
    expect(result.returnedMessage).toBeUndefined();
    expect(written).toHaveLength(0);
  });

  test('asks before adding plain run output and names the token estimate', async () => {
    const { io, written, questions } = makeIo(0, 'out\n', [true]);
    await cmdRun(io, 'ls', false);
    expect(questions).toEqual(['Add 0.0k tokens of command output to the chat?']);
    expect(written).toEqual(['Added 1 line of output to the chat.']);
  });

  test('sets the placeholder for a failing plain run whose output was added', async () => {
    const { io } = makeIo(2, 'boom\n', [true]);
    const result = await cmdRun(io, 'false', false);
    expect(result.placeholder).toBe(true);
    expect(result.returnedMessage).toBeUndefined();
    expect(result.formattedMessage).toContain('boom');
  });

  test('adds nothing when the user declines', async () => {
    const { io, written } = makeIo(0, 'out\n', [false]);
    const result = await cmdRun(io, 'ls', false);
    expect(result.formattedMessage).toBeUndefined();
    expect(result.placeholder).toBe(false);
    expect(written).toHaveLength(0);
  });

  test('counts several output lines for the added message', async () => {
    const { io, written } = makeIo(1, 'one\ntwo\nthree\n', []);
    await cmdRun(io, 'fail', true);
    expect(written).toEqual(['Added 3 lines of output to the chat.']);
  });

  test('counts zero lines for whitespace-only output', async () => {
    const { io, written } = makeIo(1, '  \n \n', []);
    await cmdRun(io, 'fail', true);
    expect(written).toEqual(['Added 0 lines of output to the chat.']);
  });
});

describe('estimateTokens', () => {
  test('approximates four characters per token', () => {
    expect(estimateTokens('12345678')).toBe(2);
    expect(estimateTokens('x')).toBe(1);
    expect(estimateTokens('')).toBe(0);
  });
});
