import { type CreatePlanInput, ONE, type TrackedPlanStep, TWO, ZERO } from './types.ts';

const SLASH_PREFIX = '/';
const MIN_STEP_TEXT_LEN = 3;

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

export function extractDoneStepNumbers(text: string): readonly number[] {
  const patterns = [/\[DONE\s*:?\s*(\d+)\]/gi, /\bDone\s*:\s*(\d+)\b/gi, /\bStep\s*(\d+)\s+(?:is\s+)?(?:done|complete|completed|finished)\b/gi];
  const numbers = patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => Number(match[ONE])));
  return [...new Set(numbers.filter((n) => Number.isInteger(n) && n > ZERO))];
}

export function applyCompletedSteps(text: string, steps: readonly TrackedPlanStep[]): readonly TrackedPlanStep[] {
  const doneSet = new Set(extractDoneStepNumbers(text));
  if (doneSet.size === ZERO) {
    return steps;
  }
  return steps.map((item) => (doneSet.has(item.step) ? { ...item, completed: true } : item));
}

const ALL_STEPS_COMPLETE_PATTERN = /(?:all|every)\s+steps?\s+(?:(?:are|is)\s+)?(?:done|complete|completed|finished)/i;
const PLAN_COMPLETE_PATTERN = /\b(?:the\s+)?plan\s+(?:is\s+)?(?:complete|completed|done)\b/gi;
const NEGATION_PATTERN = /\b(?:not|never|isn't|aren't|wasn't|weren't|don't|doesn't|didn't|cannot|can't)\b/i;

function followsNegation(text: string, index: number): boolean {
  const sentenceStart = Math.max(text.lastIndexOf('.', index - ONE), text.lastIndexOf('!', index - ONE), text.lastIndexOf('?', index - ONE)) + ONE;
  return NEGATION_PATTERN.test(text.slice(sentenceStart, index));
}

function hasAllStepsCompletePhrase(text: string): boolean {
  if (ALL_STEPS_COMPLETE_PATTERN.test(text)) {
    return true;
  }
  for (const match of text.matchAll(PLAN_COMPLETE_PATTERN)) {
    if (!followsNegation(text, match.index ?? ZERO)) {
      return true;
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
