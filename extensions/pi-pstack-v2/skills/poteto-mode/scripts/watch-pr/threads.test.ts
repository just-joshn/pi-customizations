import { describe, expect, test } from "bun:test";
import {
  GH_TARGET,
  NO_RETRIES,
  json,
  rawComment,
  rawThread,
  threadsPage,
  useGhCli,
  type GhRoutes,
  type GhRun,
} from "./gh.test-helper.ts";
import { get, pluck } from "./output.test-helper.ts";

const cli = useGhCli();
const EXIT_REVIEW_THREADS = 3;
const EXIT_STATUS_QUERY = 7;
const BUGBOT_PASSES = 3;
const TWO_PASSES = 2;
const LONG_COMMENT_CHARS = 200;
const SUMMARY_CHARS = 180;
const FRACTIONAL_LINE = 1.5;
const moreAfter = (endCursor: string) => ({ hasNextPage: true, endCursor });
const human = (body = "please fix") => rawComment(body, "someone", { path: "a.ts", line: 1 });
const bugbot = (runId: string) => rawComment(`RUN_ID: ${runId}`, "bugbot");
const threadCommands = (run: GhRun) =>
  run.commands.filter((command) => command.startsWith("graphql ReviewThreads"));
const threadIds = (run: GhRun) => pluck(run.lines[0], "blocker.threads", "id");
const pagesByCursor = (pages: Readonly<Record<string, unknown>>): GhRoutes => ({
  threads: ({ after }) => json(pages[after ?? "first"]),
});
const onePage = (...nodes: readonly unknown[]): GhRoutes => ({
  threads: () => json(threadsPage(nodes)),
});

describe("unresolved review threads", () => {
  test("block the PR with each thread's first comment", async () => {
    const run = await cli.run(GH_TARGET, onePage(rawThread("t1", false, human("Rename this"), human("reply"))));
    expect(run.code).toBe(EXIT_REVIEW_THREADS);
    expect(get(run.lines[0], "blocker.kind")).toBe("review-threads");
    expect(get(run.lines[0], "blocker.threads.0.firstComment")).toMatchObject({
      authorLogin: "someone",
      body: "Rename this",
      path: "a.ts",
      line: 1,
    });
  });

  test("print one summary line per thread with --pretty", async () => {
    const run = await cli.run([...GH_TARGET, "--pretty"], onePage(
      rawThread("t1", false, human("Rename this\nsecond line")),
      rawThread("t2", false, rawComment("x".repeat(LONG_COMMENT_CHARS), null)),
      rawThread("t3", false),
    ));
    expect(run.stdout.split("\n")).toEqual([
      "BLOCKER: review-threads",
      "pr=42",
      "unresolved=3",
      "t1 a.ts 1 someone isBugBot=false bugbotReviewPasses=0 Rename this",
      `t2 None None None isBugBot=false bugbotReviewPasses=0 ${"x".repeat(SUMMARY_CHARS)}`,
      "t3 None None None isBugBot=false bugbotReviewPasses=0 ",
      "",
    ]);
  });

  test("are ignored once resolved", async () => {
    const run = await cli.run(GH_TARGET, onePage(rawThread("done", true, human())));
    expect(run.code).toBe(0);
  });
});

describe("Bugbot threads", () => {
  const nodes = [
    rawThread("one", false, rawComment("RUN_ID: run-1", "bugbot", { path: "a.ts", line: 1 })),
    rawThread("two", false, rawComment("CURSOR_AUTOMATION_ID: run-2 severity high", "cursor")),
    rawThread("resolved", true, bugbot("run-3")),
  ];

  test("are annotated with distinct review-pass counts, resolved passes included", async () => {
    const run = await cli.run(GH_TARGET, onePage(...nodes));
    expect(run.code).toBe(EXIT_REVIEW_THREADS);
    expect(threadIds(run)).toEqual(["one", "two"]);
    expect(pluck(run.lines[0], "blocker.threads", "isBugbot")).toEqual([true, true]);
    expect(pluck(run.lines[0], "blocker.threads", "bugbotReviewPasses")).toEqual([BUGBOT_PASSES, BUGBOT_PASSES]);
  });

  test("count passes across every page", async () => {
    const run = await cli.run(GH_TARGET, pagesByCursor({
      first: threadsPage([rawThread("one", false, bugbot("run-1"))], moreAfter("next")),
      next: threadsPage([rawThread("two", false, bugbot("run-2"))]),
    }));
    expect(pluck(run.lines[0], "blocker.threads", "bugbotReviewPasses")).toEqual([TWO_PASSES, TWO_PASSES]);
  });
});

