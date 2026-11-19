import type * as T from "./types.ts";
import type { MergedPr, ReadyPr } from "./types.ts";
import { nonEmpty } from "./types.ts";

const conflictBlocker = (row: T.PrSnapshot): T.MergeBlocker | null =>
  row.kind === "open" &&
  (row.facts.mergeable === "CONFLICTING" ||
    row.facts.mergeStateStatus === "DIRTY" ||
    row.facts.mergeStateStatus === "CONFLICTING")
    ? { kind: "merge-conflicts", pr: row.context, facts: row.facts }
    : null;
function threadBlocker(row: T.PrSnapshot): T.MergeBlocker | null {
  if (row.kind !== "open") return null;
  const threads = nonEmpty(row.threads);
  return threads === null
    ? null
    : { kind: "review-threads", pr: row.context, threads };
}
const ciBlocker = (row: T.PrSnapshot): T.MergeBlocker | null =>
  row.kind === "open" &&
  (row.ci.kind === "ci-failing" || row.ci.kind === "ci-github-rejected")
    ? { kind: "failing-checks", pr: row.context, ci: row.ci }
    : null;
function gateReason(
  row: T.PrSnapshot,
  allowDraft: boolean
): T.MergeGateReason | null {
  if (row.kind === "merged") return null;
  if (row.kind === "closed") return "closed-without-merge";
  if (row.facts.isDraft && !allowDraft) return "draft-pr";
  return row.facts.reviewDecision === "CHANGES_REQUESTED"
    ? "changes-requested"
    : null;
}
function gateBlocker(
  row: T.PrSnapshot,
  allowDraft: boolean
): T.MergeBlocker | null {
  const reason = gateReason(row, allowDraft);
  return reason === null ||
    (reason === "draft-pr" &&
      row.kind === "open" &&
      row.ci.kind === "ci-pending")
    ? null
    : { kind: "merge-gate", pr: row.context, reason };
}
export function readyContribution(
  row: T.PrSnapshot,
  allowDraft: boolean
): ReadyPr | MergedPr | null {
  if (row.kind === "merged")
    return {
      kind: "merged-pr",
      context: row.context,
      mergedAt: row.facts.mergedAt,
    };
  if (
    row.kind !== "open" ||
    row.ci.kind !== "ci-clean" ||
    row.threads.length !== 0 ||
    conflictBlocker(row) !== null ||
    gateReason(row, allowDraft) !== null
  )
    return null;
  const reviewDecision = row.facts.reviewDecision;
  if (reviewDecision === "CHANGES_REQUESTED") return null;
  return {
    kind: "ready-pr",
    context: row.context,
    proof: {
      mergeability: "clear",
      threads: [],
      ci: row.ci,
      gate: {
        state: "OPEN",
        reviewDecision,
        draft: row.facts.isDraft ? "draft-allowed" : "not-draft",
      },
    },
  };
}
export function classifyPr(
  row: T.PrSnapshot,
  allowDraft = false
): T.PrDecision {
  const blockers = [
    conflictBlocker(row),
    threadBlocker(row),
    ciBlocker(row),
    gateBlocker(row, allowDraft),
  ];
  const blocker = blockers.find((candidate) => candidate !== null);
  if (blocker !== undefined && blocker !== null)
    return { kind: "blocker", blocker };
  if (row.kind === "open" && row.ci.kind === "ci-pending")
    return { kind: "waiting", frontier: row.context, pending: row.ci.pending };
  const ready = readyContribution(row, allowDraft);
  if (ready === null) throw new Error("snapshot has no classified decision");
  return ready.kind === "merged-pr"
    ? { kind: "merged", pr: ready }
    : { kind: "ready", pr: ready };
}
const isContribution = (row: ReadyPr | MergedPr | null): row is ReadyPr | MergedPr =>
  row !== null;
function firstBlocker(
  rows: readonly T.PrSnapshot[],
  tier: (row: T.PrSnapshot) => T.MergeBlocker | null
): T.MergeBlocker | null {
  for (const row of rows) {
    const blocker = tier(row);
    if (blocker !== null) return blocker;
  }
  return null;
}
export function selectTierMajorStackDecision(
  rows: T.NonEmpty<T.PrSnapshot>,
  allowDraft = false
): T.StackDecision {
  const tiers = [
    conflictBlocker,
    threadBlocker,
    ciBlocker,
    (row: T.PrSnapshot) => gateBlocker(row, allowDraft),
  ];
  for (const tier of tiers) {
    const blocker = firstBlocker(rows, tier);
    if (blocker !== null) return { kind: "blocker", blocker };
  }
  for (const row of rows)
    if (row.kind === "open" && row.ci.kind === "ci-pending")
      return {
        kind: "waiting",
        frontier: row.context,
        pending: row.ci.pending,
      };
  const prs = nonEmpty(
    rows
      .map((row) => readyContribution(row, allowDraft))
      .filter(isContribution)
  );
  if (prs === null || prs.length !== rows.length)
    throw new Error("stack has no classified decision");
  return { kind: "clear", prs };
}
