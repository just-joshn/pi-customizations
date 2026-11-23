import type { SubagentEventName, SubagentEventPayload } from './events.ts';
import { SubagentRunError } from './failures.ts';
import type { SubagentStore } from './store.ts';
import type { SubagentSessionRecord, SubagentWorktree } from './types.ts';
import { createSubagentWorktree, discardSubagentWorktree, summarizeWorktreeDiff } from './worktree.ts';

interface WorktreeCallbacks {
  readonly store: SubagentStore;
  readonly onStateChanged: (options?: { readonly includeTranscriptItems?: boolean }) => void;
  readonly emit: (event: SubagentEventName, record: SubagentSessionRecord, extra?: Partial<SubagentEventPayload>) => void;
}

export interface WorktreePrepareRequest {
  readonly cwd: string;
  readonly description: string;
  readonly agentId: string;
  readonly sessionDir: string | undefined;
  readonly root: string | undefined;
  readonly branchPrefix: string;
  readonly signal: AbortSignal;
}

function withoutWorktree(record: SubagentSessionRecord): SubagentSessionRecord {
  const { worktree, ...rest } = record;
  return worktree === undefined ? record : rest;
}

function clearRecordedWorktree(callbacks: WorktreeCallbacks, agentId: string): void {
  callbacks.store.updateSession(agentId, withoutWorktree);
}

function failWorktree(callbacks: WorktreeCallbacks, agentId: string, error: string): never {
  const failed = callbacks.store.markFailure(agentId, 'worktree-failed', error);
  if (failed) {
    callbacks.emit('runEnd', failed);
  }
  callbacks.onStateChanged();
  const detail = failed?.failureId === undefined ? error : `${error} (failure_id: ${failed.failureId})`;
  throw new SubagentRunError('worktree-failed', detail);
}

function rememberWorktree(callbacks: WorktreeCallbacks, agentId: string, worktree: SubagentWorktree): SubagentWorktree {
  const updated = callbacks.store.updateSession(agentId, (record) => ({ ...record, worktree, updatedAt: Date.now() }));
  if (updated) {
    callbacks.emit('worktree', updated);
  }
  callbacks.onStateChanged();
  return worktree;
}

/** Creates the run worktree, or removes it when the signal aborts during git worktree add. */
export async function prepareRunWorktree(callbacks: WorktreeCallbacks, request: WorktreePrepareRequest): Promise<SubagentWorktree | 'aborted'> {
  const created = await createSubagentWorktree({
    cwd: request.cwd,
    description: request.description,
    agentId: request.agentId,
    sessionDir: request.sessionDir,
    root: request.root,
    branchPrefix: request.branchPrefix,
    signal: request.signal,
  });
  if (!created.ok) {
    if (created.aborted === true) {
      clearRecordedWorktree(callbacks, request.agentId);
      return 'aborted';
    }
    return failWorktree(callbacks, request.agentId, created.error);
  }
  if (request.signal.aborted) {
    await discardSubagentWorktree(created.worktree);
    clearRecordedWorktree(callbacks, request.agentId);
    return 'aborted';
  }
  return rememberWorktree(callbacks, request.agentId, created.worktree);
}

export async function recordWorktreeSummary(agentId: string, callbacks: WorktreeCallbacks): Promise<void> {
  const record = callbacks.store.getSession(agentId);
  if (record?.worktree === undefined || (record.status === 'cancelled' && record.failureId !== undefined)) {
    return;
  }
  const summary = await summarizeWorktreeDiff(record.worktree);
  callbacks.store.updateSession(agentId, (current) => {
    if (current.status === 'cancelled' && current.failureId !== undefined) {
      return current;
    }
    return { ...current, worktreeSummary: summary, updatedAt: Date.now() };
  });
}
