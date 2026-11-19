import { spawn } from "node:child_process";
import { parseFastCheck, mapRollupNode } from "./github-checks.ts";
import {
  ChecksUnavailable,
  WatcherQueryError,
  at,
  firstLine,
  list,
  missing,
  nullableEnum,
  optionalString,
  parseJson,
  record,
  string,
} from "./github-json.ts";
import { parsePrUrl, parsePullRequest, parseRemote, ROLLUP_STATES } from "./github-pr.ts";
import {
  PR_CHECK_ROLLUP_QUERY,
  PR_COMMIT_STATUS_QUERY,
  REVIEW_THREADS_QUERY,
  graphqlArgs,
} from "./github-queries.ts";
import { buildReviewThreads, parseReviewThreadPage } from "./github-review.ts";
import { orderStack } from "./github-stack.ts";
import type * as T from "./types.ts";
import type { ChecksFastPath, RollupState } from "./types.ts";
import { nonEmpty, parsePrNumber } from "./types.ts";

export {
  PR_CHECK_ROLLUP_QUERY,
  PR_COMMIT_STATUS_QUERY,
  REVIEW_THREADS_QUERY,
} from "./github-queries.ts";
export { ChecksUnavailable, WatcherQueryError } from "./github-json.ts";
export { mapRollupNode, parseFastCheck } from "./github-checks.ts";
export { parsePullRequest } from "./github-pr.ts";
export { buildReviewThreads, parseReviewThreadPage } from "./github-review.ts";
export { orderStack } from "./github-stack.ts";

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}
type Argv = readonly [string, ...string[]];
const GH_CHECKS_PENDING_EXIT_CODE = 8;
const FAST_PATH_EXIT_CODES = [0, 1, GH_CHECKS_PENDING_EXIT_CODE];
const PR_LIST_LIMIT = "300";
const PR_VIEW_FIELDS =
  "mergeable,mergeStateStatus,reviewDecision,headRefOid,headRefName,baseRefName,state,mergedAt,isDraft";

function run(argv: Argv): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}
async function runJson(argv: Argv): Promise<unknown> {
  const result = await run(argv);
  if (result.code !== 0)
    throw new WatcherQueryError({
      kind: "command-exit",
      retryable: true,
      code: result.code,
      detail:
        firstLine(result.stderr) || `${argv.join(" ")} exited ${result.code}`,
    });
  return parseJson(result.stdout, argv.join(" "));
}
const repoSlug = (context: T.Repository): string =>
  `${context.owner}/${context.repo}`;
const withAfter = (argv: Argv, after: string | null): Argv =>
  after === null ? argv : [...argv, "-f", `after=${after}`];
function parseOpenPullRequest(
  item: unknown,
  index: number
): T.OpenPullRequest {
  const label = `open PRs[${index}]`;
  const object = record(item, label);
  if (typeof object.isCrossRepository !== "boolean")
    missing(`${label}.isCrossRepository`, object.isCrossRepository);
  return {
    isCrossRepository: object.isCrossRepository,
    number: parsePrNumber(object.number, `${label}.number`),
    headRefName: string(object.headRefName, `${label}.headRefName`),
    baseRefName: string(object.baseRefName, `${label}.baseRefName`),
  };
}
function parsePageInfo(
  page: Record<string, unknown>,
  label: string
): string | null {
  if (typeof page.hasNextPage !== "boolean")
    missing(`${label}.hasNextPage`, page.hasNextPage);
  const cursor = optionalString(page.endCursor, `${label}.endCursor`);
  return page.hasNextPage && cursor ? cursor : null;
}
function parseRollupPage(value: unknown): T.RollupPage {
  const commits = list(
    at(value, ["data", "repository", "pullRequest", "commits", "nodes"]),
    "commits.nodes"
  );
  if (commits.length === 0) return { checks: [], endCursor: null };
  const commit = record(at(commits[commits.length - 1], ["commit"]), "commit");
  if (commit.statusCheckRollup === null) return { checks: [], endCursor: null };
  const contexts = record(
    at(commit, ["statusCheckRollup", "contexts"]),
    "contexts"
  );
  const checks = list(contexts.nodes, "contexts.nodes")
    .map(mapRollupNode)
    .filter(isCheck);
  const page = record(contexts.pageInfo, "contexts.pageInfo");
  return { checks, endCursor: parsePageInfo(page, "contexts.pageInfo") };
}
function isCheck(check: T.Check | null): check is T.Check {
  return check !== null;
}
const parseRollupState = (rollup: unknown, index: number): RollupState =>
  rollup === null
    ? null
    : nullableEnum(
        at(rollup, ["state"]),
        ROLLUP_STATES,
        `commits[${index}].statusCheckRollup.state`
      );
function parseCommitRollup(item: unknown, index: number): T.CommitRollup {
  const commit = record(at(item, ["commit"]), `commits[${index}].commit`);
  return {
    oid: string(commit.oid, `commits[${index}].oid`),
    state: parseRollupState(commit.statusCheckRollup, index),
  };
}

