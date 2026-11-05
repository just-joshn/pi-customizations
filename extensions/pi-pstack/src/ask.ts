import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';
import { childIdentity } from './child-env.ts';
import { canAsk } from './modes.ts';

export const DONE_LABEL = '✓ Done selecting';
// Every question ends with a typed-answer option.
export const OTHER_LABEL = 'Other: (type to answer)';
export const OTHER_ID = 'other';
// Cursor CLI's reject reasons: src/headless.ts for a run with nobody to answer, the local subagent runner for a subagent.
const SKIPPED = 'Questions skipped by the user, continue with the information you already have';
const SUBAGENT_SKIPPED = 'Subagent cannot ask questions';

export const AskParams = Type.Object({
  title: Type.Optional(Type.String({ description: 'Optional title for the questions form' })),
  questions: Type.Array(
    Type.Object({
      id: Type.String({ description: 'Unique identifier for this question' }),
      prompt: Type.String({ description: 'The question text to display to the user, without the options.' }),
      options: Type.Array(
        Type.Object({
          id: Type.String({ description: 'Unique identifier for this option' }),
          label: Type.String({ description: 'Display text for this option' }),
        }),
        { minItems: 2, description: 'Array of answer options (minimum 2 required)' },
      ),
      allow_multiple: Type.Optional(Type.Boolean({ description: 'If true, user can select multiple options. Defaults to false.' })),
    }),
    { minItems: 1, description: 'Array of questions to present to the user (minimum 1 required)' },
  ),
});
export type Question = Static<typeof AskParams>['questions'][number];

function duplicate(values: readonly string[]): string | undefined {
  return values.find((value, index) => values.indexOf(value) !== index);
}

/** Answers map back to options by their labels, so labels and ids must be unique, and the sentinels are reserved. */
export function validateQuestions(questions: readonly Question[]): void {
  const repeatedId = duplicate(questions.map((question) => question.id));
  if (repeatedId !== undefined) throw new Error(`Question id "${repeatedId}" appears more than once.`);
  for (const question of questions) {
    if (question.options.length === 0) throw new Error(`Question "${question.id}" has no options.`);
    const label = duplicate(question.options.map((option) => option.label));
    if (label !== undefined) throw new Error(`Question "${question.id}" has two options labelled "${label}".`);
    const id = duplicate(question.options.map((option) => option.id));
    if (id !== undefined) throw new Error(`Question "${question.id}" has two options with id "${id}".`);
    if (question.allow_multiple === true && question.options.some((option) => option.label === DONE_LABEL)) throw new Error(`Option label "${DONE_LABEL}" is reserved for ending a multi-select question.`);
    if (question.options.some((option) => option.label === OTHER_LABEL || option.id === OTHER_ID)) throw new Error(`Option label "${OTHER_LABEL}" and id "${OTHER_ID}" are reserved for the typed answer.`);
  }
}

interface Answer {
  ids: string[];
  other?: string;
}

/** The typed answer behind Other; an empty or dismissed input is no answer. */
async function typedAnswer(prompt: string, ctx: ExtensionContext): Promise<string | undefined> {
  const text = (await ctx.ui.input(prompt))?.trim();
  return text === undefined || text === '' ? undefined : text;
}

async function askOne(question: Question, ctx: ExtensionContext, title: string | undefined): Promise<Answer | undefined> {
  const labelToId = new Map(question.options.map((option) => [option.label, option.id]));
  const prompt = title === undefined || title === '' ? question.prompt : `${title}: ${question.prompt}`;
  if (question.allow_multiple !== true) {
    const label = await ctx.ui.select(prompt, [...question.options.map((option) => option.label), OTHER_LABEL]);
    if (label === OTHER_LABEL) {
      const other = await typedAnswer(prompt, ctx);
      return other === undefined ? undefined : { ids: [OTHER_ID], other };
    }
    const id = label === undefined ? undefined : labelToId.get(label);
    return id === undefined ? undefined : { ids: [id] };
  }
  const picked: string[] = [];
  let other: string | undefined;
  const result = (): Answer => (other === undefined ? { ids: picked } : { ids: [...picked, OTHER_ID], other });
  for (;;) {
    const remaining = [...question.options.filter((option) => !picked.includes(option.id)).map((option) => option.label), ...(other === undefined ? [OTHER_LABEL] : [])];
    const heading =
      picked.length === 0 && other === undefined
        ? `${prompt} (pick one at a time, then ${DONE_LABEL})`
        : `${prompt} (picked: ${[...picked.map((id) => question.options.find((option) => option.id === id)?.label), ...(other === undefined ? [] : [`"${other}"`])].join(', ')})`;
    const label = await ctx.ui.select(heading, [...remaining, DONE_LABEL]);
    if (label === undefined) return picked.length === 0 && other === undefined ? undefined : result();
    if (label === OTHER_LABEL) {
      other = await typedAnswer(prompt, ctx);
      continue;
    }
    const id = labelToId.get(label);
    if (label === DONE_LABEL || id === undefined) return result();
    picked.push(id);
  }
}

function answerLine(question: Question, answer: Answer | undefined): string {
  if (answer === undefined) return `${question.id}: no answer (the user dismissed the question)`;
  const parts = answer.ids.map((id) => (id === OTHER_ID ? `other ("${answer.other}")` : `${id} (${question.options.find((option) => option.id === id)?.label ?? id})`));
  return `${question.id}: ${parts.length === 0 ? 'none selected' : parts.join(', ')}`;
}

/** Structured questions (pstack: "Prefer AskQuestion over free text"), over Pi's select dialog. */
export function registerAskQuestion(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'AskQuestion',
    label: 'Ask question',
    // Cursor desktop 3.27.22's AskQuestion description.
    description: [
      "Collect structured multiple-choice answers from the user. Use this tool only when you are blocked on a decision that is genuinely the user's to make: one you cannot resolve from the request, the code, or sensible defaults.",
      '',
      'Usage notes:',
      '- Each question should have at least 2 options for the user to choose from',
      '- Users will always be able to select "Other" to provide custom text input',
      '- Use allow_multiple: true to allow multiple answers to be selected for a question',
      '- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label',
      '',
      'Prefer this tool over listing options in your final response text (as letters, numbers, bullet points, etc).',
    ].join('\n'),
    promptSnippet: 'Structured multiple-choice questions for the user',
    parameters: AskParams,
    exposure: 'model-only',
    executionMode: 'sequential',
    // Cursor's subagents have no AskQuestion: their owner, not a person, reads what they produce.
    defaultActive: childIdentity.depth === 0,
    annotations: { readOnlyHint: true, openWorldHint: false },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      validateQuestions(params.questions);
      // Print and JSON runs and subagents have no one to answer, so the questions come back skipped.
      if (!canAsk(ctx)) {
        const text = childIdentity.depth > 0 ? SUBAGENT_SKIPPED : SKIPPED;
        return { content: [{ type: 'text', text }], details: { answers: {}, skipped: params.questions.map((question) => question.id) } };
      }
      const answers: Record<string, string[]> = {};
      const other: Record<string, string> = {};
      const lines: string[] = [];
      for (const question of params.questions) {
        const answer = await askOne(question, ctx, params.title);
        if (answer !== undefined) answers[question.id] = answer.ids;
        if (answer?.other !== undefined) other[question.id] = answer.other;
        lines.push(answerLine(question, answer));
      }
      return { content: [{ type: 'text', text: lines.join('\n') }], details: Object.keys(other).length === 0 ? { answers } : { answers, other } };
    },
  });
}
