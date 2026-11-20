import type {
  Check,
  ChecksFastPath,
  CommitRollup,
  GitHubReader,
  OpenPullRequest,
  PrContext,
  PrNumber,
  PullRequestFacts,
  RawReviewThread,
  Repository,
  ReviewThread,
  ReviewThreadPage,
  RollupPage,
} from "./types.ts";
import { createRecorder } from "./recorder.test-helper.ts";

/** A fixed value, or a function of the PR being read and how many reads of it came before. */
export type PerRead<T extends object> =
  | T
  | ((context: PrContext, previousReads: number) => T);

export type Facts = Partial<Omit<PullRequestFacts, "context">>;

export interface FakeReaderOptions {
  readonly facts?: PerRead<Facts>;
  readonly fastPath?: PerRead<ChecksFastPath>;
  readonly rollupPages?: readonly RollupPage[];
  readonly threads?: PerRead<readonly ReviewThread[]>;
  readonly threadPages?: readonly ReviewThreadPage[];
  readonly commitRollups?: PerRead<readonly CommitRollup[]>;
  readonly openPullRequests?: readonly OpenPullRequest[];
  readonly origin?: Repository | null;
  readonly current?: PrContext;
}

type CheckText = Partial<Pick<Check, "description" | "link" | "workflow">>;

export const prNumber = (value: number): PrNumber => value as PrNumber;
export const prContext = (value: number): PrContext => ({
  owner: "owner",
  repo: "repo",
  number: prNumber(value),
});

const checkBase = (name: string, text: CheckText) => ({
  name,
  description: "",
  link: "",
  workflow: "",
  ...text,
});

export function passingCheck(name = "ci", text: CheckText = {}): Check {
  return { ...checkBase(name, text), kind: "passed", reportedState: "SUCCESS" };
}

export function pendingCheck(name = "ci", text: CheckText = {}): Check {
  return { ...checkBase(name, text), kind: "pending", reportedState: "PENDING" };
}

export function failedCheck(name = "ci", text: CheckText = {}): Check {
  return { ...checkBase(name, text), kind: "failed", reportedState: "FAILURE" };
}

/** Picks a per-PR spec by PR number, with `fallback` for every other PR. */
export const byPr =
  <T extends object>(specs: Readonly<Record<number, T>>, fallback: T): PerRead<T> =>
  (pr) =>
    specs[Number(pr.number)] ?? fallback;

export function reviewThread(id: string, body = "please fix"): ReviewThread {
  const firstComment = { authorLogin: "someone", body, path: "a.ts", line: 1, createdAt: "now" };
  return { id, firstComment, isBugbot: false, bugbotReviewPasses: 0 };
}

export function openPr(
  value: number,
  headRefName: string,
  baseRefName: string,
  isCrossRepository = false
): OpenPullRequest {
  return { number: prNumber(value), headRefName, baseRefName, isCrossRepository };
}

function defaultFacts(context: PrContext): PullRequestFacts {
  return {
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
}

const toRawThread = (thread: ReviewThread): RawReviewThread => ({
  id: thread.id,
  firstComment: thread.firstComment,
  resolved: false,
});

function resolveRead<T extends object>(
  spec: PerRead<T>,
  context: PrContext,
  previousReads: number
): T {
  return typeof spec === "function" ? spec(context, previousReads) : spec;
}

export type FakeReader = GitHubReader & {
  /** Method names in call order. */
  readonly calls: readonly string[];
  /** Like `calls`, with the PR number appended to per-PR reads. */
  readonly reads: readonly string[];
};

type Log = ReturnType<typeof createRecorder<string>>;
type PerPrReads = Pick<
  GitHubReader,
  "pullRequest" | "checksFastPath" | "commitRollups"
>;
type Pages = Pick<
  GitHubReader,
  "checkRollupPage" | "reviewThreadPage" | "openPullRequests"
>;
type Discovery = Pick<GitHubReader, "originRepo" | "currentPr">;

/** Records a per-PR read and returns how many reads of that PR came before it. */
function tracker(log: Log) {
  return (method: string, pr: PrContext): number => {
    const key = `${method}:${pr.number}`;
    const previous = log.items.filter((call) => call === key).length;
    log.record(key);
    return previous;
  };
}

function perPrReads(options: FakeReaderOptions, log: Log): PerPrReads {
  const track = tracker(log);
  const defaults = defaultFacts(options.current ?? prContext(1));
  const passing: ChecksFastPath = { kind: "checks", checks: [passingCheck()] };
  const settled: readonly CommitRollup[] = [{ oid: "head", state: "SUCCESS" }];
  return {
    async pullRequest(pr) {
      const facts = resolveRead(options.facts ?? {}, pr, track("pullRequest", pr));
      return { ...defaults, ...facts, context: pr };
    },
    async checksFastPath(pr) {
      const spec = options.fastPath ?? passing;
      return resolveRead(spec, pr, track("checksFastPath", pr));
    },
    async commitRollups(pr) {
      const spec = options.commitRollups ?? settled;
      return resolveRead(spec, pr, track("commitRollups", pr));
    },
  };
}

function pages(options: FakeReaderOptions, log: Log): Pages {
  let rollup = 0;
  let thread = 0;
  return {
    async openPullRequests() {
      log.record("openPullRequests");
      return options.openPullRequests ?? [];
    },
    async checkRollupPage(_pr, after) {
      log.record(`checkRollupPage:${after ?? "null"}`);
      return options.rollupPages?.[rollup++] ?? { checks: [], endCursor: null };
    },
    async reviewThreadPage(pr, after) {
      log.record(`reviewThreadPage:${after ?? "null"}`);
      const paged = options.threadPages?.[thread++];
      if (paged !== undefined) return paged;
      const threads = resolveRead(options.threads ?? [], pr, 0);
      return { threads: threads.map(toRawThread), endCursor: null };
    },
  };
}

function discovery(options: FakeReaderOptions, log: Log): Discovery {
  const context = options.current ?? prContext(1);
  return {
    async originRepo() {
      log.record("originRepo");
      return options.origin === undefined
        ? { owner: "owner", repo: "repo" }
        : options.origin;
    },
    async currentPr(pr) {
      log.record("currentPr");
      return { ...context, number: pr ?? context.number };
    },
  };
}

export function fakeReader(options: FakeReaderOptions = {}): FakeReader {
  const log = createRecorder<string>();
  return {
    ...discovery(options, log),
    ...perPrReads(options, log),
    ...pages(options, log),
    get calls() {
      return log.items.map((call) => call.replace(/:\d+$/, ""));
    },
    get reads() {
      return log.items;
    },
  };
}
