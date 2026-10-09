import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Container } from '@earendil-works/pi-tui';
import { type Static, Type } from 'typebox';
import { boundedResult } from './results.ts';
import { type PanelAnswer, type PanelInput, initialPanelState, panelAnswers, reducePanel, renderPanel, toPanelInput } from './questions-panel.ts';
import { askQuestionResultCard } from './tool-cards.ts';

const text = Type.String({ minLength: 1, pattern: '\\S' });
const Question = Type.Object({
  id: text,
  prompt: text,
  options: Type.Optional(Type.Array(Type.Object({ id: text, label: text }))),
  allow_multiple: Type.Optional(Type.Boolean()),
});
type Question = Static<typeof Question>;
type Answer = { id: string; answers: string[]; cancelled: boolean };
const freeText = 'Enter a text answer';
const done = 'Done selecting';

const AnswerSchema = Type.Object({
  id: Type.String(),
  answers: Type.Array(Type.String()),
  cancelled: Type.Boolean(),
});
const AnswersOutput = Type.Array(AnswerSchema);

function validateQuestions(questions: Question[]): void {
  if (new Set(questions.map((question) => question.id)).size !== questions.length) {
    throw new Error('Question IDs must be unique.');
  }
  for (const question of questions) {
    const ids = question.options?.map((option) => option.id) ?? [];
    if (new Set(ids).size !== ids.length) throw new Error('Option IDs must be unique within each question.');
    const labels = question.options?.map((option) => `${option.label} [${option.id}]`) ?? [];
    if (new Set(labels).size !== labels.length) throw new Error('Option labels and IDs must produce distinct displayed choices.');
  }
}

async function ask(question: Question, ctx: ExtensionContext, signal: AbortSignal | undefined): Promise<Answer> {
  const options = signal ? { signal } : {};
  if (!question.options?.length) {
    const answer = await ctx.ui.input(question.prompt, undefined, options);
    return { id: question.id, answers: answer === undefined ? [] : [answer], cancelled: answer === undefined };
  }
  let choices = new Map(question.options.map((option) => [`${option.label} [${option.id}]`, option]));
  let answers: string[] = [];
  let shown: string[] = [];
  let freeTextUsed = false;
  while (true) {
    const labels = [...choices.keys(), ...(freeTextUsed ? [] : [freeText]), ...(question.allow_multiple ? [done] : [])];
    const title = shown.length ? `${question.prompt} (selected: ${shown.join(', ')})` : question.prompt;
    const selected = await ctx.ui.select(title, labels, options);
    if (selected === undefined) return { id: question.id, answers, cancelled: true };
    if (selected === done && question.allow_multiple) return { id: question.id, answers, cancelled: false };
    const answer = selected === freeText ? await ctx.ui.input(question.prompt, undefined, options) : choices.get(selected)?.id;
    if (answer === undefined) return { id: question.id, answers, cancelled: true };
    answers = [...answers, answer];
    shown = [...shown, choices.get(selected)?.label ?? answer];
    choices = new Map([...choices].filter(([label]) => label !== selected));
    if (selected === freeText) freeTextUsed = true;
    if (!question.allow_multiple) return { id: question.id, answers, cancelled: false };
  }
}

export function registerQuestions(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'AskQuestion',
    label: 'Ask question',
    executionMode: 'sequential',
    description: 'Ask the user a preference or required approval through an interactive dialog. Errors only when the session has no UI. Never infer consent from cancellation.',
    promptSnippet: 'Ask the user a preference or approval question through Pi dialogs',
    promptGuidelines: ['AskQuestion works in interactive and RPC sessions; in print mode it errors, so ask in conversation instead. Cancellation is not approval.'],
    parameters: Type.Object({ questions: Type.Array(Question, { minItems: 1, maxItems: 4 }), title: Type.Optional(Type.String({ minLength: 1, pattern: '\\S' })) }),
    outputSchema: AnswersOutput,
    exposure: 'model-only',
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    renderCall(_args, _theme, context) {
      const component = (context.lastComponent as Container | undefined) ?? new Container();
      component.clear();
      return component;
    },
    renderResult(result, _options, theme, context) {
      const component = (context.lastComponent as Container | undefined) ?? new Container();
      component.clear();
      component.addChild(askQuestionResultCard(context.args, (result.details ?? []) as readonly PanelAnswer[], theme));
      return component;
    },
    async execute(_id, params, signal, _update, ctx) {
      validateQuestions(params.questions);
      if (!ctx.hasUI || process.env['PI_PSTACK_HEADLESS']) throw new Error('AskQuestion requires Pi TUI or an RPC client supporting extension dialogs. Ask in the conversation and wait for a user reply.');
      let answers: Answer[] = [];
      if (ctx.mode === 'tui') {
        answers = [...(await askWithPanel(params.questions, params.title, ctx))];
      } else {
        for (const question of params.questions) {
          const answer = await ask(question, ctx, signal);
          answers = [...answers, answer];
          if (answer.cancelled) break;
        }
      }
      return boundedResult(JSON.stringify(answers), answers, ctx);
    },
  });
}

function normalize(question: Question) {
  return { id: question.id, prompt: question.prompt, options: question.options ?? [], allowMultiple: question.allow_multiple ?? false };
}

async function askWithPanel(questions: readonly Question[], title: string | undefined, ctx: ExtensionContext): Promise<readonly PanelAnswer[]> {
  return ctx.ui.custom<readonly PanelAnswer[]>((tui, _theme, _keybindings, done) => {
    let state = initialPanelState(questions.map(normalize), title);
    return {
      render: (width: number) => renderPanel(state, width),
      invalidate() {},
      handleInput(data: string) {
        const input: PanelInput | undefined = toPanelInput(data);
        if (!input) return;
        const next = reducePanel(state, input);
        if (next === state) return;
        state = next;
        tui.requestRender();
        if (state.finished) done(panelAnswers(state));
      },
    };
  });
}
