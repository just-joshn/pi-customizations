import { type CreatePlanInput, ONE, type TrackedPlanStep, TWO, ZERO } from './types.ts';

const SLASH_PREFIX = '/';
const MIN_STEP_TEXT_LEN = 3;
const DONE_PATTERNS = [/\[DONE\s*:?\s*(\d+)\]/gi, /\bDone\s*:\s*(\d+)\b/gi, /\bStep\s*(\d+)\s+(?:is\s+)?(?:done|complete|completed|finished)(?![-A-Za-z0-9_])(?!\s+[A-Za-z])\b/gi];
const ALL_STEPS_COMPLETE_PATTERN = /\b(?:all|every)\s+steps?\s+(?:(?:are|is)\s+)?(?:done|complete|completed|finished)(?![-A-Za-z0-9_])(?!\s+[A-Za-z])/gi;
const PLAN_COMPLETE_PATTERN = /\b(?:the\s+)?plan\s+(?:is\s+)?(?:complete|completed|done)(?![-A-Za-z0-9_])(?!\s+[A-Za-z])\b/gi;
const NEGATION_PATTERN = /\b(?:not|never|isn't|aren't|wasn't|weren't|don't|doesn't|didn't|cannot|can't)\b/i;
const NON_COMPLETION_PREFIX_PATTERN = /\b(?:not|never|until|before|unless|if|when|once|whether|will|hope|expect|want|need|continue|isn't|aren't|wasn't|weren't|don't|doesn't|didn't|cannot|can't)\b/i;
const CONDITIONAL_AFTER_PATTERN = /^\s*(?:once|when|whenever|if|after|before|until|unless|whether|while)\b/i;

export function buildTrackedStepsFromPlanInput(input: CreatePlanInput): readonly TrackedPlanStep[] {
  const directTodos = input.todos ?? [];
  const sourceTodos = directTodos.length > ZERO ? directTodos : (input.phases ?? []).flatMap((phase) => phase.todos);
  if (sourceTodos.length > ZERO) {
    return sourceTodos.map((todo, idx) => ({
      step: idx + ONE,
      id: todo.id,
      text: todo.content.trim(),
      completed: todo.status === 'completed',
    }));
  }
  return extractStepsFromMarkdown(input.plan);
}

export function extractStepsFromMarkdown(markdown: string): readonly TrackedPlanStep[] {
  const numberedPattern = /^\s*(\d+)[.)]\s+(.+)$/gm;
  return [...markdown.matchAll(numberedPattern)]
    .map((match) => (match[TWO] ?? '').replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1').trim())
    .filter((text) => text.length > MIN_STEP_TEXT_LEN && !text.startsWith(SLASH_PREFIX))
    .map((text, idx) => ({ step: idx + ONE, id: `step-${idx + ONE}`, text, completed: false }));
}

function clauseStart(text: string, index: number): number {
  return Math.max(text.lastIndexOf('.', index - ONE), text.lastIndexOf('!', index - ONE), text.lastIndexOf('?', index - ONE), text.lastIndexOf(';', index - ONE)) + ONE;
}

function hasNegationBefore(text: string, index: number): boolean {
  return NEGATION_PATTERN.test(text.slice(clauseStart(text, index), index));
}

function followsNonCompletion(text: string, index: number): boolean {
  return NON_COMPLETION_PREFIX_PATTERN.test(text.slice(clauseStart(text, index), index));
}

function hasConditionalAfter(text: string, index: number): boolean {
  return CONDITIONAL_AFTER_PATTERN.test(text.slice(index));
}

export function extractDoneStepNumbers(text: string): readonly number[] {
  const numbers = DONE_PATTERNS.flatMap((pattern) =>
    [...text.matchAll(pattern)]
      .filter((match) => {
        const index = match.index ?? ZERO;
        return !hasNegationBefore(text, index) && !followsNonCompletion(text, index) && !hasConditionalAfter(text, index + match[ZERO].length);
      })
      .map((match) => Number(match[ONE])),
  );
  return [...new Set(numbers.filter((n) => Number.isInteger(n) && n > ZERO))];
}

export function applyCompletedSteps(text: string, steps: readonly TrackedPlanStep[]): readonly TrackedPlanStep[] {
  const doneSet = new Set(extractDoneStepNumbers(text));
  if (doneSet.size === ZERO) {
    return steps;
  }
  return steps.map((item) => (doneSet.has(item.step) ? { ...item, completed: true } : item));
}

function hasAllStepsCompletePhrase(text: string): boolean {
  for (const pattern of [ALL_STEPS_COMPLETE_PATTERN, PLAN_COMPLETE_PATTERN]) {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? ZERO;
      if (!followsNonCompletion(text, index) && !hasConditionalAfter(text, index + match[ZERO].length)) {
        return true;
      }
    }
  }
  return false;
}

function markAllStepsCompleted(steps: readonly TrackedPlanStep[]): readonly TrackedPlanStep[] {
  return steps.map((item) => ({ ...item, completed: true }));
}

export function advancePlanSteps(text: string, steps: readonly TrackedPlanStep[]): readonly TrackedPlanStep[] {
  return hasAllStepsCompletePhrase(text) ? markAllStepsCompleted(steps) : applyCompletedSteps(text, steps);
}
