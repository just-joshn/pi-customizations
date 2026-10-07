import type { Run } from '../domain/run.ts';
import type { RouteFacts } from '../policy/invocation.ts';
import type { ReviewSurface } from '../review/reviewer.ts';

export const MODEL_CHANGE_ID = 'domain.model_change';

export const UNCERTAINTY_ID = 'architecture.uncertainty';

function decisionAnswer(run: Run, id: string): string | null {
  return run.domain.decisions.find((decision) => decision.id === id)?.answer ?? null;
}

export function modelChange(run: Run): boolean | null {
  const answer = decisionAnswer(run, MODEL_CHANGE_ID);
  return answer === null ? null : answer.trim().toLowerCase() === 'yes';
}

export function pendingUncertainty(run: Run): string | null {
  const question = decisionAnswer(run, UNCERTAINTY_ID);
  if (question === null || question.trim() === '' || run.prototypes.some((prototype) => prototype.question === question)) return null;
  return question;
}

export function routeFacts(run: Run): RouteFacts {
  const browserConsumer = run.consumer.kind === 'browser' || run.consumer.kind === 'electron';
  const declaredReact = run.constraints.some((constraint) => /\b(react|next(\.js)?)\b/i.test(constraint));
  return {
    modelChange: modelChange(run) === true,
    reactStack: declaredReact || run.preflight?.reactStack === true,
    webUi: run.mode === 'frontend' || browserConsumer,
    browserConsumer,
  };
}

export function reviewSurface(run: Run): ReviewSurface {
  const facts = routeFacts(run);
  return facts.webUi ? { kind: 'web_ui', react: facts.reactStack } : { kind: 'non_web' };
}
