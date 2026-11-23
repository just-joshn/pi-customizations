import { randomUUID } from 'node:crypto';

import {
  type BackgroundCompletionPayload,
  isActiveSubagentStatus,
  MAX_CHECKPOINTS,
  ONE,
  type PersistedSubagentRecord,
  type PersistedSubagentsState,
  type SubagentCheckpoint,
  type SubagentFailureCode,
  type SubagentSessionRecord,
  type SubagentTranscriptItem,
  UUID_PATTERN,
  ZERO,
} from './types.ts';

const FAILURE_ID_CHARS = 12;

function createFailureId(): string {
  return randomUUID().replace(/-/g, '').slice(ZERO, FAILURE_ID_CHARS);
}
const MAX_PERSISTED_TRANSCRIPT_ITEMS = 10;
const MAX_PERSISTED_ITEM_CHARS = 500;
const MAX_SNAPSHOT_TRANSCRIPTS = 3;

export interface ActiveRunHandle {
  readonly agentId: string;
  readonly toolCallId: string;
  readonly isBackground: boolean;
  readonly abort: () => void;
  readonly requestBackground?: () => boolean;
  readonly completionPromise: Promise<SubagentRunOutcome>;
}

export type SubagentRunOutcome =
  | { readonly status: 'completed'; readonly finalMessage?: string; readonly toolCallCount: number; readonly durationMs: number }
  | { readonly status: 'aborted'; readonly error: string; readonly errorCode: SubagentFailureCode; readonly durationMs: number }
  | { readonly status: 'error'; readonly error: string; readonly errorCode: SubagentFailureCode; readonly durationMs: number };

interface SubagentStoreState {
  readonly sessions: Readonly<Record<string, SubagentSessionRecord>>;
  readonly activeRuns: Readonly<Record<string, ActiveRunHandle>>;
  readonly pendingWakeups: readonly BackgroundCompletionPayload[];
  readonly suppressedWakeupIds: readonly string[];
  readonly listeners: readonly (() => void)[];
  readonly dirtyIds: ReadonlySet<string>;
}

export interface SubagentStore {
  readonly getSession: (agentId: string) => SubagentSessionRecord | undefined;
  readonly listSessions: () => readonly SubagentSessionRecord[];
  readonly listActiveSessions: () => readonly SubagentSessionRecord[];
  readonly upsertSession: (record: SubagentSessionRecord) => void;
  readonly updateSession: (agentId: string, updater: (prev: SubagentSessionRecord) => SubagentSessionRecord) => SubagentSessionRecord | undefined;
  readonly appendTranscriptItem: (agentId: string, item: SubagentTranscriptItem) => void;
  readonly appendCheckpoint: (agentId: string, checkpoint: SubagentCheckpoint) => void;
  readonly withCheckpoint: (agentId: string, options: { readonly transcriptPath?: string | undefined }) => SubagentCheckpoint | undefined;
  readonly markFailure: (agentId: string, code: SubagentFailureCode, message: string) => SubagentSessionRecord | undefined;
  readonly registerActiveRun: (handle: ActiveRunHandle) => void;
  readonly getActiveRun: (agentId: string) => ActiveRunHandle | undefined;
  readonly clearActiveRun: (agentId: string) => void;
  readonly isRunBusy: (agentId: string) => boolean;
  readonly listForegroundRuns: () => readonly ActiveRunHandle[];
  readonly abortRun: (agentId: string) => boolean;
  readonly abortAllRuns: () => number;
  readonly enqueueWakeup: (payload: BackgroundCompletionPayload) => boolean;
  readonly drainWakeups: () => readonly BackgroundCompletionPayload[];
  readonly suppressWakeup: (agentId: string) => void;
  readonly unsuppressWakeup: (agentId: string) => void;
  readonly hasPendingWakeups: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
  readonly restoreFromPersisted: (persisted: PersistedSubagentsState, parentSessionId: string) => void;
  readonly toPersistedState: (options?: { readonly includeTranscriptItems?: boolean }) => PersistedSubagentsState;
  readonly toPersistedPatch: (options?: { readonly includeTranscriptItems?: boolean }) => PersistedSubagentsState;
  readonly reset: () => void;
}

function createEmptyState(): SubagentStoreState {
  return { sessions: {}, activeRuns: {}, pendingWakeups: [], suppressedWakeupIds: [], listeners: [], dirtyIds: new Set() };
}

