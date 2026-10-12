import { describe, expect, test } from 'vitest';
import { DONE_LABEL, validateQuestions } from '../src/ask.ts';

const question = (options: { id: string; label: string }[], allow_multiple?: boolean) => ({ id: 'q', prompt: 'Pick', options, ...(allow_multiple === undefined ? {} : { allow_multiple }) });
const outcome = (questions: ReturnType<typeof question>[]) => {
  try {
    validateQuestions(questions);
    return 'valid';
  } catch (error) {
    return (error as Error).message;
  }
};

describe('validateQuestions (HOST-005; reviews: parity, security 6, architecture 4)', () => {
  test.for([
    {
      name: 'duplicate labels',
      questions: [
        question([
          { id: 'a', label: 'Same' },
          { id: 'b', label: 'Same' },
        ]),
      ],
      expected: 'Question "q" has two options labelled "Same".',
    },
    {
      name: 'duplicate option ids',
      questions: [
        question([
          { id: 'a', label: 'A' },
          { id: 'a', label: 'B' },
        ]),
      ],
      expected: 'Question "q" has two options with id "a".',
    },
    { name: 'no options', questions: [question([])], expected: 'Question "q" has no options.' },
    { name: 'the reserved done label', questions: [question([{ id: 'd', label: DONE_LABEL }], true)], expected: `Option label "${DONE_LABEL}" is reserved for ending a multi-select question.` },
    {
      name: 'a well-formed question',
      questions: [
        question(
          [
            { id: 'a', label: 'Done' },
            { id: 'b', label: 'B' },
          ],
          true,
        ),
      ],
      expected: 'valid',
    },
  ])('$name', ({ questions, expected }) => {
    expect(outcome(questions)).toBe(expected);
  });
});
