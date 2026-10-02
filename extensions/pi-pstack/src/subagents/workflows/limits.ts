import { defaultWorkflowLimits, type WorkflowLimits } from '../settings.ts';
import type { RunRecord, WorkflowDeclaration } from './types.ts';
import { workflowLimitMessage } from './types.ts';

export type LimitInputs = Readonly<{ declaration: Pick<WorkflowDeclaration, 'limits'>; overrides?: Partial<WorkflowLimits>; defaults: WorkflowLimits }>;

/** Effective limits resolve per run over the declared limits over the configured defaults. */
export function effectiveLimits({ declaration, overrides, defaults }: LimitInputs): WorkflowLimits {
  return { ...defaultWorkflowLimits, ...defaults, ...declaration.limits, ...overrides };
}

export type Consumption = RunRecord['consumption'];
export type LimitVerdict = Readonly<{ ok: true }> | Readonly<{ ok: false; kind: 'total' | 'time' | 'credits'; message: string }>;

/** Credits are a soft post-paid ceiling, so the credit check runs after a turn settles, not before it starts. */
export function checkLimits(record: Pick<RunRecord, 'effectiveLimits' | 'consumption'>, now: number): LimitVerdict {
  const { maxTotalSubagents, timeoutSeconds } = record.effectiveLimits;
  if (maxTotalSubagents !== undefined && record.consumption.subagents >= maxTotalSubagents) return { ok: false, kind: 'total', message: `${workflowLimitMessage}: maxTotalSubagents (${maxTotalSubagents}) was reached.` };
  if (timeoutSeconds !== undefined && now - record.consumption.startedAt >= timeoutSeconds * 1000) return { ok: false, kind: 'time', message: `${workflowLimitMessage}: timeoutSeconds (${timeoutSeconds}) elapsed.` };
  return { ok: true };
}

export function overCredits(record: Pick<RunRecord, 'effectiveLimits' | 'consumption'>): LimitVerdict | undefined {
  const max = record.effectiveLimits.maxAiCredits;
  if (max === undefined || record.consumption.credits <= max) return undefined;
  return { ok: false, kind: 'credits', message: `${workflowLimitMessage}: maxAiCredits (${max}) was exceeded.` };
}