function addedDirtyIds(prev: SubagentStoreState, next: SubagentStoreState): ReadonlySet<string> {
  if (next.sessions === prev.sessions) {
    return prev.dirtyIds;
  }
  const changed = Object.keys(next.sessions).filter((id) => next.sessions[id] !== prev.sessions[id]);
  return changed.length === ZERO ? prev.dirtyIds : new Set([...prev.dirtyIds, ...changed]);
}

function omitKey<T>(record: Readonly<Record<string, T>>, keyToOmit: string): Readonly<Record<string, T>> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== keyToOmit));
}

function recentCompletedIds(records: readonly SubagentSessionRecord[]): ReadonlySet<string> {
  const recent = records
    .filter((record) => !isActiveSubagentStatus(record.status))
    .toSorted((left, right) => right.updatedAt - left.updatedAt || right.agentId.localeCompare(left.agentId))
    .slice(ZERO, MAX_SNAPSHOT_TRANSCRIPTS);
  return new Set(recent.map((record) => record.agentId));
}

function keepSnapshotTranscript(record: SubagentSessionRecord, includeTranscriptItems: boolean | undefined, recentCompleted: ReadonlySet<string>): boolean {
  if (includeTranscriptItems === true) {
    return true;
  }
  if (includeTranscriptItems === false) {
    return false;
  }
  return recentCompleted.has(record.agentId);
}

function toPersistedRecord(record: SubagentSessionRecord, includeTranscriptItems: boolean): PersistedSubagentRecord {
  return {
    agentId: record.agentId,
    parentSessionId: record.parentSessionId,
    ...(record.ownerAgentId !== undefined ? { ownerAgentId: record.ownerAgentId } : {}),
    toolCallId: record.toolCallId,
    subagentType: record.subagentType,
    description: record.description,
    prompt: record.prompt,
    ...(record.model !== undefined ? { model: record.model } : {}),
    ...(record.thinking !== undefined ? { thinking: record.thinking } : {}),
    readonly: record.readonly,
    status: record.status,
    isBackground: record.isBackground ?? false,
    backgroundReason: record.backgroundReason,
    attempts: record.attempts,
    maxAttempts: record.maxAttempts,
    ...(record.lastMessage !== undefined ? { lastMessage: record.lastMessage } : {}),
    ...(record.error !== undefined ? { error: record.error } : {}),
    ...(record.errorCode !== undefined ? { errorCode: record.errorCode } : {}),
    ...(record.failureId !== undefined ? { failureId: record.failureId } : {}),
    toolCallCount: record.toolCallCount,
    ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    ...(record.closedAt !== undefined ? { closedAt: record.closedAt } : {}),
    ...(record.transcriptPath !== undefined ? { transcriptPath: record.transcriptPath } : {}),
    ...(record.worktree !== undefined ? { worktree: record.worktree } : {}),
    ...(record.worktreeSummary !== undefined ? { worktreeSummary: record.worktreeSummary } : {}),
    checkpoints: includeTranscriptItems
      ? [...record.checkpoints]
      : record.checkpoints.map((checkpoint) => ({ seq: checkpoint.seq, at: checkpoint.at, status: checkpoint.status, toolCallCount: checkpoint.toolCallCount, transcriptItems: checkpoint.transcriptItems })),
    ...(includeTranscriptItems ? { transcriptItems: record.transcriptItems.slice(-MAX_PERSISTED_TRANSCRIPT_ITEMS).map((item) => ({ ...item, text: item.text.slice(ZERO, MAX_PERSISTED_ITEM_CHARS) })) } : {}),
  };
}

export function isValidSubagentId(agentId: string): boolean {
  return UUID_PATTERN.test(agentId.trim());
}

export function isMatchingLineage(record: SubagentSessionRecord | undefined, parentSessionId: string): boolean {
  return record !== undefined && record.parentSessionId === parentSessionId;
}

interface StoreCell {
  readonly read: () => SubagentStoreState;
  readonly commit: (next: SubagentStoreState, trackSessions?: boolean) => void;
}

function buildSessionOps(cell: StoreCell) {
  const listSessions = (): readonly SubagentSessionRecord[] => Object.values(cell.read().sessions).toSorted((a, b) => (a.startedAt !== b.startedAt ? a.startedAt - b.startedAt : a.agentId.localeCompare(b.agentId)));

  const updateSession = (agentId: string, updater: (prev: SubagentSessionRecord) => SubagentSessionRecord): SubagentSessionRecord | undefined => {
    const state = cell.read();
    const prev = state.sessions[agentId];
    if (!prev) {
      return undefined;
    }
    const next = updater(prev);
    cell.commit({ ...state, sessions: { ...state.sessions, [agentId]: next } });
    return next;
  };

  return {
    getSession: (agentId: string) => cell.read().sessions[agentId],
    listSessions,
    listActiveSessions: () => listSessions().filter((s) => isActiveSubagentStatus(s.status)),
    upsertSession: (record: SubagentSessionRecord) => {
      const state = cell.read();
      cell.commit({ ...state, sessions: { ...state.sessions, [record.agentId]: record } });
    },
    updateSession,
    appendTranscriptItem: (agentId: string, item: SubagentTranscriptItem) => {
      updateSession(agentId, (prev) => ({ ...prev, transcriptItems: [...prev.transcriptItems, item], updatedAt: item.timestamp }));
    },
  };
}

