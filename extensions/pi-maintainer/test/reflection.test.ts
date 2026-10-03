import { describe, expect, test } from 'vitest';
import { type PostEditConfig, type PostEditIo, planPostEditRepair } from '../src/reflection.ts';
import { INITIAL_MESSAGE_STATE, MAX_REFLECTIONS, type MessageRepairState } from '../src/types.ts';

function makeState(numReflections: number): MessageRepairState {
  return { ...INITIAL_MESSAGE_STATE, numReflections };
}

const config: PostEditConfig = { autoLint: true, autoTest: false, testCmd: undefined, maxReflections: MAX_REFLECTIONS, editFailed: false };

interface IoSpans {
  readonly warnings: string[];
  readonly confirms: string[];
  readonly lintCalls: string[][];
  readonly testCommands: string[];
}

function makeIo(spans: IoSpans, lintErrors: string | undefined, answers: boolean[], testFails: boolean): PostEditIo {
  return {
    lintEdited: async (paths) => {
      spans.lintCalls.push([...paths]);
      return lintErrors;
    },
    runTest: async (cmd) => {
      spans.testCommands.push(cmd);
      return testFails ? { failed: true, formattedMessage: `I ran this command:\n\n${cmd}\n\nAnd got this output:\n\nFAIL\n` } : { failed: false, formattedMessage: undefined };
    },
    confirm: async (question) => {
      spans.confirms.push(question);
      return answers.shift() ?? false;
    },
    warning: (message) => spans.warnings.push(message),
  };
}

