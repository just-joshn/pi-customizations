import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { writePlanFile } from './plan-files.ts';
import { buildTrackedStepsFromPlanInput } from './plan-progress.ts';
import { formatModeLabel, isReadOnlyMode } from './state.ts';
import { type AskQuestionInput, AskQuestionInputSchema, CreatePlanInputSchema, MODE_TOOL_NAMES, type ModeId, type ModesRuntimeState, ONE, SwitchModeInputSchema, type TrackedPlanStep, ZERO } from './types.ts';

const FREEFORM_OTHER_ID = '__freeform_other__';
const FREEFORM_OTHER_LABEL = 'Other';
const SKIP_OPTION_LABEL = 'Skip questions';
const DONE_MULTI_LABEL = 'Done selecting';
const APPROVE_SWITCH_LABEL = 'Approve mode switch';
const REJECT_SWITCH_LABEL = 'Reject';

const TodoItemSchema = Type.Object({
  id: Type.String(),
  content: Type.String(),
  status: Type.Optional(Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed'), Type.Literal('cancelled')])),
  dependencies: Type.Optional(Type.Array(Type.String())),
});

const PhaseSchema = Type.Object({
  name: Type.String(),
  todos: Type.Array(TodoItemSchema),
});

const SwitchModeParams = Type.Object({
  target_mode_id: Type.Union([Type.Literal('agent'), Type.Literal('plan'), Type.Literal('debug'), Type.Literal('ask')]),
  explanation: Type.Optional(Type.String()),
});

const AskQuestionParams = Type.Object({
  title: Type.Optional(Type.String()),
  questions: Type.Array(
    Type.Object({
      id: Type.String(),
      prompt: Type.String(),
      options: Type.Array(Type.Object({ id: Type.String(), label: Type.String() })),
      allow_multiple: Type.Optional(Type.Boolean()),
    }),
  ),
});

const CreatePlanParams = Type.Object({
  plan: Type.String(),
  name: Type.Optional(Type.String()),
  overview: Type.Optional(Type.String()),
  todos: Type.Optional(Type.Array(TodoItemSchema)),
  is_project: Type.Optional(Type.Boolean()),
  phases: Type.Optional(Type.Array(PhaseSchema)),
});

export interface ModeToolsCallbacks {
  readonly getState: () => ModesRuntimeState;
  readonly switchMode: (nextMode: ModeId, ctx: ExtensionContext) => Promise<void>;
  readonly onPlanCreated: (planUri: string, steps: readonly TrackedPlanStep[], ctx: ExtensionContext) => void;
}

function isTrailingOtherLabel(label: string): boolean {
  const lower = label.toLowerCase().trim();
  return (
    lower === 'other' ||
    lower === 'something else' ||
    lower.startsWith('other:') ||
    lower.startsWith('other -') ||
    lower.startsWith('other (') ||
    lower.startsWith('something else:') ||
    lower.startsWith('something else -') ||
    lower.startsWith('something else (')
  );
}

interface DisplayOption {
  readonly id: string;
  readonly label: string;
  readonly isFreeform: boolean;
}

function buildDisplayOptions(options: readonly { id: string; label: string }[]): readonly DisplayOption[] {
  const lastOption = options.at(-ONE);
  const filtered = lastOption && isTrailingOtherLabel(lastOption.label) ? options.slice(ZERO, -ONE) : options;
  return [...filtered.map((opt) => ({ id: opt.id, label: opt.label, isFreeform: false })), { id: FREEFORM_OTHER_ID, label: FREEFORM_OTHER_LABEL, isFreeform: true }];
}

interface QuestionAnswer {
  readonly questionId: string;
  readonly selectedOptionIds: readonly string[];
  readonly freeformText: string;
}

async function askSingleSelectQuestion(ctx: ExtensionContext, promptTitle: string, questionId: string, prompt: string, displayOptions: readonly DisplayOption[]): Promise<QuestionAnswer | 'skipped'> {
  const labels = [...displayOptions.map((opt) => opt.label), SKIP_OPTION_LABEL];
  const choice = await ctx.ui.select(promptTitle, labels);
  if (!choice || choice === SKIP_OPTION_LABEL) {
    return 'skipped';
  }
  const picked = displayOptions.find((opt) => opt.label === choice);
  if (!picked) {
    return 'skipped';
  }
  if (picked.isFreeform) {
    const text = (await ctx.ui.input(prompt, 'Enter custom response…'))?.trim() ?? '';
    return { questionId, selectedOptionIds: [], freeformText: text.length > ZERO ? text : FREEFORM_OTHER_LABEL };
  }
  return { questionId, selectedOptionIds: [picked.id], freeformText: '' };
}

function formatMultiLabels(displayOptions: readonly DisplayOption[], selectedIds: readonly string[]): string[] {
  return [...displayOptions.map((opt) => `${selectedIds.includes(opt.id) ? '[x]' : '[ ]'} ${opt.label}`), DONE_MULTI_LABEL, SKIP_OPTION_LABEL];
}

async function askMultiSelectQuestion(ctx: ExtensionContext, promptTitle: string, questionId: string, prompt: string, displayOptions: readonly DisplayOption[]): Promise<QuestionAnswer | 'skipped'> {
  let selectedIds: readonly string[] = [];
  let freeformText = '';
  for (;;) {
    const multiLabels = formatMultiLabels(displayOptions, selectedIds);
    const choice = await ctx.ui.select(`${promptTitle} (multi-select)`, multiLabels);
    if (!choice || choice === SKIP_OPTION_LABEL) {
      return 'skipped';
    }
    if (choice === DONE_MULTI_LABEL) {
      return { questionId, selectedOptionIds: selectedIds.filter((id) => id !== FREEFORM_OTHER_ID), freeformText };
    }
    const picked = displayOptions[multiLabels.indexOf(choice)];
    if (!picked) {
      continue;
    }
    if (picked.isFreeform) {
      const text = (await ctx.ui.input(prompt, 'Enter custom response…'))?.trim() ?? '';
      freeformText = text.length > ZERO ? text : FREEFORM_OTHER_LABEL;
      selectedIds = selectedIds.includes(FREEFORM_OTHER_ID) ? selectedIds : [...selectedIds, FREEFORM_OTHER_ID];
    } else {
      selectedIds = selectedIds.includes(picked.id) ? selectedIds.filter((id) => id !== picked.id) : [...selectedIds, picked.id];
    }
  }
}

function askSingleQuestion(ctx: ExtensionContext, title: string, question: AskQuestionInput['questions'][number]): Promise<QuestionAnswer | 'skipped'> {
  const displayOptions = buildDisplayOptions(question.options);
  const promptTitle = `${title}: ${question.prompt}`;
  if (!question.allow_multiple) {
    return askSingleSelectQuestion(ctx, promptTitle, question.id, question.prompt, displayOptions);
  }
  return askMultiSelectQuestion(ctx, promptTitle, question.id, question.prompt, displayOptions);
}

async function requestModeSwitchApproval(ctx: ExtensionContext, toLabel: string, explanation: string | undefined): Promise<boolean> {
  if (!ctx.hasUI) {
    return true;
  }
  const promptTitle = explanation ? `Switch to ${toLabel} mode? — ${explanation}` : `Switch to ${toLabel} mode?`;
  const decision = await ctx.ui.select(promptTitle, [APPROVE_SWITCH_LABEL, REJECT_SWITCH_LABEL]);
  return decision === APPROVE_SWITCH_LABEL;
}

function registerSwitchModeTool(pi: ExtensionAPI, callbacks: ModeToolsCallbacks): void {
  pi.registerTool({
    name: MODE_TOOL_NAMES.switchMode,
    label: 'SwitchMode',
    description: 'Propose switching execution mode between agent, plan, debug, and ask. Requests user approval in interactive UI; without a UI, escalation from a read-only mode is refused.',
    parameters: SwitchModeParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parsed = SwitchModeInputSchema.parse(params);
      const fromMode = callbacks.getState().mode;
      const toMode = parsed.target_mode_id;
      const toLabel = formatModeLabel(toMode);

      if (fromMode === toMode) {
        return { content: [{ type: 'text', text: `Already in ${toLabel} mode.` }], details: { status: 'success', fromModeId: fromMode, toModeId: toMode } };
      }
      if (!ctx.hasUI && isReadOnlyMode(fromMode) && !isReadOnlyMode(toMode)) {
        const details = { status: 'rejected', fromModeId: fromMode, toModeId: toMode, reason: 'A read-only mode needs interactive approval to switch to a write-capable mode' };
        return { content: [{ type: 'text', text: 'A read-only mode needs interactive approval to switch to Agent or Debug mode. Ask the user to switch manually.' }], details };
      }
      const approved = await requestModeSwitchApproval(ctx, toLabel, parsed.explanation);
      if (!approved) {
        const details = { status: 'rejected', fromModeId: fromMode, toModeId: toMode, reason: 'Mode switch rejected by user' };
        return { content: [{ type: 'text', text: 'Mode switch rejected by user.' }], details };
      }
      await callbacks.switchMode(toMode, ctx);
      return {
        content: [{ type: 'text', text: `Switched from ${formatModeLabel(fromMode)} to ${toLabel} mode.` }],
        details: { status: 'success', fromModeId: fromMode, toModeId: toMode },
      };
    },
  });
}

