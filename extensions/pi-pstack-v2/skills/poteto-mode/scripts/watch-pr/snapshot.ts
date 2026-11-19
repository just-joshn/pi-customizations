import { resolveChecks, resolveReviewThreads } from "./github.ts";
import type * as T from "./types.ts";
import type { CiState, FailedCheck, PendingCheck } from "./types.ts";
import { nonEmpty } from "./types.ts";

const AUTOMATION_TOKENS = [
  "bugbot",
  "security review",
  "pr review automation",
  "review automation",
] as const;

export function assessGitHubMerge(args: {
  readonly mergeStateStatus: T.MergeStateStatus;
  readonly headRollupState: T.RollupState;
}): T.GitHubMergeAssessment {
  const { mergeStateStatus, headRollupState } = args;
  if (mergeStateStatus !== "BLOCKED")
    return {
      kind: "allowed",
      basis: "merge-state",
      mergeStateStatus,
      headRollupState,
    };
  if (headRollupState === "ERROR" || headRollupState === "FAILURE")
    return { kind: "refused", mergeStateStatus, headRollupState };
  return { kind: "allowed", basis: "rollup", mergeStateStatus, headRollupState };
}
async function mergeAssessment(
  reader: T.GitHubReader,
  facts: T.PullRequestFacts
) {
  const commits = await reader.commitRollups(facts.context);
  const headRollupState =
    facts.headRefOid === null
      ? null
      : (commits.find((commit) => commit.oid === facts.headRefOid)?.state ??
        null);
  return {
    hadPreviousPassingCi: commits.some(
      (commit) => commit.oid !== facts.headRefOid && commit.state === "SUCCESS"
    ),
    github: assessGitHubMerge({
      mergeStateStatus: facts.mergeStateStatus,
      headRollupState,
    }),
  };
}
const isFailed = (check: T.Check): check is FailedCheck =>
  check.kind === "failed";
const isPending = (check: T.Check): check is PendingCheck =>
  check.kind === "pending";
type Merge = Awaited<ReturnType<typeof mergeAssessment>>;
function settledCi(
  checks: T.CheckRead,
  merge: Merge,
  failed: T.NonEmpty<FailedCheck> | null,
  pending: T.NonEmpty<PendingCheck> | null
): T.CiState {
  const base = {
    source: checks.source,
    all: checks.checks,
    hadPreviousPassingCi: merge.hadPreviousPassingCi,
  };
  if (failed !== null)
    return {
      ...base,
      kind: "ci-failing",
      failed,
      pending: pending ?? [],
      github: merge.github,
    };
  if (merge.github.kind === "refused")
    return {
      ...base,
      kind: "ci-github-rejected",
      failed: [],
      pending: pending ?? [],
      github: merge.github,
    };
  if (pending !== null)
    return { ...base, kind: "ci-pending", failed: [], pending };
  return {
    ...base,
    kind: "ci-clean",
    failed: [],
    pending: [],
    github: merge.github,
  };
}
const isAutomationRunning = (checks: readonly T.Check[]): boolean =>
  checks.some(
    (check) =>
      check.kind === "pending" &&
      AUTOMATION_TOKENS.some((token) =>
        check.name.toLowerCase().includes(token)
      )
  );
export async function readSnapshot(args: {
  readonly reader: T.GitHubReader;
  readonly context: T.PrContext;
  readonly pendingHistory: "include" | "omit";
  readonly allowDraft: boolean;
}): Promise<T.PrSnapshot> {
  const facts = await args.reader.pullRequest(args.context);
  if (facts.state === "MERGED" || facts.mergedAt !== null)
    return { kind: "merged", context: args.context, facts };
  if (facts.state === "CLOSED")
    return { kind: "closed", context: args.context, facts };
  const threads = await resolveReviewThreads(args.reader, args.context);
  const checks = await resolveChecks(args.reader, args.context);
  const failed = nonEmpty(checks.checks.filter(isFailed));
  const pending = nonEmpty(checks.checks.filter(isPending));
  const omitHistory =
    failed === null && pending !== null && args.pendingHistory === "omit";
  const ci: CiState = omitHistory
    ? {
        kind: "ci-pending",
        source: checks.source,
        all: checks.checks,
        failed: [],
        pending,
        hadPreviousPassingCi: false,
      }
    : settledCi(
        checks,
        await mergeAssessment(args.reader, facts),
        failed,
        pending
      );
  return {
    kind: "open",
    context: args.context,
    facts,
    threads,
    ci,
    reviewAutomationRunning: isAutomationRunning(checks.checks),
  };
}
