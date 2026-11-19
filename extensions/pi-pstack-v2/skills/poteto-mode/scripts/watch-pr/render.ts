import type * as T from "./types.ts";
export const renderJson = (verdict: T.WatcherVerdict): string =>
  `${JSON.stringify(verdict)}\n`;
function ciCell(row: T.PrSnapshot): string {
  if (row.kind !== "open") return "\u2014";
  const was = row.ci.hadPreviousPassingCi ? ", was ✅" : "";
  switch (row.ci.kind) {
    case "ci-clean":
      return "✅";
    case "ci-pending":
      return `⏳ ${row.ci.pending.length} pending${was}`;
    case "ci-failing":
      return `❌ ${row.ci.failed.length} failed${row.ci.pending.length ? `, ${row.ci.pending.length} pending` : ""}${was}`;
    case "ci-github-rejected":
      return `❌ GitHub reports failing checks${was}`;
    default: {
      const exhaustive: never = row.ci;
      return exhaustive;
    }
  }
}
function reviewCell(row: T.PrSnapshot): string {
  if (row.kind !== "open") return "\u2014";
  const open = row.threads.length;
  return row.reviewAutomationRunning
    ? open
      ? `🤖 running, ${open} open`
      : "🤖 running"
    : open
      ? `📝 ${open} open`
      : "✅";
}
function mergeCell(row: T.PrSnapshot): string {
  if (row.kind === "merged") return "✅ merged";
  if (row.kind === "closed") return "❌ closed";
  if (row.facts.isDraft) return "⏸ draft";
  if (row.facts.reviewDecision === "CHANGES_REQUESTED")
    return "⚠️ changes requested";
  return row.facts.mergeable === "CONFLICTING" ||
    row.facts.mergeStateStatus === "DIRTY" ||
    row.facts.mergeStateStatus === "CONFLICTING"
    ? "⚠️ conflict"
    : "✅";
}
const statusRow = (row: T.PrSnapshot): string => {
  const { owner, repo, number } = row.context;
  const url = `https://github.com/${owner}/${repo}/pull/${number}`;
  return `| [#${number}](${url}) | ${ciCell(row)} | ${reviewCell(row)} | ${mergeCell(row)} |`;
};
export function renderStatusTable(rows: T.NonEmpty<T.PrSnapshot>): string {
  const lines = [
    "| PR | CI | Review | Merge |",
    "| --- | --- | --- | --- |",
    ...rows.map(statusRow),
  ];
  return `${lines.join("\n")}\n`;
}
function threadLine(thread: T.ReviewThread): string {
  const comment = thread.firstComment;
  return [
    thread.id,
    comment?.path ?? "None",
    comment?.line ?? "None",
    comment?.authorLogin ?? "None",
    `isBugBot=${thread.isBugbot}`,
    `bugbotReviewPasses=${thread.bugbotReviewPasses}`,
    (comment?.body ?? "").split(/\r?\n/, 1)[0]?.slice(0, COMMENT_SUMMARY_MAX_CHARS) ?? "",
  ].join(" ");
}
const COMMENT_SUMMARY_MAX_CHARS = 180;
type StatusQueryBlocker = {
  readonly kind: "status-query";
  readonly failures: number;
  readonly failure: { readonly detail: string };
};
const MERGE_GATE_ACTIONS = {
  "closed-without-merge":
    "restore or remove the closed PR from the queued stack",
  "draft-pr":
    "mark the PR ready for review before waiting for the merge queue",
  "changes-requested":
    "resolve the changes-requested review before waiting for the merge queue",
} as const satisfies Record<T.MergeGateReason, string>;
const renderConflicts = (
  blocker: Extract<T.MergeBlocker, { readonly kind: "merge-conflicts" }>
): string =>
  [
    "BLOCKER: merge-conflicts",
    `pr=${blocker.pr.number}`,
    `mergeable=${blocker.facts.mergeable}`,
    `mergeStateStatus=${blocker.facts.mergeStateStatus}`,
    "action=resolve merge conflicts before waiting for CI",
  ].join("\n");
const renderThreads = (
  blocker: Extract<T.MergeBlocker, { readonly kind: "review-threads" }>
): string =>
  [
    "BLOCKER: review-threads",
    `pr=${blocker.pr.number}`,
    `unresolved=${blocker.threads.length}`,
    ...blocker.threads.map(threadLine),
  ].join("\n");
