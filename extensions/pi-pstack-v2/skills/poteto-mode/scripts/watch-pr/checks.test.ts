import { describe, expect, test } from "bun:test";
import {
  GH_TARGET,
  NO_RETRIES,
  emptyRollup,
  exit,
  json,
  noCommits,
  rawFastCheck,
  rollupPage,
  useGhCli,
  type GhHandler,
  type GhRoutes,
  type GhRun,
} from "./gh.test-helper.ts";
import { get, pluck } from "./output.test-helper.ts";

const cli = useGhCli();
const FAST_PATH_PENDING_EXIT = 8;
const FAST_PATH_ODD_EXIT = 2;
const EXIT_FAILING_CHECKS = 4;
const EXIT_STATUS_QUERY = 7;
const statusOnly = [...GH_TARGET, "--status-only"];
const oneQueryFailure = [...GH_TARGET, ...NO_RETRIES];
const FAST_PATH_COMMAND =
  "gh pr checks 42 --repo owner/repo --json name,state,description,link,workflow,bucket";
const RUN_URL = "https://ci.example/run";
const LEGACY_URL = "https://ci.example/legacy";
const SKIPPED_URL = "https://ci.example/skipped";
const MORE_PAGES = { hasNextPage: true, endCursor: "next" };

const checkRun = (name: string, status: string, conclusion: string | null, extra = {}) => ({
  __typename: "CheckRun",
  name,
  status,
  conclusion,
  ...extra,
});
const statusContext = (context: string, state: string, extra = {}) => ({
  __typename: "StatusContext",
  context,
  state,
  ...extra,
});
const unusableFastPath: GhRoutes = { checks: () => exit(FAST_PATH_PENDING_EXIT) };
const rollupOf = (...nodes: readonly unknown[]): GhRoutes => ({
  ...unusableFastPath,
  rollup: () => json(rollupPage(nodes)),
});
const graphqlCommands = (run: GhRun) =>
  run.commands.filter((command) => command.startsWith("graphql PrCheckRollup"));
const checkNames = (run: GhRun) => pluck(run.lines[0], "scope.pr.proof.ci.all", "name");

describe("gh pr checks fast path", () => {
  test("is used when it lists checks, with no GraphQL query", async () => {
    const run = await cli.run(GH_TARGET);
    expect(run.code).toBe(0);
    expect(get(run.lines[0], "scope.pr.proof.ci.source")).toBe("gh-pr-checks");
    expect(checkNames(run)).toEqual(["ci"]);
    expect(run.commands).toContain(FAST_PATH_COMMAND);
    expect(graphqlCommands(run)).toEqual([]);
  });

  test("is used while checks are pending, when gh exits 8", async () => {
    const pending = [rawFastCheck("build", "pending", "PENDING")];
    const run = await cli.run(statusOnly, { checks: () => ({ code: FAST_PATH_PENDING_EXIT, stdout: JSON.stringify(pending) }) });
    expect(get(run.lines[0], "rows.0.ci.source")).toBe("gh-pr-checks");
    expect(pluck(run.lines[0], "rows.0.ci.all", "kind")).toEqual(["pending"]);
    expect(graphqlCommands(run)).toEqual([]);
  });

  test("is used when a check failed, when gh exits 1", async () => {
    const failed = [rawFastCheck("lint", "fail", "FAILURE")];
    const run = await cli.run(GH_TARGET, { checks: () => ({ code: 1, stdout: JSON.stringify(failed) }) });
    expect(run.code).toBe(EXIT_FAILING_CHECKS);
    expect(get(run.lines[0], "blocker.ci.source")).toBe("gh-pr-checks");
    expect(graphqlCommands(run)).toEqual([]);
  });

  test("falls back when it printed a valid empty list", async () => {
    const run = await cli.run(GH_TARGET, {
      checks: () => json([]),
      rollup: () => json(rollupPage([checkRun("fallback", "COMPLETED", "SUCCESS")])),
    });
    expect(get(run.lines[0], "scope.pr.proof.ci.source")).toBe("graphql-rollup");
    expect(checkNames(run)).toEqual(["fallback"]);
  });
});

const UNUSABLE_REPLIES: readonly (readonly [string, GhHandler])[] = [
  ["exits with an unexpected code", () => ({ code: FAST_PATH_ODD_EXIT, stdout: "[]" })],
  ["prints nothing", () => ({ stdout: "  \n" })],
  ["prints invalid JSON", () => ({ stdout: "not json" })],
  ["prints a JSON object instead of a list", () => ({ stdout: "{}" })],
  ["prints a check without a name", () => json([{ state: "SUCCESS", bucket: "pass" }])],
];

