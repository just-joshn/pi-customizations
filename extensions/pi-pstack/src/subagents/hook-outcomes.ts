import type { HookRun } from './hook-run.ts';

export type ToolVerdict = Readonly<{ decision?: 'allow' | 'deny' | 'ask'; reason?: string; updatedInput?: Readonly<Record<string, unknown>> }>;
export type PermissionAnswer = Readonly<{ behavior: 'allow' | 'deny'; message?: string; updatedInput?: Readonly<Record<string, unknown>> }>;

const rank = { deny: 2, ask: 1, allow: 0 } as const;

function specific(run: HookRun): Record<string, unknown> {
  const value = run.json?.hookSpecificOutput;
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function verdictOf(run: HookRun): ToolVerdict {
  if (run.code === 2) return { decision: 'deny', reason: run.stderr.trim() || 'blocked by a PreToolUse hook' };
  if (run.code !== 0 || !run.json) return {};
  const output = specific(run);
  const decision = output.permissionDecision ?? (run.json.decision === 'block' ? 'deny' : run.json.decision === 'approve' ? 'allow' : undefined);
  const updatedInput = recordOf(output.updatedInput);
  const reason = text(output.permissionDecisionReason) ?? text(run.json.reason);
  return {
    ...(decision === 'allow' || decision === 'deny' || decision === 'ask' ? { decision } : {}),
    ...(reason ? { reason } : {}),
    ...(updatedInput ? { updatedInput } : {}),
  };
}

/** Deny beats ask beats allow across hooks; the last rewritten input wins. */
export function preToolUseVerdict(runs: readonly HookRun[]): ToolVerdict {
  const verdicts = runs.map(verdictOf);
  const decided = verdicts.filter((verdict) => verdict.decision !== undefined).toSorted((a, b) => rank[b.decision ?? 'allow'] - rank[a.decision ?? 'allow'])[0];
  const updatedInput = verdicts.findLast((verdict) => verdict.updatedInput !== undefined)?.updatedInput;
  return { ...(decided?.decision ? { decision: decided.decision } : {}), ...(decided?.reason ? { reason: decided.reason } : {}), ...(updatedInput ? { updatedInput } : {}) };
}

function answerOf(run: HookRun): PermissionAnswer | undefined {
  if (run.code === 2) return { behavior: 'deny', message: run.stderr.trim() || 'denied by a PermissionRequest hook' };
  const decision = recordOf(specific(run).decision);
  const behavior = decision?.behavior;
  if (behavior !== 'allow' && behavior !== 'deny') return undefined;
  const message = text(decision?.message);
  const updatedInput = recordOf(decision?.updatedInput);
  return { behavior, ...(message ? { message } : {}), ...(updatedInput ? { updatedInput } : {}) };
}

/** The first hook that answers decides, with a denial from any hook taking precedence. */
export function permissionAnswer(runs: readonly HookRun[]): PermissionAnswer | undefined {
  const answers = runs.flatMap((run) => answerOf(run) ?? []);
  return answers.find((answer) => answer.behavior === 'deny') ?? answers[0];
}

export function additionalContexts(runs: readonly HookRun[]): string[] {
  return runs.flatMap((run) => (run.code === 0 ? (text(specific(run).additionalContext) ?? []) : []));
}
