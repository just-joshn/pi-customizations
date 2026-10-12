import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';

export const DONE_LABEL = '✓ Done selecting';

const AskParams = Type.Object({
  questions: Type.Array(
    Type.Object({
      id: Type.String({ description: 'Stable identifier for the question' }),
      prompt: Type.String({ description: 'The question shown to the user' }),
      options: Type.Array(Type.Object({ id: Type.String(), label: Type.String() }), { description: 'Choices the user picks from' }),
      allow_multiple: Type.Optional(Type.Boolean({ description: 'Let the user pick several options' })),
    }),
    { description: 'Questions asked one after another' },
  ),
});
export type Question = Static<typeof AskParams>['questions'][number];

function duplicate(values: readonly string[]): string | undefined {
  return values.find((value, index) => values.indexOf(value) !== index);
}

/** Answers map back to options by label, so labels and ids must be unique, and the multi-select sentinel is reserved. */
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
  }
}

async function askOne(question: Question, ctx: ExtensionContext): Promise<string[] | undefined> {
  const labelToId = new Map(question.options.map((option) => [option.label, option.id]));
  if (question.allow_multiple !== true) {
    const label = await ctx.ui.select(
      question.prompt,
      question.options.map((option) => option.label),
    );
    const id = label === undefined ? undefined : labelToId.get(label);
    return id === undefined ? undefined : [id];
  }
  const picked: string[] = [];
  for (;;) {
    const remaining = question.options.filter((option) => !picked.includes(option.id)).map((option) => option.label);
    const title = picked.length === 0 ? `${question.prompt} (pick one at a time, then ${DONE_LABEL})` : `${question.prompt} (picked: ${picked.map((id) => question.options.find((option) => option.id === id)?.label).join(', ')})`;
    const label = await ctx.ui.select(title, [...remaining, DONE_LABEL]);
    if (label === undefined) return picked.length === 0 ? undefined : picked;
    const id = labelToId.get(label);
    if (label === DONE_LABEL || id === undefined) return picked;
    picked.push(id);
  }
}

function answerLine(question: Question, ids: readonly string[] | undefined): string {
  if (ids === undefined) return `${question.id}: no answer (the user dismissed the question)`;
  const parts = ids.map((id) => `${id} (${question.options.find((option) => option.id === id)?.label ?? id})`);
  return `${question.id}: ${parts.length === 0 ? 'none selected' : parts.join(', ')}`;
}

/** Cursor's IDE question tool (pstack: "Prefer AskQuestion over free text"), over Pi's select dialog. */
export function registerAskQuestion(pi: ExtensionAPI): void {
  // Print and JSON runs, including subagents, have no one to answer, so the tool is withdrawn there like Cursor's CLI lacks it.
  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI) pi.setActiveTools(pi.getActiveTools().filter((name) => name !== 'AskQuestion'));
  });
  pi.registerTool({
    name: 'AskQuestion',
    label: 'Ask question',
    description: 'Ask the user one or more structured multiple-choice questions and wait for the answers. Each answer comes back as option IDs. Use it for a genuine product or preference choice, not for a fact you can check yourself.',
    promptSnippet: 'Structured multiple-choice questions for the user',
    parameters: AskParams,
    exposure: 'model-only',
    executionMode: 'sequential',
    annotations: { readOnlyHint: true, openWorldHint: false },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      validateQuestions(params.questions);
      if (!ctx.hasUI) throw new Error('AskQuestion needs an interactive user, and this session has none. Ask the question in your reply instead.');
      const answers: Record<string, string[]> = {};
      const lines: string[] = [];
      for (const question of params.questions) {
        const ids = await askOne(question, ctx);
        if (ids !== undefined) answers[question.id] = ids;
        lines.push(answerLine(question, ids));
      }
      return { content: [{ type: 'text', text: lines.join('\n') }], details: { answers } };
    },
  });
}