function withShutdownFailure(prev: SubagentSessionRecord, now: number): SubagentSessionRecord {
  const failureId = prev.failureId ?? createFailureId();
  return { ...prev, status: 'cancelled', currentStep: 'Cancelled', failureId, closedAt: now, updatedAt: now };
}

function restoredSession(record: PersistedSubagentRecord, parentSessionId: string): SubagentSessionRecord {
  const active = isActiveSubagentStatus(record.status);
  const failureId = active ? (record.failureId ?? createFailureId()) : record.failureId;
  return {
    ...record,
    status: active ? 'cancelled' : record.status,
    parentSessionId,
    attempts: record.attempts ?? ONE,
    maxAttempts: record.maxAttempts ?? ONE,
    checkpoints: record.checkpoints ?? [],
    transcriptItems: record.transcriptItems ?? [],
    ...(failureId !== undefined ? { failureId } : {}),
  };
}

function buildRunOps(cell: StoreCell) {
  const clearActiveRun = (agentId: string): void => {
    const state = cell.read();
    if (state.activeRuns[agentId] !== undefined) {
      cell.commit({ ...state, activeRuns: omitKey(state.activeRuns, agentId) });
    }
  };
  return {
    registerActiveRun: (handle: ActiveRunHandle) => {
      const state = cell.read();
      const nextSuppressed = state.suppressedWakeupIds.filter((id) => id !== handle.agentId);
      cell.commit({ ...state, activeRuns: { ...state.activeRuns, [handle.agentId]: handle }, suppressedWakeupIds: nextSuppressed });
    },
    getActiveRun: (agentId: string) => cell.read().activeRuns[agentId],
    clearActiveRun,
    isRunBusy: (agentId: string) => cell.read().activeRuns[agentId] !== undefined,
    listForegroundRuns: () => Object.values(cell.read().activeRuns).filter((run) => !run.isBackground && run.requestBackground !== undefined),
    abortRun: (agentId: string) => {
      const state = cell.read();
      const active = state.activeRuns[agentId];
      if (!active) {
        return false;
      }
      const prev = state.sessions[agentId];
      if (prev) {
        const now = Date.now();
        cell.commit({ ...state, sessions: { ...state.sessions, [agentId]: { ...prev, status: 'cancelled', currentStep: 'Cancelled', closedAt: now, updatedAt: now } } });
      }
      active.abort();
      return true;
    },
    abortAllRuns: () => {
      const state = cell.read();
      const runs = Object.values(state.activeRuns);
      const now = Date.now();
      const sessions = { ...state.sessions };
      for (const run of runs) {
        const prev = sessions[run.agentId];
        if (prev) {
          sessions[run.agentId] = withShutdownFailure(prev, now);
        }
      }
      cell.commit({ ...state, sessions, activeRuns: {} });
      for (const run of runs) {
        run.abort();
      }
      return runs.length;
    },
  };
}

function buildWakeupOps(cell: StoreCell) {
  return {
    enqueueWakeup: (payload: BackgroundCompletionPayload) => {
      const state = cell.read();
      if (state.suppressedWakeupIds.includes(payload.taskId) || state.pendingWakeups.some((item) => item.taskId === payload.taskId)) {
        return false;
      }
      cell.commit({ ...state, pendingWakeups: [...state.pendingWakeups, payload] });
      return true;
    },
    drainWakeups: () => {
      const state = cell.read();
      if (state.pendingWakeups.length === ZERO) {
        return [];
      }
      cell.commit({ ...state, pendingWakeups: [] });
      return state.pendingWakeups;
    },
    suppressWakeup: (agentId: string) => {
      const state = cell.read();
      const nextSuppressed = state.suppressedWakeupIds.includes(agentId) ? state.suppressedWakeupIds : [...state.suppressedWakeupIds, agentId];
      cell.commit({ ...state, suppressedWakeupIds: nextSuppressed, pendingWakeups: state.pendingWakeups.filter((item) => item.taskId !== agentId) });
    },
    unsuppressWakeup: (agentId: string) => {
      const state = cell.read();
      if (state.suppressedWakeupIds.includes(agentId)) {
        cell.commit({ ...state, suppressedWakeupIds: state.suppressedWakeupIds.filter((id) => id !== agentId) });
      }
    },
    hasPendingWakeups: () => cell.read().pendingWakeups.length > ZERO,
  };
}

