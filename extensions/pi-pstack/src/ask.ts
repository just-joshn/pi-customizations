import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';

export const DONE_LABEL = '✓ Done selecting';
// Cursor's question dialog ends every question with a typed answer (observed in cursor-agent 2026.10.01).
export const OTHER_LABEL = 'Other: (type to answer)';
export const OTHER_ID = 'other';
const SKIPPED = 'skipped (no one can answer questions in this session; decide yourself and say what you chose)';

export const AskParams = Type.Object({
  title: Type.Optional(Type.String({ description: 'Short heading shown above the questions' })),
  questions: Type.Array(
    Type.Object({
      id: Type.String({ description: 'Stable identifier for the question' }),
      prompt: Type.String({ description: 'The question shown to the user' }),
      options: Type.Array(Type.Object({ id: Type.String(), label: Type.String(), description: Type.Optional(Type.String({ description: 'Detail shown after the label' })) }), {
        description: 'Choices the user picks from',
      }),
      allow_multiple: Type.Optional(Type.Boolean({ description: 'Let the user pick several options' })),
    }),
    { description: 'Questions asked one after another' },
  ),
});
export type Question = Static<typeof AskParams>['questions'][number];
type Option = Question['options'][number];

/** What the user sees for an option: its label, then its description when it has one. */
const shown = (option: Option): string => (option.description === undefined || option.description === '' ? option.label : `${option.label} — ${option.description}`);

function duplicate(values: readonly string[]): string | undefined {
  return values.find((value, index) => values.indexOf(value) !== index);
}

/** Answers map back to options by their shown text, so that text and ids must be unique, and the sentinels are reserved. */
export function validateQuestions(questions: readonly Question[]): void {
  const repeatedId = duplicate(questions.map((question) => question.id));
  if (repeatedId !== undefined) throw new Error(`Question id "${repeatedId}" appears more than once.`);
  for (const question of questions) {
    if (question.options.length === 0) throw new Error(`Question "${question.id}" has no options.`);
    const label = duplicate(question.options.map(shown));
    if (label !== undefined) throw new Error(`Question "${question.id}" has two options labelled "${label}".`);
    const id = duplicate(question.options.map((option) => option.id));
    if (id !== undefined) throw new Error(`Question "${question.id}" has two options with id "${id}".`);
    if (question.allow_multiple === true && question.options.some((option) => shown(option) === DONE_LABEL)) throw new Error(`Option label "${DONE_LABEL}" is reserved for ending a multi-select question.`);
    if (question.options.some((option) => shown(option) === OTHER_LABEL || option.id === OTHER_ID)) throw new Error(`Option label "${OTHER_LABEL}" and id "${OTHER_ID}" are reserved for the typed answer.`);
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
  const labelToId = new Map(question.options.map((option) => [shown(option), option.id]));
  const prompt = title === undefined || title === '' ? question.prompt : `${title}: ${question.prompt}`;
  if (question.allow_multiple !== true) {
    const label = await ctx.ui.select(prompt, [...question.options.map(shown), OTHER_LABEL]);
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
    const remaining = [...question.options.filter((option) => !picked.includes(option.id)).map(shown), ...(other === undefined ? [OTHER_LABEL] : [])];
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

/** Cursor's IDE question tool (pstack: "Prefer AskQuestion over free text"), over Pi's select dialog. */
export function registerAskQuestion(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'AskQuestion',
    label: 'Ask question',
    description:
      'Ask the user one or more structured multiple-choice questions and wait for the answers. Each answer comes back as option IDs, or as other with the text the user typed. Use it for a genuine product or preference choice, not for a fact you can check yourself.',
    promptSnippet: 'Structured multiple-choice questions for the user',
    parameters: AskParams,
    exposure: 'model-only',
    executionMode: 'sequential',
    annotations: { readOnlyHint: true, openWorldHint: false },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      validateQuestions(params.questions);
      // Cursor's print mode keeps the tool and reports the questions as skipped; Pi's print and JSON runs, including
      // subagents, have no one to answer either.
      if (!ctx.hasUI) {
        const text = params.questions.map((question) => `${question.id}: ${SKIPPED}`).join('\n');
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
