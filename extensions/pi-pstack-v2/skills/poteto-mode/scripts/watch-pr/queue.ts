import { selectTierMajorStackDecision } from "./classify.ts";
import { deadlinePassed } from "./poll.ts";
import type * as T from "./types.ts";
import type { MergedPr, WaitReason } from "./types.ts";
import { nonEmpty } from "./types.ts";

export type QueueWork =
  | {
      readonly kind: "whole-stack-sweep";
      readonly remaining: T.NonEmpty<T.PrContext>;
    }
  | { readonly kind: "frontier-poll"; readonly frontier: T.PrContext };
export interface QueueState {
  readonly queue: T.NonEmpty<T.PrContext>;
  readonly snapshots: ReadonlyMap<T.PrNumber, T.PrSnapshot>;
  readonly work: QueueWork | null;
  readonly nextSweepAt: number;
  readonly frontier: T.PrContext | null;
  readonly lastWaitKey: string | null;
  readonly startedAt: number;
}
export const createQueueState = (
  queue: T.NonEmpty<T.PrContext>,
  now: number
): QueueState => ({
  queue,
  snapshots: new Map(),
  work: { kind: "whole-stack-sweep", remaining: queue },
  nextSweepAt: now,
  frontier: null,
  lastWaitKey: null,
  startedAt: now,
});
const orderedRows = (state: QueueState): T.PrSnapshot[] =>
  state.queue.flatMap((context) => {
    const row = state.snapshots.get(context.number);
    return row === undefined ? [] : [row];
  });
const activeRows = (state: QueueState): T.PrSnapshot[] =>
  orderedRows(state).filter((row) => row.kind !== "merged");
export function planQueue(state: QueueState, now: number): QueueState {
  if (state.work !== null) return state;
  if (state.snapshots.size === 0 || now >= state.nextSweepAt) {
    const remaining = nonEmpty(
      state.queue.filter(
        (context) => state.snapshots.get(context.number)?.kind !== "merged"
      )
    );
    if (remaining !== null)
      return { ...state, work: { kind: "whole-stack-sweep", remaining } };
  }
  const frontier = activeRows(state)[0]?.context;
  return frontier === undefined
    ? state
    : { ...state, work: { kind: "frontier-poll", frontier } };
}
export interface QueueSnapshotResult {
  readonly state: QueueState;
  readonly completedSweepRows: T.NonEmpty<T.PrSnapshot> | null;
}
export function applyQueueSnapshot(
  state: QueueState,
  snapshot: T.PrSnapshot,
  now: number,
  options: T.PollingOptions
): QueueSnapshotResult {
  if (state.work === null) throw new Error("queue has no read in flight");
  const snapshots = new Map([
    ...state.snapshots,
    [snapshot.context.number, snapshot] as const,
  ]);
  const base = { ...state, snapshots };
  if (state.work.kind === "frontier-poll")
    return { state: { ...base, work: null }, completedSweepRows: null };
  const [head, ...tail] = state.work.remaining;
  if (head.number !== snapshot.context.number)
    throw new Error("snapshot does not match sweep head");
  const remaining = nonEmpty(tail);
  if (remaining !== null)
    return {
      state: { ...base, work: { kind: "whole-stack-sweep", remaining } },
      completedSweepRows: null,
    };
  const rows = nonEmpty(
    state.queue.flatMap((context) => {
      const row = snapshots.get(context.number);
      return row === undefined ? [] : [row];
    })
  );
  if (rows === null || rows.length !== state.queue.length)
    throw new Error("sweep completed without every snapshot");
  return {
    state: { ...base, work: null, nextSweepAt: now + options.sweepInterval },
    completedSweepRows: rows,
  };
}
export type QueueEvaluation =
  | {
      readonly kind: "complete";
      readonly state: QueueState;
      readonly merged: T.NonEmpty<T.MergedPr>;
    }
  | {
      readonly kind: "blocker";
      readonly state: QueueState;
      readonly blocker: T.MergeBlocker;
    }
  | {
      readonly kind: "advance";
      readonly state: QueueState;
      readonly merged: T.PrContext;
      readonly frontier: T.PrContext;
      readonly remaining: number;
    }
  | {
      readonly kind: "timeout";
      readonly state: QueueState;
      readonly frontier: T.PrContext;
      readonly unmergedCount: number;
    }
  | {
      readonly kind: "waiting";
      readonly state: QueueState;
      readonly frontier: T.PrContext;
      readonly reason: T.WaitReason;
      readonly emit: boolean;
    };
const mergedPrs = (state: QueueState): readonly MergedPr[] =>
  orderedRows(state).flatMap((row) => toMergedPr(row));
const toMergedPr = (row: T.PrSnapshot): readonly MergedPr[] =>
  row.kind === "merged"
    ? [{ kind: "merged-pr", context: row.context, mergedAt: row.facts.mergedAt }]
    : [];
function waitingEvaluation(
  state: QueueState,
  frontier: T.PrContext,
  row: T.PrSnapshot,
  unmergedCount: number
): QueueEvaluation {
  const pending =
    row.kind === "open" && row.ci.kind === "ci-pending" ? row.ci.pending : null;
  const reason: WaitReason =
    pending === null
      ? { kind: "merge-queue", unmergedCount }
      : { kind: "pending-checks", pending };
  const key =
    reason.kind === "pending-checks"
      ? `pending:${frontier.number}:${reason.pending.length}`
      : `queue:${frontier.number}:${reason.unmergedCount}`;
  return {
    kind: "waiting",
    state: { ...state, frontier, lastWaitKey: key },
    frontier,
    reason,
    emit: state.lastWaitKey !== key,
  };
}
export function evaluateQueue(
  state: QueueState,
  now: number,
  options: T.PollingOptions
): QueueEvaluation {
  const active = activeRows(state);
  const rows = nonEmpty(active);
  if (rows === null) {
    const merged = nonEmpty(mergedPrs(state));
    if (merged === null) throw new Error("empty queue cannot complete");
    return { kind: "complete", state, merged };
  }
  const decision = selectTierMajorStackDecision(rows, options.allowDraft);
  if (decision.kind === "blocker")
    return { kind: "blocker", state, blocker: decision.blocker };
  const frontier = rows[0].context;
  if (state.frontier !== null && state.frontier.number !== frontier.number)
    return {
      kind: "advance",
      state: { ...state, frontier, lastWaitKey: null },
      merged: state.frontier,
      frontier,
      remaining: active.length,
    };
  if (deadlinePassed(state.startedAt, options, now))
    return {
      kind: "timeout",
      state: { ...state, frontier },
      frontier,
      unmergedCount: active.length,
    };
  return waitingEvaluation(state, frontier, rows[0], active.length);
}
