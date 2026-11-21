import {
  type BackgroundCompletionPayload,
  isActiveSubagentStatus,
  type PersistedSubagentRecord,
  type PersistedSubagentsState,
  type SubagentSessionRecord,
  type SubagentStatus,
  type SubagentTranscriptItem,
  UUID_PATTERN,
  ZERO,
} from './types.ts';

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
  | { readonly status: 'aborted'; readonly error: string; readonly durationMs: number }
  | { readonly status: 'error'; readonly error: string; readonly durationMs: number };

interface SubagentStoreState {
  readonly sessions: Readonly<Record<string, SubagentSessionRecord>>;
  readonly activeRuns: Readonly<Record<string, ActiveRunHandle>>;
  readonly pendingWakeups: readonly BackgroundCompletionPayload[];
  readonly suppressedWakeupIds: readonly string[];
  readonly listeners: readonly (() => void)[];
}

export interface SubagentStore {
  readonly getSession: (agentId: string) => SubagentSessionRecord | undefined;
  readonly listSessions: () => readonly SubagentSessionRecord[];
  readonly listActiveSessions: () => readonly SubagentSessionRecord[];
  readonly upsertSession: (record: SubagentSessionRecord) => void;
  readonly updateSession: (agentId: string, updater: (prev: SubagentSessionRecord) => SubagentSessionRecord) => SubagentSessionRecord | undefined;
  readonly appendTranscriptItem: (agentId: string, item: SubagentTranscriptItem) => void;
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
  readonly restoreFromPersisted: (persisted: PersistedSubagentsState) => void;
  readonly toPersistedState: () => PersistedSubagentsState;
  readonly reset: () => void;
}

function createEmptyState(): SubagentStoreState {
  return { sessions: {}, activeRuns: {}, pendingWakeups: [], suppressedWakeupIds: [], listeners: [] };
}

function omitKey<T>(record: Readonly<Record<string, T>>, keyToOmit: string): Readonly<Record<string, T>> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== keyToOmit));
}

function toPersistedRecord(record: SubagentSessionRecord): PersistedSubagentRecord {
  const status: SubagentStatus = isActiveSubagentStatus(record.status) ? 'cancelled' : record.status;
  return {
    agentId: record.agentId,
    parentSessionId: record.parentSessionId,
    toolCallId: record.toolCallId,
    subagentType: record.subagentType,
    description: record.description,
    prompt: record.prompt,
    ...(record.model !== undefined ? { model: record.model } : {}),
    readonly: record.readonly,
    status,
    isBackground: record.isBackground,
    backgroundReason: record.backgroundReason,
    ...(record.lastMessage !== undefined ? { lastMessage: record.lastMessage } : {}),
    ...(record.error !== undefined ? { error: record.error } : {}),
    toolCallCount: record.toolCallCount,
    ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    ...(record.closedAt !== undefined ? { closedAt: record.closedAt } : {}),
    ...(record.transcriptPath !== undefined ? { transcriptPath: record.transcriptPath } : {}),
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
  readonly commit: (next: SubagentStoreState) => void;
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
      for (const run of runs) {
        run.abort();
      }
      cell.commit({ ...state, activeRuns: {} });
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

export function createSubagentStore(): SubagentStore {
  let state: SubagentStoreState = createEmptyState();
  const cell: StoreCell = {
    read: () => state,
    commit: (next) => {
      state = next;
      for (const listener of state.listeners) {
        listener();
      }
    },
  };
  const sessionOps = buildSessionOps(cell);
  const runOps = buildRunOps(cell);
  const wakeupOps = buildWakeupOps(cell);

  return {
    ...sessionOps,
    ...runOps,
    ...wakeupOps,
    subscribe: (listener) => {
      state = { ...state, listeners: [...state.listeners, listener] };
      return () => {
        state = { ...state, listeners: state.listeners.filter((item) => item !== listener) };
      };
    },
    restoreFromPersisted: (persisted) => {
      const restored = persisted.sessions.reduce<Readonly<Record<string, SubagentSessionRecord>>>((acc, rec) => ({ ...acc, [rec.agentId]: { ...rec, transcriptItems: [] } }), {});
      cell.commit({ ...state, sessions: restored });
    },
    toPersistedState: () => ({ sessions: sessionOps.listSessions().map(toPersistedRecord) }),
    reset: () => {
      runOps.abortAllRuns();
      cell.commit({ ...createEmptyState(), listeners: state.listeners });
    },
  };
}