function buildObservabilityOps(cell: StoreCell) {
  const appendCheckpoint = (agentId: string, checkpoint: SubagentCheckpoint): void => {
    const prev = cell.read().sessions[agentId];
    if (!prev) {
      return;
    }
    const next = [...prev.checkpoints, checkpoint].slice(-MAX_CHECKPOINTS);
    cell.commit({ ...cell.read(), sessions: { ...cell.read().sessions, [agentId]: { ...prev, checkpoints: next, updatedAt: checkpoint.at } } });
  };
  return {
    appendCheckpoint,
    withCheckpoint: (agentId: string, options: { readonly transcriptPath?: string | undefined }): SubagentCheckpoint | undefined => {
      const prev = cell.read().sessions[agentId];
      if (!prev) {
        return undefined;
      }
      const last = prev.checkpoints.at(-ONE);
      if (last !== undefined && last.status === prev.status && last.toolCallCount === prev.toolCallCount && last.transcriptItems === prev.transcriptItems.length) {
        return last;
      }
      const checkpoint: SubagentCheckpoint = {
        seq: (last?.seq ?? -ONE) + ONE,
        at: Date.now(),
        status: prev.status,
        toolCallCount: prev.toolCallCount,
        transcriptItems: prev.transcriptItems.length,
        ...(options.transcriptPath !== undefined ? { transcriptPath: options.transcriptPath } : {}),
      };
      appendCheckpoint(agentId, checkpoint);
      return checkpoint;
    },
    markFailure: (agentId: string, code: SubagentFailureCode, message: string): SubagentSessionRecord | undefined => {
      const state = cell.read();
      const prev = state.sessions[agentId];
      if (!prev) {
        return undefined;
      }
      const now = Date.now();
      const next: SubagentSessionRecord = { ...prev, status: 'error', error: message, errorCode: code, failureId: createFailureId(), updatedAt: now, closedAt: now };
      cell.commit({ ...state, sessions: { ...state.sessions, [agentId]: next } });
      return next;
    },
  };
}

export function createSubagentStore(): SubagentStore {
  let state: SubagentStoreState = createEmptyState();
  const cell: StoreCell = {
    read: () => state,
    commit: (next, trackSessions = true) => {
      state = { ...next, dirtyIds: trackSessions ? addedDirtyIds(state, next) : new Set() };
      for (const listener of state.listeners) {
        listener();
      }
    },
  };
  const sessionOps = buildSessionOps(cell);
  const runOps = buildRunOps(cell);
  const wakeupOps = buildWakeupOps(cell);
  const observabilityOps = buildObservabilityOps(cell);

  return {
    ...sessionOps,
    ...runOps,
    ...wakeupOps,
    ...observabilityOps,
    subscribe: (listener) => {
      state = { ...state, listeners: [...state.listeners, listener] };
      return () => {
        state = { ...state, listeners: state.listeners.filter((item) => item !== listener) };
      };
    },
    restoreFromPersisted: (persisted, parentSessionId) => {
      const restored = persisted.sessions.reduce<Record<string, SubagentSessionRecord>>((acc, rec) => ({ ...acc, [rec.agentId]: restoredSession(rec, parentSessionId) }), {});
      cell.commit({ ...state, sessions: restored }, false);
    },
    toPersistedState: (options) => {
      const records = sessionOps.listSessions();
      const recentCompleted = recentCompletedIds(records);
      return { sessions: records.map((record) => toPersistedRecord(record, keepSnapshotTranscript(record, options?.includeTranscriptItems, recentCompleted))) };
    },
    toPersistedPatch: (options) => {
      const dirty = state.dirtyIds;
      const records = sessionOps.listSessions();
      const recentCompleted = recentCompletedIds(records);
      const sessions = records.filter((record) => dirty.has(record.agentId)).map((record) => toPersistedRecord(record, keepSnapshotTranscript(record, options?.includeTranscriptItems, recentCompleted)));
      state = { ...state, dirtyIds: new Set() };
      return { sessions };
    },
    reset: () => {
      runOps.abortAllRuns();
      cell.commit({ ...createEmptyState(), listeners: state.listeners }, false);
    },
  };
}