describe('planPostEditRepair', () => {
  test('returns an empty plan when no files were edited', async () => {
    const spans: IoSpans = { warnings: [], confirms: [], lintCalls: [], testCommands: [] };
    const plan = await planPostEditRepair(makeState(0), config, [], makeIo(spans, 'errors', [], false));
    expect(plan).toEqual({ entries: [], reflection: undefined, lintOutcome: undefined, testOutcome: undefined });
    expect(spans.lintCalls).toHaveLength(0);
  });

  test('reflects accepted lint failures and skips the test step', async () => {
    const spans: IoSpans = { warnings: [], confirms: [], lintCalls: [], testCommands: [] };
    const plan = await planPostEditRepair(makeState(0), { ...config, autoTest: true, testCmd: 'pytest' }, ['src.py'], makeIo(spans, '# Fix any errors below, if possible.\n\nboom\n', [true], false));
    expect(plan.reflection).toBe('# Fix any errors below, if possible.\n\nboom\n');
    expect(plan.entries.map((entry) => entry.customType)).toEqual(['maintainer-reflection']);
    expect(spans.testCommands).toHaveLength(0);
    expect(spans.confirms).toEqual(['Attempt to fix lint errors?']);
  });

  test('falls through to the test step when the lint repair is declined', async () => {
    const spans: IoSpans = { warnings: [], confirms: [], lintCalls: [], testCommands: [] };
    await planPostEditRepair(makeState(0), { ...config, autoTest: true, testCmd: 'pytest' }, ['src.py'], makeIo(spans, 'lint errors', [false], true));
    expect(spans.testCommands).toEqual(['pytest']);
    expect(spans.confirms).toEqual(['Attempt to fix lint errors?', 'Attempt to fix test errors?']);
  });

  test('appends the test output before asking, and reflects on acceptance', async () => {
    const spans: IoSpans = { warnings: [], confirms: [], lintCalls: [], testCommands: [] };
    const plan = await planPostEditRepair(makeState(0), { ...config, autoTest: true, testCmd: 'pytest' }, ['src.py'], makeIo(spans, undefined, [true], true));
    expect(plan.entries.map((entry) => entry.customType)).toEqual(['maintainer-command-output', 'maintainer-reflection']);
    expect(plan.entries[0]?.content).toContain('I ran this command:');
    expect(plan.reflection).toContain('FAIL');
  });

  test('keeps the failing test output in the conversation without a reflection on decline', async () => {
    const spans: IoSpans = { warnings: [], confirms: [], lintCalls: [], testCommands: [] };
    const plan = await planPostEditRepair(makeState(0), { ...config, autoTest: true, testCmd: 'pytest' }, ['src.py'], makeIo(spans, undefined, [false], true));
    expect(plan.entries.map((entry) => entry.customType)).toEqual(['maintainer-command-output']);
    expect(plan.reflection).toBeUndefined();
  });

  test('adds nothing when the test command passes', async () => {
    const spans: IoSpans = { warnings: [], confirms: [], lintCalls: [], testCommands: [] };
    const plan = await planPostEditRepair(makeState(0), { ...config, autoTest: true, testCmd: 'pytest' }, ['src.py'], makeIo(spans, undefined, [], false));
    expect(plan).toEqual({ entries: [], reflection: undefined, lintOutcome: true, testOutcome: true });
    expect(spans.confirms).toHaveLength(0);
  });

  test('reports the test outcome without running anything when no command is set', async () => {
    const spans: IoSpans = { warnings: [], confirms: [], lintCalls: [], testCommands: [] };
    const plan = await planPostEditRepair(makeState(0), { ...config, autoTest: true, testCmd: undefined }, ['src.py'], makeIo(spans, undefined, [], false));
    expect(plan.testOutcome).toBe(true);
    expect(spans.testCommands).toHaveLength(0);
  });

  test('drops the fourth failure with the reflection cap warning after acceptance', async () => {
    const spans: IoSpans = { warnings: [], confirms: [], lintCalls: [], testCommands: [] };
    const state = makeState(MAX_REFLECTIONS);
    const plan = await planPostEditRepair(state, config, ['src.py'], makeIo(spans, 'lint-error-4', [true], false));
    expect(plan.reflection).toBeUndefined();
    expect(plan.entries).toHaveLength(0);
    expect(spans.warnings).toEqual(['Only 3 reflections allowed, stopping.']);
  });

  test('reflects the first three failures and stops before the fourth', async () => {
    const walks = [0, 1, 2, 3].map((numReflections) => {
      const spans: IoSpans = { warnings: [], confirms: [], lintCalls: [], testCommands: [] };
      return planPostEditRepair(makeState(numReflections), config, ['src.py'], makeIo(spans, `lint-error-${numReflections + 1}`, [true], false));
    });
    const plans = await Promise.all(walks);
    expect(plans.map((plan) => plan.reflection)).toEqual(['lint-error-1', 'lint-error-2', 'lint-error-3', undefined]);
  });

  test('returns an empty plan when the turn produced a failed edit tool call', async () => {
    const spans: IoSpans = { warnings: [], confirms: [], lintCalls: [], testCommands: [] };
    const plan = await planPostEditRepair(makeState(0), { ...config, autoTest: true, testCmd: 'pytest', editFailed: true }, ['src.py'], makeIo(spans, 'lint errors', [true], true));
    expect(plan).toEqual({ entries: [], reflection: undefined, lintOutcome: undefined, testOutcome: undefined });
    expect(spans.lintCalls).toHaveLength(0);
    expect(spans.testCommands).toHaveLength(0);
    expect(spans.confirms).toHaveLength(0);
  });

  test('does nothing when linting is disabled', async () => {
    const spans: IoSpans = { warnings: [], confirms: [], lintCalls: [], testCommands: [] };
    const plan = await planPostEditRepair(makeState(0), { autoLint: false, autoTest: false, testCmd: undefined, maxReflections: MAX_REFLECTIONS, editFailed: false }, ['src.py'], makeIo(spans, 'unused', [true], false));
    expect(plan).toEqual({ entries: [], reflection: undefined, lintOutcome: undefined, testOutcome: undefined });
    expect(spans.lintCalls).toHaveLength(0);
  });
});