const rejectionLines = (ci: T.CiGithubRejected): string[] => [
  `mergeStateStatus=${ci.github.mergeStateStatus}`,
  `headRollupState=${ci.github.headRollupState}`,
];
function renderFailingChecks(
  blocker: Extract<T.MergeBlocker, { readonly kind: "failing-checks" }>
): string {
  const failed = blocker.ci.kind === "ci-failing" ? blocker.ci.failed : [];
  const checkDetails = failed.map(
    (check) =>
      `${check.name} ${check.reportedState} ${check.description} ${check.link}`
  );
  const rejection = blocker.ci.kind === "ci-github-rejected" ? rejectionLines(blocker.ci) : [];
  return [
    "BLOCKER: failing-checks",
    `pr=${blocker.pr.number}`,
    `failed=${failed.length}`,
    ...checkDetails,
    ...rejection,
  ].join("\n");
}
const renderMergeGate = (
  blocker: Extract<T.MergeBlocker, { readonly kind: "merge-gate" }>
): string =>
  [
    `BLOCKER: ${blocker.reason}`,
    `pr=${blocker.pr.number}`,
    `action=${MERGE_GATE_ACTIONS[blocker.reason]}`,
  ].join("\n");
const renderStatusQuery = (blocker: StatusQueryBlocker): string =>
  [
    "BLOCKER: status-query",
    `failures=${blocker.failures}`,
    `detail=${blocker.failure.detail}`,
    "action=verify current PR context, GitHub authentication, and API availability, then rearm",
  ].join("\n");
function renderBlocker(blocker: T.MergeBlocker | StatusQueryBlocker): string {
  switch (blocker.kind) {
    case "merge-conflicts":
      return renderConflicts(blocker);
    case "review-threads":
      return renderThreads(blocker);
    case "failing-checks":
      return renderFailingChecks(blocker);
    case "merge-gate":
      return renderMergeGate(blocker);
    case "status-query":
      return renderStatusQuery(blocker);
    default: {
      const exhaustive: never = blocker;
      return exhaustive;
    }
  }
}
const DRAFT_NOTE =
  "\nnote=draft allowed (--allow-draft); leave draft \u2014 do not mark ready";
function readyDetail(scope: T.ReadyScope): string {
  if (scope.kind !== "single" || scope.pr.kind !== "ready-pr") return "";
  const { proof } = scope.pr;
  const draftAllowed = proof.gate.draft === "draft-allowed";
  return `\nmergeStateStatus=${proof.ci.github.mergeStateStatus}\nreviewDecision=${proof.gate.reviewDecision}\nisDraft=${draftAllowed}${draftAllowed ? DRAFT_NOTE : ""}`;
}
export function renderPretty(verdict: T.WatcherVerdict): string {
  switch (verdict.kind) {
    case "QUEUE":
      return `QUEUE: captured ${verdict.queue.length} PR${verdict.queue.length === 1 ? "" : "s"} bottom-to-top: ${verdict.queue.map((pr) => `#${pr.number}`).join(",")}\n`;
    case "STATUS":
      return renderStatusTable(verdict.rows);
    case "WAITING":
      return verdict.reason.kind === "pending-checks"
        ? `WAITING: frontier=#${verdict.frontier.number}; ${verdict.reason.pending.length} check${verdict.reason.pending.length === 1 ? "" : "s"} pending\n`
        : `WAITING: frontier=#${verdict.frontier.number} is blocker-free; waiting for merge queue (${verdict.reason.unmergedCount} PR${verdict.reason.unmergedCount === 1 ? "" : "s"} unmerged)\n`;
    case "ADVANCE":
      return `ADVANCE: merged #${verdict.merged.number}; next=#${verdict.frontier.number}; remaining=${verdict.remaining}\n`;
    case "RETRY":
      return `RETRY: GitHub status query failed; retrying in ${verdict.retryInSeconds}s\ndetail=${verdict.failure.detail}\n`;
    case "BLOCKER":
      return `${renderBlocker(verdict.blocker)}\n`;
    case "READY": {
      return `READY: no merge conflicts, no unresolved review threads, no failing or pending checks${readyDetail(verdict.scope)}\n`;
    }
    case "COMPLETE":
      return `COMPLETE: queued stack merged (${verdict.queue.length} PR${verdict.queue.length === 1 ? "" : "s"})\n`;
    case "TIMEOUT":
      if (verdict.reason.kind === "pending-checks")
        return "TIMEOUT: checks still pending\n";
      if (verdict.reason.kind === "status-unavailable")
        return "TIMEOUT: GitHub status remained unavailable\n";
      return `TIMEOUT: queued stack still has ${verdict.reason.unmergedCount} PR${verdict.reason.unmergedCount === 1 ? "" : "s"} unmerged; frontier=#${verdict.reason.frontier.number}\n`;
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
}