export class GhGitHubReader implements T.GitHubReader {
  async originRepo(): Promise<T.Repository | null> {
    const result = await run(["git", "remote", "get-url", "origin"]);
    return result.code === 0 ? parseRemote(result.stdout) : null;
  }
  async currentPr(pr: T.PrNumber | null): Promise<T.PrContext> {
    const target = pr === null ? [] : [String(pr)];
    const argv: Argv = ["gh", "pr", "view", ...target, "--json", "number,url"];
    const object = record(await runJson(argv), "current PR");
    const parsed = parsePrUrl(string(object.url, "current PR.url"));
    return {
      ...parsed,
      number: pr ?? parsePrNumber(object.number, "current PR.number"),
    };
  }
  async pullRequest(context: T.PrContext): Promise<T.PullRequestFacts> {
    const value = await runJson([
      "gh",
      "pr",
      "view",
      String(context.number),
      "--repo",
      repoSlug(context),
      "--json",
      PR_VIEW_FIELDS,
    ]);
    return parsePullRequest(value, context);
  }
  async openPullRequests(
    repository: T.Repository
  ): Promise<readonly T.OpenPullRequest[]> {
    const value = await runJson([
      "gh",
      "pr",
      "list",
      "--repo",
      repoSlug(repository),
      "--state",
      "open",
      "--limit",
      PR_LIST_LIMIT,
      "--json",
      "number,headRefName,baseRefName,isCrossRepository",
    ]);
    return list(value, "open PRs").map(parseOpenPullRequest);
  }
  async checksFastPath(context: T.PrContext): Promise<T.ChecksFastPath> {
    const result = await run([
      "gh",
      "pr",
      "checks",
      String(context.number),
      "--repo",
      repoSlug(context),
      "--json",
      "name,state,description,link,workflow,bucket",
    ]);
    const unusable: ChecksFastPath = {
      kind: "unusable",
      exitCode: result.code,
      stderr: result.stderr,
    };
    if (!FAST_PATH_EXIT_CODES.includes(result.code) || !result.stdout.trim())
      return unusable;
    try {
      const value = parseJson(result.stdout, "gh pr checks");
      return Array.isArray(value)
        ? { kind: "checks", checks: value.map(parseFastCheck) }
        : unusable;
    } catch (error) {
      if (!(error instanceof WatcherQueryError)) throw error;
      return unusable;
    }
  }
  async checkRollupPage(
    context: T.PrContext,
    after: string | null
  ): Promise<T.RollupPage> {
    const argv = withAfter(graphqlArgs(PR_CHECK_ROLLUP_QUERY, context), after);
    return parseRollupPage(await runJson(argv));
  }
  async reviewThreadPage(
    context: T.PrContext,
    after: string | null
  ): Promise<T.ReviewThreadPage> {
    const argv = withAfter(graphqlArgs(REVIEW_THREADS_QUERY, context), after);
    return parseReviewThreadPage(await runJson(argv));
  }
  async commitRollups(
    context: T.PrContext
  ): Promise<readonly T.CommitRollup[]> {
    const value = await runJson(graphqlArgs(PR_COMMIT_STATUS_QUERY, context));
    const commits = list(
      at(value, ["data", "repository", "pullRequest", "commits", "nodes"]),
      "commits.nodes"
    );
    return commits.map(parseCommitRollup);
  }
}

async function collectPages<Page extends { readonly endCursor: string | null }, Item>(
  fetchPage: (after: string | null) => Promise<Page>,
  itemsOf: (page: Page) => readonly Item[]
): Promise<readonly Item[]> {
  const walk = async (
    after: string | null,
    acc: readonly Item[]
  ): Promise<readonly Item[]> => {
    const page = await fetchPage(after);
    const next = [...acc, ...itemsOf(page)];
    return page.endCursor === null ? next : walk(page.endCursor, next);
  };
  return walk(null, []);
}
export async function resolveChecks(
  reader: T.GitHubReader,
  context: T.PrContext
): Promise<T.CheckRead> {
  const fast = await reader.checksFastPath(context);
  const direct = fast.kind === "checks" ? nonEmpty(fast.checks) : null;
  if (direct !== null) return { source: "gh-pr-checks", checks: direct };
  const checks = await collectPages(
    (after) => reader.checkRollupPage(context, after),
    (page) => page.checks
  );
  const fallback = nonEmpty(checks);
  if (fallback !== null) return { source: "graphql-rollup", checks: fallback };
  const suffix =
    fast.kind === "unusable"
      ? `fast path exit=${fast.exitCode}; GraphQL rollup was empty${firstLine(fast.stderr) ? `; ${firstLine(fast.stderr)}` : ""}`
      : "fast path and GraphQL rollup were empty";
  throw new ChecksUnavailable(`could not read PR checks: ${suffix}`);
}
export async function resolveReviewThreads(
  reader: T.GitHubReader,
  context: T.PrContext
): Promise<readonly T.ReviewThread[]> {
  const threads = await collectPages(
    (after) => reader.reviewThreadPage(context, after),
    (page) => page.threads
  );
  return buildReviewThreads(threads);
}
export async function resolveContext(args: {
  readonly reader: T.GitHubReader;
  readonly owner: string | null;
  readonly repo: string | null;
  readonly pr: T.PrNumber | null;
}): Promise<T.PrContext> {
  if (args.pr !== null && args.owner !== null && args.repo !== null)
    return { owner: args.owner, repo: args.repo, number: args.pr };
  if (args.pr !== null) {
    const origin = await args.reader.originRepo();
    if (origin !== null)
      return {
        owner: args.owner ?? origin.owner,
        repo: args.repo ?? origin.repo,
        number: args.pr,
      };
  }
  const inferred = await args.reader.currentPr(args.pr);
  return {
    owner: args.owner ?? inferred.owner,
    repo: args.repo ?? inferred.repo,
    number: args.pr ?? inferred.number,
  };
}
export async function discoverStack(
  reader: T.GitHubReader,
  context: T.PrContext
): Promise<T.NonEmpty<T.PrContext>> {
  return orderStack(context, await reader.openPullRequests(context));
}