async function collectAnswers(ctx: ExtensionContext, title: string, questions: AskQuestionInput['questions']): Promise<readonly QuestionAnswer[] | 'skipped'> {
  let answers: readonly QuestionAnswer[] = [];
  for (const question of questions) {
    const answer = await askSingleQuestion(ctx, title, question);
    if (answer === 'skipped') {
      return 'skipped';
    }
    answers = [...answers, answer];
  }
  return answers;
}

function registerAskQuestionTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: MODE_TOOL_NAMES.askQuestion,
    label: 'AskQuestion',
    description: 'Ask the user structured clarifying questions with selectable options and an automatic freeform "Other" option.',
    parameters: AskQuestionParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parsed = AskQuestionInputSchema.parse(params);
      if (!ctx.hasUI) {
        return { content: [{ type: 'text', text: 'Questions skipped (non-interactive session).' }], details: { status: 'rejected', reason: 'Non-interactive session' } };
      }
      const title = parsed.title?.trim() || 'Clarifying Questions';
      const answers = await collectAnswers(ctx, title, parsed.questions);
      if (answers === 'skipped') {
        return { content: [{ type: 'text', text: 'Questions skipped by user.' }], details: { status: 'rejected', reason: 'Questions skipped by user' } };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'success', answers }) }], details: { status: 'success', answers } };
    },
  });
}

function registerCreatePlanTool(pi: ExtensionAPI, callbacks: ModeToolsCallbacks): void {
  pi.registerTool({
    name: MODE_TOOL_NAMES.createPlan,
    label: 'CreatePlan',
    description: 'Create and persist a structured markdown plan file with YAML todo/phase frontmatter in ~/.pi/agent/plans/.',
    parameters: CreatePlanParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parsed = CreatePlanInputSchema.parse(params);
      const conversationId = ctx.sessionManager.getSessionId();
      const saved = await writePlanFile(parsed, conversationId);
      const steps = buildTrackedStepsFromPlanInput(parsed);
      callbacks.onPlanCreated(saved.planUri, steps, ctx);
      return {
        content: [{ type: 'text', text: `Plan saved to ${saved.filePath} (${saved.planUri}) with ${steps.length} tracked step(s).` }],
        details: { status: 'success', planUri: saved.planUri, filePath: saved.filePath, created: saved.created, stepCount: steps.length },
      };
    },
  });
}

export function registerModeTools(pi: ExtensionAPI, callbacks: ModeToolsCallbacks): void {
  registerSwitchModeTool(pi, callbacks);
  registerAskQuestionTool(pi);
  registerCreatePlanTool(pi, callbacks);
}