describe("unusable gh pr checks output", () => {
  test.each(UNUSABLE_REPLIES)("falls back to GraphQL when gh pr checks %s", async (_name, reply) => {
    const run = await cli.run(GH_TARGET, {
      checks: reply,
      rollup: () => json(rollupPage([checkRun("graphql-ci", "COMPLETED", "SUCCESS")])),
    });
    expect(run.code).toBe(0);
    expect(get(run.lines[0], "scope.pr.proof.ci.source")).toBe("graphql-rollup");
  });
});

const rollupPages = (after: string | null) =>
  after === null
    ? rollupPage([checkRun("first", "COMPLETED", "SUCCESS")], MORE_PAGES)
    : rollupPage([checkRun("second", "COMPLETED", "FAILURE")]);

describe("GraphQL rollup pagination", () => {
  test("walks every page and merges the checks", async () => {
    const run = await cli.run(GH_TARGET, { ...unusableFastPath, rollup: ({ after }) => json(rollupPages(after)) });
    expect(run.code).toBe(EXIT_FAILING_CHECKS);
    expect(pluck(run.lines[0], "blocker.ci.all", "name")).toEqual(["first", "second"]);
    expect(pluck(run.lines[0], "blocker.ci.failed", "name")).toEqual(["second"]);
    expect(get(run.lines[0], "blocker.ci.source")).toBe("graphql-rollup");
    expect(graphqlCommands(run)).toEqual([
      "graphql PrCheckRollup pr=42",
      "graphql PrCheckRollup pr=42 after=next",
    ]);
  });

  test("treats a page that claims more but has no cursor as the last page", async () => {
    const lastPage = rollupPage([checkRun("only", "COMPLETED", "SUCCESS")], { hasNextPage: true, endCursor: null });
    const run = await cli.run(GH_TARGET, { ...unusableFastPath, rollup: () => json(lastPage) });
    expect(run.code).toBe(0);
    expect(graphqlCommands(run)).toHaveLength(1);
  });

  test("rejects a page that omits hasNextPage", async () => {
    const page = rollupPage([checkRun("ci", "COMPLETED", "SUCCESS")], { endCursor: null });
    const run = await cli.run(oneQueryFailure, { ...unusableFastPath, rollup: () => json(page) });
    expect(get(run.lines[0], "blocker.failure.kind")).toBe("missing-key");
    expect(get(run.lines[0], "blocker.failure.detail")).toContain("hasNextPage");
  });
});

describe("when no read path yields checks", () => {
  const stderr = "credential cannot read checks\nsecond line";

  test("fails closed and reports why", async () => {
    const run = await cli.run(oneQueryFailure, { checks: () => exit(FAST_PATH_PENDING_EXIT, stderr) });
    expect(run.code).toBe(EXIT_STATUS_QUERY);
    expect(get(run.lines[0], "blocker.failures")).toBe(1);
    expect(get(run.lines[0], "blocker.failure.kind")).toBe("checks-unavailable");
    expect(get(run.lines[0], "blocker.failure.retryable")).toBe(true);
    expect(get(run.lines[0], "blocker.failure.detail")).toBe(
      "could not read PR checks: fast path exit=8; GraphQL rollup was empty; credential cannot read checks"
    );
  });

  test("says both paths were empty when gh pr checks printed an empty list", async () => {
    const run = await cli.run(oneQueryFailure, { checks: () => json([]) });
    expect(get(run.lines[0], "blocker.failure.detail")).toBe(
      "could not read PR checks: fast path and GraphQL rollup were empty"
    );
  });

  test("treats a commit without a status rollup as empty", async () => {
    const run = await cli.run(oneQueryFailure, { ...unusableFastPath, rollup: () => json(emptyRollup()) });
    expect(run.code).toBe(EXIT_STATUS_QUERY);
  });

  test("treats a PR without commits as empty", async () => {
    const run = await cli.run(oneQueryFailure, { ...unusableFastPath, rollup: () => json(noCommits()) });
    expect(run.code).toBe(EXIT_STATUS_QUERY);
  });
});

