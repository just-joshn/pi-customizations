import { WatcherQueryError, enumValue, missing, nullableEnum, optionalString, record, string } from "./github-json.ts";
import type {
  MergeStateStatus,
  PrContext,
  PullRequestFacts,
  Repository,
  ReviewDecision,
} from "./types.ts";
import { parsePrNumber } from "./types.ts";

export const MERGE_STATES = [
  "BEHIND",
  "BLOCKED",
  "CLEAN",
  "CONFLICTING",
  "DIRTY",
  "DRAFT",
  "HAS_HOOKS",
  "UNKNOWN",
  "UNSTABLE",
] as const satisfies readonly MergeStateStatus[];
export const ROLLUP_STATES = [
  "ERROR",
  "EXPECTED",
  "FAILURE",
  "PENDING",
  "SUCCESS",
] as const;
const REVIEW_DECISIONS = [
  "APPROVED",
  "CHANGES_REQUESTED",
  "REVIEW_REQUIRED",
] as const;
const MERGEABLE_STATES = ["MERGEABLE", "CONFLICTING", "UNKNOWN"] as const;
const PR_STATES = ["OPEN", "CLOSED", "MERGED"] as const;
const SCP_PREFIX = "git@github.com:";
const SSH_PREFIX = "ssh://git@github.com/";
const GITHUB_HOST = "github.com";

// `gh pr view` reports no review decision as "", not null. Only this field does
// it, so the normalization stays here rather than in nullableEnum, where it
// would stop a genuinely unexpected rollup state from failing closed.
const reviewDecision = (value: unknown): ReviewDecision =>
  nullableEnum(
    value === "" ? null : value,
    REVIEW_DECISIONS,
    "pull request.reviewDecision"
  );
const hasNonCanonicalParts = (url: URL): boolean =>
  url.protocol !== "https:" ||
  url.hostname !== GITHUB_HOST ||
  Boolean(url.port || url.username || url.password || url.search || url.hash);
const toHttps = (value: string): string => {
  if (value.startsWith(SCP_PREFIX))
    return `https://${GITHUB_HOST}/${value.slice(SCP_PREFIX.length)}`;
  if (value.startsWith(SSH_PREFIX))
    return `https://${GITHUB_HOST}/${value.slice(SSH_PREFIX.length)}`;
  return value;
};
export function parseRemote(value: string): Repository | null {
  try {
    const url = new URL(toHttps(value.trim()));
    const parts = url.pathname
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean);
    if (hasNonCanonicalParts(url) || parts.length !== 2) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}
const PULL_URL_PART_COUNT = 4;
function canonicalPullParts(value: string): readonly string[] {
  const url = new URL(value);
  const parts = url.pathname.split("/").filter(Boolean);
  if (hasNonCanonicalParts(url) || parts.length !== PULL_URL_PART_COUNT || parts[2] !== "pull")
    throw new Error("not a canonical GitHub pull URL");
  return parts;
}
export function parsePrUrl(value: string): PrContext {
  try {
    const parts = canonicalPullParts(value);
    return {
      owner: parts[0],
      repo: parts[1],
      number: parsePrNumber(Number(parts[3])),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new WatcherQueryError({
      kind: "invalid-context-url",
      retryable: false,
      rawValue: value,
      detail: `could not infer owner/repo from PR URL: ${value} (${reason})`,
    });
  }
}
export function parsePullRequest(
  value: unknown,
  context: PrContext
): PullRequestFacts {
  const object = record(value, "pull request");
  if (typeof object.isDraft !== "boolean")
    missing("pull request.isDraft", object.isDraft);
  return {
    context,
    mergeable: enumValue(
      object.mergeable,
      MERGEABLE_STATES,
      "pull request.mergeable"
    ),
    mergeStateStatus: enumValue(
      object.mergeStateStatus,
      MERGE_STATES,
      "pull request.mergeStateStatus"
    ),
    reviewDecision: reviewDecision(object.reviewDecision),
    headRefOid: optionalString(object.headRefOid, "pull request.headRefOid"),
    headRefName: string(object.headRefName, "pull request.headRefName"),
    baseRefName: string(object.baseRefName, "pull request.baseRefName"),
    state: enumValue(object.state, PR_STATES, "pull request.state"),
    mergedAt: optionalString(object.mergedAt, "pull request.mergedAt"),
    isDraft: object.isDraft,
  };
}