type PassCase = readonly [name: string, comment: unknown, passes: number];
const PASS_CASES: readonly PassCase[] = [
  ["a bugbot thread without a run id counts as one pass", rawComment("no id", "cursor-bugbot"), 1],
  ["a human thread is not a Bugbot pass", rawComment("RUN_ID: x", "someone"), 0],
  ["the cursor user needs an automation token to count", rawComment("looks fine", "cursor"), 0],
  ["the cursor user with an automation token counts", rawComment("Description start: bug", "cursor"), 1],
];

describe("Bugbot pass counting", () => {
  test.each(PASS_CASES)("%s", async (_name, comment, passes) => {
    const run = await cli.run(GH_TARGET, onePage(rawThread("t", false, comment)));
    expect(get(run.lines[0], "blocker.threads.0.bugbotReviewPasses")).toBe(passes);
  });
});

describe("review thread pagination", () => {
  test("walks pages until the cursor is exhausted", async () => {
    const run = await cli.run(GH_TARGET, pagesByCursor({
      first: threadsPage([rawThread("one", false, human())], moreAfter("next")),
      next: threadsPage([rawThread("two", false, human())], moreAfter("last")),
      last: threadsPage([rawThread("three", false, human())]),
    }));
    expect(threadIds(run)).toEqual(["one", "two", "three"]);
    expect(threadCommands(run)).toEqual([
      "graphql ReviewThreads pr=42",
      "graphql ReviewThreads pr=42 after=next",
      "graphql ReviewThreads pr=42 after=last",
    ]);
  });

  test("sees an unresolved thread past the first page and drops resolved ones", async () => {
    const run = await cli.run(GH_TARGET, pagesByCursor({
      first: threadsPage([rawThread("early", true, human())], moreAfter("next")),
      next: threadsPage([rawThread("late", false, human()), rawThread("done", true, human())]),
    }));
    expect(threadIds(run)).toEqual(["late"]);
  });

  test("stops after one page when GitHub reports no next page", async () => {
    const run = await cli.run(GH_TARGET, onePage(rawThread("only", false, human())));
    expect(threadCommands(run)).toHaveLength(1);
  });
});

const MALFORMED: readonly (readonly [string, unknown, string])[] = [
  ["a thread without isResolved", { id: "t", comments: { nodes: [] } }, "isResolved"],
  ["a comment with a fractional line", rawThread("t", false, rawComment("x", "a", { path: "a.ts", line: FRACTIONAL_LINE })), "review comment.line"],
  ["a comment without a body", rawThread("t", false, { createdAt: "now", author: null, path: null, line: null }), "review comment.body"],
];

describe("malformed review thread pages", () => {
  test("a page without pageInfo is rejected, not assumed to be the only page", async () => {
    const page = { data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } };
    const run = await cli.run([...GH_TARGET, ...NO_RETRIES], { threads: () => json(page) });
    expect(run.code).toBe(EXIT_STATUS_QUERY);
    expect(get(run.lines[0], "blocker.failure.kind")).toBe("missing-key");
    expect(get(run.lines[0], "blocker.failure.detail")).toContain("pageInfo");
  });

  test.each(MALFORMED)("rejects %s as a query error", async (_name, node, detail) => {
    const run = await cli.run([...GH_TARGET, ...NO_RETRIES], onePage(node));
    expect(run.code).toBe(EXIT_STATUS_QUERY);
    expect(get(run.lines[0], "blocker.failure.detail")).toContain(detail);
  });
});