type RollupCase = readonly [name: string, node: unknown, kind: string, reportedState: string];
const ROLLUP_CASES: readonly RollupCase[] = [
  ["a CheckRun still in progress", checkRun("c", "IN_PROGRESS", null), "pending", "PENDING"],
  ["a successful CheckRun", checkRun("c", "COMPLETED", "SUCCESS"), "passed", "SUCCESS"],
  ["a neutral CheckRun", checkRun("c", "COMPLETED", "NEUTRAL"), "skipped", "NEUTRAL"],
  ["a skipped CheckRun", checkRun("c", "COMPLETED", "SKIPPED"), "skipped", "SKIPPED"],
  ["a CheckRun needing action", checkRun("c", "COMPLETED", "ACTION_REQUIRED"), "failed", "ACTION_REQUIRED"],
  ["a timed-out CheckRun", checkRun("c", "COMPLETED", "TIMED_OUT"), "failed", "FAILURE"],
  ["a CheckRun with a future conclusion", checkRun("c", "COMPLETED", "FUTURE_VALUE"), "failed", "FAILURE"],
  ["an expected StatusContext", statusContext("c", "EXPECTED"), "pending", "PENDING"],
  ["a pending StatusContext", statusContext("c", "PENDING"), "pending", "PENDING"],
  ["a successful StatusContext", statusContext("c", "SUCCESS"), "passed", "SUCCESS"],
  ["a StatusContext with a future state", statusContext("c", "FUTURE_VALUE"), "failed", "FUTURE_VALUE"],
  ["a StatusContext without a state", statusContext("c", ""), "failed", "FAILURE"],
];

describe("rollup check classification", () => {
  test.each(ROLLUP_CASES)("reads %s as %s", async (_name, node, kind, reportedState) => {
    const run = await cli.run(statusOnly, rollupOf(node));
    expect(pluck(run.lines[0], "rows.0.ci.all", "kind")).toEqual([kind]);
    expect(pluck(run.lines[0], "rows.0.ci.all", "reportedState")).toEqual([reportedState]);
  });

  test("drops nodes of a type it does not know", async () => {
    const run = await cli.run(statusOnly, rollupOf({ __typename: "FutureNode", name: "x" }, checkRun("kept", "COMPLETED", "SUCCESS")));
    expect(pluck(run.lines[0], "rows.0.ci.all", "name")).toEqual(["kept"]);
  });

  test("keeps description and link from either rollup shape in --pretty output", async () => {
    const failing = checkRun("run", "COMPLETED", "FAILURE", { description: "boom", detailsUrl: RUN_URL });
    const legacy = statusContext("legacy", "FAILURE", { description: "old", targetUrl: LEGACY_URL });
    const run = await cli.run([...GH_TARGET, "--pretty"], rollupOf(failing, legacy));
    expect(run.code).toBe(EXIT_FAILING_CHECKS);
    expect(run.stdout).toContain(`run FAILURE boom ${RUN_URL}`);
    expect(run.stdout).toContain(`legacy FAILURE old ${LEGACY_URL}`);
  });
});

type FastCase = readonly [name: string, check: unknown, kind: string, reportedState: string];
const FAST_CASES: readonly FastCase[] = [
  ["a failed bucket", rawFastCheck("c", "fail", "FAILURE"), "failed", "FAILURE"],
  ["an errored check in the pending bucket", rawFastCheck("c", "pending", "ERROR"), "failed", "ERROR"],
  ["a pending bucket with lowercase state", rawFastCheck("c", "pending", "pending"), "pending", "PENDING"],
  ["a passing bucket with lowercase state", rawFastCheck("c", "pass", "success"), "passed", "SUCCESS"],
  ["a skipping bucket", rawFastCheck("c", "skipping", "SKIPPED"), "skipped", "SKIPPED"],
  ["an unknown bucket", rawFastCheck("c", "cancel", "CANCELLED"), "failed", "CANCELLED"],
];

describe("gh pr checks classification", () => {
  test.each(FAST_CASES)("reads %s as %s", async (_name, check, kind, reportedState) => {
    const run = await cli.run(statusOnly, { checks: () => json([check]) });
    expect(pluck(run.lines[0], "rows.0.ci.all", "kind")).toEqual([kind]);
    expect(pluck(run.lines[0], "rows.0.ci.all", "reportedState")).toEqual([reportedState]);
  });

  test("keeps description, workflow and link", async () => {
    const extra = { description: "skipped by rule", workflow: "ci.yml", link: SKIPPED_URL };
    const run = await cli.run(statusOnly, { checks: () => json([rawFastCheck("c", "skipping", "SKIPPED", extra)]) });
    expect(get(run.lines[0], "rows.0.ci.all.0")).toMatchObject(extra);
  });
});
