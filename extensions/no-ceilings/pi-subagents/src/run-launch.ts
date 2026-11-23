import type { SubagentsConfig } from './config.ts';
import { prepareRunWorktree, recordWorktreeSummary } from './run-worktree.ts';
import { type AttemptPlan, abortedOutcome, buildDetailsFromRecord, finalizeSubagentSession, type RunnerCallbacks, type RunSetup, type RunTaskOptions, runAttempts, runForegroundSubagent } from './runner.ts';
import type { SubagentRunOutcome } from './store.ts';
import { type NestedScope, type SubagentSessionRecord, type SubagentWorktree, type TaskToolDetails, ZERO } from './types.ts';
import { resolveWorktreeChildCwd } from './worktree.ts';

export function cancelPreparedRun(callbacks: RunnerCallbacks, agentId: string, initialRecord: SubagentSessionRecord, startedAt: number): TaskToolDetails {
  const outcome = abortedOutcome(Math.max(ZERO, Date.now() - startedAt));
  const finalized = finalizeSubagentSession(callbacks.store, agentId, outcome, startedAt) ?? initialRecord;
  callbacks.emit('runEnd', finalized);
  callbacks.onStateChanged();
  return buildDetailsFromRecord(finalized);
}

function buildAttemptPlan(
  options: RunTaskOptions,
  config: SubagentsConfig,
  setup: RunSetup,
  agentId: string,
  startedAt: number,
  abortController: AbortController,
  nestedScope: NestedScope | undefined,
  childDepth: number,
  worktree: SubagentWorktree | undefined,
): AttemptPlan {
  const childCwd = worktree === undefined ? options.ctx.cwd : resolveWorktreeChildCwd(worktree, options.ctx.cwd);
  return {
    agentId,
    prompt: setup.prompt,
    parentSessionId: setup.parentSessionId,
    startedAt,
    existing: setup.existing,
    isResume: setup.existing !== undefined,
    childDepth,
    ownedAgentIds: [...(nestedScope?.agentIds ?? [])],
    nestedScope,
    abortController,
    childCwd,
    maxAttempts: setup.maxAttempts,
    retryDelayMs: config.retry.delayMs,
    model: setup.model,
    thinking: setup.thinking,
    readonly: setup.isReadonly,
  };
}

async function resolveLaunchWorktree(
  options: RunTaskOptions,
  callbacks: RunnerCallbacks,
  config: SubagentsConfig,
  setup: RunSetup,
  agentId: string,
  description: string,
  abortController: AbortController,
  requestedWorktree: boolean,
): Promise<SubagentWorktree | undefined | 'aborted'> {
  if (setup.existing?.worktree !== undefined) {
    return setup.existing.worktree;
  }
  if (!requestedWorktree) {
    return undefined;
  }
  return prepareRunWorktree(callbacks, {
    cwd: options.ctx.cwd,
    description,
    agentId,
    sessionDir: options.ctx.sessionManager.getSessionDir(),
    root: config.worktrees.root,
    branchPrefix: config.worktrees.branchPrefix,
    signal: abortController.signal,
  });
}

function runWithSummary(options: RunTaskOptions, callbacks: RunnerCallbacks, plan: AttemptPlan, agentId: string): Promise<SubagentRunOutcome> {
  return runAttempts(options, callbacks, plan).then(async (outcome) => {
    await recordWorktreeSummary(agentId, callbacks);
    return outcome;
  });
}

export async function runDetachedTask(
  options: RunTaskOptions,
  callbacks: RunnerCallbacks,
  config: SubagentsConfig,
  setup: RunSetup,
  agentId: string,
  startedAt: number,
  abortController: AbortController,
  nestedScope: NestedScope | undefined,
  childDepth: number,
  description: string,
  requestedWorktree: boolean,
): Promise<SubagentRunOutcome> {
  const worktree = await resolveLaunchWorktree(options, callbacks, config, setup, agentId, description, abortController, requestedWorktree);
  if (worktree === 'aborted' || abortController.signal.aborted) {
    return abortedOutcome(Math.max(ZERO, Date.now() - startedAt));
  }
  return runWithSummary(options, callbacks, buildAttemptPlan(options, config, setup, agentId, startedAt, abortController, nestedScope, childDepth, worktree), agentId);
}

export async function runForegroundTask(
  options: RunTaskOptions,
  callbacks: RunnerCallbacks,
  config: SubagentsConfig,
  setup: RunSetup,
  agentId: string,
  startedAt: number,
  initialRecord: SubagentSessionRecord,
  abortController: AbortController,
  nestedScope: NestedScope | undefined,
  childDepth: number,
  requestedWorktree: boolean,
): Promise<TaskToolDetails> {
  const onAbort = (): void => {
    abortController.abort();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const worktree = await resolveLaunchWorktree(options, callbacks, config, setup, agentId, initialRecord.description, abortController, requestedWorktree);
    if (worktree === 'aborted' || abortController.signal.aborted) {
      return cancelPreparedRun(callbacks, agentId, initialRecord, startedAt);
    }
    const runPromise = runWithSummary(options, callbacks, buildAttemptPlan(options, config, setup, agentId, startedAt, abortController, nestedScope, childDepth, worktree), agentId);
    options.onUpdate?.(buildDetailsFromRecord(initialRecord));
    return await runForegroundSubagent(options, initialRecord, runPromise, abortController, callbacks);
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}
