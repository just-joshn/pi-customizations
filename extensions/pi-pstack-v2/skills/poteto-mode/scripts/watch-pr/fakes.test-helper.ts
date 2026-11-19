import type {
  Check,
  ChecksFastPath,
  CommitRollup,
  GitHubReader,
  OpenPullRequest,
  PrContext,
  PullRequestFacts,
  Repository,
  RawReviewThread,
  ReviewThread,
  ReviewThreadPage,
  RollupPage,
} from "./types.ts";
import { createRecorder } from "./recorder.test-helper.ts";
import { parsePrNumber } from "./types.ts";

export interface FakeReaderOptions {
  readonly facts?: Partial<Omit<PullRequestFacts, "context">>;
  readonly fastPath?: ChecksFastPath;
  readonly rollupPages?: readonly RollupPage[];
  readonly threads?: readonly ReviewThread[];
  readonly threadPages?: readonly ReviewThreadPage[];
  readonly commitRollups?: readonly CommitRollup[];
  readonly openPullRequests?: readonly OpenPullRequest[];
  readonly origin?: Repository | null;
  readonly current?: PrContext;
}

function toRawThread(thread: ReviewThread): RawReviewThread {
  return { id: thread.id, firstComment: thread.firstComment, resolved: false };
}

export function passingCheck(name = "ci"): Check {
  return {
    kind: "passed",
    name,
    reportedState: "SUCCESS",
    description: "",
    link: "",
    workflow: "",
  };
}

export function pendingCheck(name = "ci"): Check {
  return {
    kind: "pending",
    name,
    reportedState: "PENDING",
    description: "",
    link: "",
    workflow: "",
  };
}

export function failedCheck(name = "ci"): Check {
  return {
    kind: "failed",
    name,
    reportedState: "FAILURE",
    description: "",
    link: "",
    workflow: "",
  };
}

export function fakeReader(
  options: FakeReaderOptions = {}
): GitHubReader & { readonly calls: readonly string[] } {
  const log = createRecorder<string>();
  const context = options.current ?? {
    owner: "owner",
    repo: "repo",
    number: parsePrNumber(1),
  };
  const defaults: PullRequestFacts = {
    context,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    headRefOid: "head",
    headRefName: "feature",
    baseRefName: "main",
    state: "OPEN",
    mergedAt: null,
    isDraft: false,
  };
  let page = 0;
  let threadPage = 0;
  return {
    get calls() {
      return log.items;
    },
    async originRepo() {
      log.add("originRepo");
      return options.origin === undefined
        ? { owner: "owner", repo: "repo" }
        : options.origin;
    },
    async currentPr(pr) {
      log.add("currentPr");
      return { ...context, number: pr ?? context.number };
    },
    async pullRequest(requested) {
      log.add("pullRequest");
      return { ...defaults, ...options.facts, context: requested };
    },
    async openPullRequests() {
      log.add("openPullRequests");
      return options.openPullRequests ?? [];
    },
    async checksFastPath() {
      log.add("checksFastPath");
      return options.fastPath ?? { kind: "checks", checks: [passingCheck()] };
    },
    async checkRollupPage(_requested, after) {
      log.add(`checkRollupPage:${after ?? "null"}`);
      return options.rollupPages?.[page++] ?? { checks: [], endCursor: null };
    },
    async reviewThreadPage(_requested, after) {
      log.add(`reviewThreadPage:${after ?? "null"}`);
      return options.threadPages?.[threadPage++] ?? {
        threads: (options.threads ?? []).map(toRawThread),
        endCursor: null,
      };
    },
    async commitRollups() {
      log.add("commitRollups");
      return options.commitRollups ?? [{ oid: "head", state: "SUCCESS" }];
    },
  };
}
