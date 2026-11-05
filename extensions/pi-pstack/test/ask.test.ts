import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Static } from 'typebox';
import { Value } from 'typebox/value';
import { describe, expect, test } from 'vitest';
import { AskParams, DONE_LABEL, validateQuestions } from '../src/ask.ts';
import { cursorToolText } from './cursor-reference.ts';

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
    { name: 'the reserved other id', questions: [question([{ id: 'other', label: 'Something else' }])], expected: 'Option label "Other: (type to answer)" and id "other" are reserved for the typed answer.' },
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

describe('Cursor AskQuestion calls (HOST-005)', () => {
  // 24 AskQuestion inputs the Cursor IDE produced, read from its agent transcripts.
  const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/cursor-askquestion-calls.json'), 'utf8')) as { calls: { input: Static<typeof AskParams> }[] };
  const questionSchema = AskParams.properties.questions.items;
  const optionSchema = questionSchema.properties.options.items;

  test('the port declares the fields Cursor desktop declares, so an option description models send is not one of them', () => {
    const declared = [...Object.keys(AskParams.properties), ...Object.keys(questionSchema.properties).map((key) => `questions.${key}`), ...Object.keys(optionSchema.properties).map((key) => `questions.options.${key}`)];
    expect(declared.toSorted()).toEqual(Object.keys(cursorToolText.tools['AskQuestion']?.parameters ?? {}).toSorted());
    expect(fixture.calls.length).toBe(24);
  });

  test('every Cursor call is valid input for the port', () => {
    expect(fixture.calls.filter(({ input }) => !Value.Check(AskParams, input))).toEqual([]);
    expect(fixture.calls.map(({ input }) => outcome(input.questions as ReturnType<typeof question>[]))).toEqual(fixture.calls.map(() => 'valid'));
  });
});

test('AskQuestion requires at least one question and two options per question, as Cursor does', () => {
  const schema = JSON.parse(JSON.stringify(AskParams)) as { properties: { questions: { minItems: number; items: { properties: { options: { minItems: number } } } } } };
  expect([schema.properties.questions.minItems, schema.properties.questions.items.properties.options.minItems]).toEqual([1, 2]);
});
