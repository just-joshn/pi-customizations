// Decides whether a finished run is evidence at all. A run whose provider failed, whose parent did nothing, or whose drive hook crashed
// has no behavior to score: scoring it prints FAILs for things the model never got to do and PASSes for actions it never took.
import { budgetFor } from './budget.ts';
import type { Meta, RunSpec } from './driver.ts';
import type { RunView } from './view.ts';

export type InconclusiveKind = 'provider-error' | 'no-activity' | 'crash' | 'harness-budget';

export interface Inconclusive {
  kind: InconclusiveKind;
  message: string;
}

export const EXIT_INCONCLUSIVE = 3;

/** The reason a run's evidence cannot be scored, or undefined when it can. */
/** no-activity applies to the real driver only: a scripted parent that does nothing is a scenario (a command the driver kills mid-turn leaves no recorded message). */
export function assess(view: RunView, crashed?: string): Inconclusive | undefined {
  if (crashed !== undefined) return { kind: 'crash', message: crashed };
  const errors = view.parent.errors;
  if (errors.length > 0) return { kind: 'provider-error', message: errors[0] as string };
  const replied = view.parent.messages.some((message) => message.role === 'assistant' && message.text.trim() !== '');
  if (view.driver === 'real' && view.parent.toolCalls.length === 0 && !replied) return { kind: 'no-activity', message: 'the parent made no tool call and produced no reply' };
  return undefined;
}

/** Only recorded effective fixture limits establish that a real run stopped below its product budget. */
export function assessHarnessStop(meta: Meta, spec: Pick<RunSpec, 'family' | 'timeoutMs'>): Inconclusive | undefined {
  if (meta.driver !== 'real' || !meta.timedOut || meta.stopReason === undefined || meta.budget === undefined || spec.timeoutMs === undefined) return undefined;
  const expected = budgetFor(spec.family);
  const actual = meta.budget;
  if (actual.idleMs !== spec.timeoutMs || actual.ceilingMs !== spec.timeoutMs) return undefined;
  const bound = meta.stopReason === 'ceiling' ? 'ceilingMs' : 'idleMs';
  if (actual[bound] >= expected[bound]) return undefined;
  return { kind: 'harness-budget', message: `the harness stopped at its recorded fixture ${actual[bound]} ms ${meta.stopReason} limit, below the real-model ${expected[bound]} ms limit` };
}

/** A check that passes on the absence of an action proves nothing unless the parent ran: it completed without error and made at least one tool call. */
export function parentRan(view: RunView): string | undefined {
  if (view.parent.errors.length > 0) return `the parent session ended in a provider error: ${view.parent.errors[0]}`;
  if (view.parent.toolCalls.length === 0) return 'the parent made no tool call, so an absent action is not evidence';
  return undefined;
}

export const describe = (found: Inconclusive): string => `INCONCLUSIVE ${found.kind}: ${found.message}`;
