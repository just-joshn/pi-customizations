import { describe, expect, test } from 'vitest';
import { type ConfirmUi, makeConfirm } from '../src/confirm.ts';

interface UiSpans {
  readonly ui: ConfirmUi;
  readonly questions: string[];
  readonly details: string[];
}

function makeUi(hasUI: boolean, answer: boolean): UiSpans {
  const questions: string[] = [];
  const details: string[] = [];
  return {
    questions,
    details,
    ui: {
      hasUI,
      confirm: async (question, detail) => {
        questions.push(question);
        details.push(detail);
        return answer;
      },
    },
  };
}

describe('makeConfirm', () => {
  test('answers yes without prompting when auto-yes is set and a UI exists', async () => {
    const spans = makeUi(true, false);
    const confirm = makeConfirm(spans.ui, true);
    expect(await confirm('Attempt to fix lint errors?')).toBe(true);
    expect(spans.questions).toHaveLength(0);
  });

  test('answers yes without a UI when auto-yes is set', async () => {
    const spans = makeUi(false, false);
    const confirm = makeConfirm(spans.ui, true);
    expect(await confirm('Attempt to fix lint errors?')).toBe(true);
    expect(spans.questions).toHaveLength(0);
  });

  test('delegates to the UI when auto-yes is off and a UI exists', async () => {
    const spans = makeUi(true, false);
    const confirm = makeConfirm(spans.ui, false);
    expect(await confirm('Fix lint errors in /repo/a.py?')).toBe(false);
    expect(spans.questions).toEqual(['Fix lint errors in /repo/a.py?']);
    expect(spans.details).toEqual(['']);
  });

  test('answers yes without a UI even when auto-yes is off', async () => {
    const spans = makeUi(false, false);
    const confirm = makeConfirm(spans.ui, false);
    expect(await confirm('Add 0.1k tokens of command output to the chat?')).toBe(true);
    expect(spans.questions).toHaveLength(0);
  });
});
