import { describe, expect, test } from "bun:test";
import {
  GH_TARGET,
  NO_RETRIES,
  commitsPage,
  exit,
  json,
  rawPr,
  useGhCli,
} from "./gh.test-helper.ts";
import { get } from "./output.test-helper.ts";

const cli = useGhCli();
const EXIT_CONFLICTS = 2;
const EXIT_FAILING_CHECKS = 4;
const EXIT_STATUS_QUERY = 7;
const NOT_A_STRING = 5;
const PR_VIEW_COMMAND =
  "gh pr view 42 --repo owner/repo --json mergeable,mergeStateStatus,reviewDecision,headRefOid,headRefName,baseRefName,state,mergedAt,isDraft";
const oneQueryFailure = [...GH_TARGET, ...NO_RETRIES];
const viewing = (overrides: Record<string, unknown>) => ({ pullRequest: () => json(rawPr(overrides)) });
const blockedBy = (state: string | null, ...others: readonly string[]) => ({
  pullRequest: () => json(rawPr({ mergeStateStatus: "BLOCKED" })),
  commits: () => json(commitsPage([...others.map((oid) => [oid, "SUCCESS"] as const), ["head", state]])),
});

describe("pull request facts", () => {
  test("asks gh for exactly the fields the watcher decides on", async () => {
    const run = await cli.run(GH_TARGET);
    expect(run.commands[0]).toBe(PR_VIEW_COMMAND);
  });

  test("blocks on mergeStateStatus CONFLICTING", async () => {
    const run = await cli.run(GH_TARGET, viewing({ mergeStateStatus: "CONFLICTING" }));
    expect(run.code).toBe(EXIT_CONFLICTS);
    expect(get(run.lines[0], "blocker.kind")).toBe("merge-conflicts");
  });

  test("reads gh's empty reviewDecision as no decision, not a parse failure", async () => {
    const run = await cli.run(GH_TARGET, viewing({ reviewDecision: "" }));
    expect(run.code).toBe(0);
    expect(get(run.lines[0], "scope.pr.proof.gate.reviewDecision")).toBeNull();
  });

  test("accepts a null head commit and a null review decision", async () => {
    const run = await cli.run(GH_TARGET, viewing({ headRefOid: null, reviewDecision: null }));
    expect(run.code).toBe(0);
  });
});

const UNKNOWN_VALUES: readonly (readonly [string, Record<string, unknown>, string])[] = [
  ["an unknown reviewDecision", { reviewDecision: "MAYBE" }, '"MAYBE"'],
  ["an unknown mergeStateStatus", { mergeStateStatus: "FUTURE_STATE" }, '"FUTURE_STATE"'],
  ["an unknown mergeable value", { mergeable: "SOMETIMES" }, '"SOMETIMES"'],
  ["an unknown state", { state: "ARCHIVED" }, '"ARCHIVED"'],
];
const BAD_FIELDS: readonly (readonly [string, Record<string, unknown>, string])[] = [
  ["a non-boolean isDraft", { isDraft: "no" }, "pull request.isDraft"],
  ["a missing headRefName", { headRefName: undefined }, "pull request.headRefName"],
  ["a non-string mergedAt", { mergedAt: NOT_A_STRING }, "pull request.mergedAt"],
];

describe("malformed pull request facts", () => {
  test.each(UNKNOWN_VALUES)("%s is a retryable error carrying the raw value", async (_name, overrides, rawValue) => {
    const run = await cli.run(oneQueryFailure, viewing(overrides));
    expect(run.code).toBe(EXIT_STATUS_QUERY);
    expect(get(run.lines[0], "blocker.kind")).toBe("status-query");
    expect(get(run.lines[0], "blocker.failure.kind")).toBe("missing-key");
    expect(get(run.lines[0], "blocker.failure.retryable")).toBe(true);
    expect(get(run.lines[0], "blocker.failure.rawValue")).toBe(rawValue);
  });

  test.each(BAD_FIELDS)("%s is rejected naming the field", async (_name, overrides, field) => {
    const run = await cli.run(oneQueryFailure, viewing(overrides));
    expect(get(run.lines[0], "blocker.failure.detail")).toContain(field);
  });

  test("a response that is not a JSON object is rejected", async () => {
    const run = await cli.run(oneQueryFailure, { pullRequest: () => json([]) });
    expect(get(run.lines[0], "blocker.failure.kind")).toBe("missing-key");
    expect(get(run.lines[0], "blocker.failure.detail")).toContain("pull request");
  });
});

describe("gh failures", () => {
  test("invalid JSON is a json-parse failure", async () => {
    const run = await cli.run(oneQueryFailure, { pullRequest: () => ({ stdout: "<html>" }) });
    expect(get(run.lines[0], "blocker.failure.kind")).toBe("json-parse");
    expect(get(run.lines[0], "blocker.failure.retryable")).toBe(true);
  });

  test("a non-zero exit carries the first line of gh's stderr", async () => {
    const run = await cli.run(oneQueryFailure, { pullRequest: () => exit(1, "HTTP 502: bad gateway\nrequest id abc") });
    expect(run.code).toBe(EXIT_STATUS_QUERY);
    expect(get(run.lines[0], "blocker.failures")).toBe(1);
    expect(get(run.lines[0], "blocker.failure.kind")).toBe("command-exit");
    expect(get(run.lines[0], "blocker.failure.code")).toBe(1);
    expect(get(run.lines[0], "blocker.failure.detail")).toBe("HTTP 502: bad gateway");
  });

  test("a non-zero exit with no stderr names the command", async () => {
    const run = await cli.run(oneQueryFailure, { pullRequest: () => exit(1) });
    expect(get(run.lines[0], "blocker.failure.detail")).toBe(`${PR_VIEW_COMMAND} exited 1`);
  });

  test("a gh binary that cannot be started crashes the watcher", async () => {
    const missing = new Error("spawn gh ENOENT");
    const attempt = cli.run(GH_TARGET, { pullRequest: () => ({ error: missing }) });
    await expect(attempt).rejects.toThrow("spawn gh ENOENT");
  });
});

describe("commit rollups", () => {
  test("a clean check list with a failing head rollup is a CI blocker", async () => {
    const run = await cli.run(GH_TARGET, blockedBy("FAILURE", "old"));
    expect(run.code).toBe(EXIT_FAILING_CHECKS);
    expect(get(run.lines[0], "blocker.ci.kind")).toBe("ci-github-rejected");
    expect(get(run.lines[0], "blocker.ci.hadPreviousPassingCi")).toBe(true);
  });

  test("a head commit without a status rollup is not a refusal", async () => {
    const run = await cli.run(GH_TARGET, blockedBy(null));
    expect(run.code).toBe(0);
  });

  test("an unknown rollup state is rejected with its raw value", async () => {
    const run = await cli.run(oneQueryFailure, { commits: () => json(commitsPage([["head", "FUTURE"]])) });
    expect(get(run.lines[0], "blocker.failure.rawValue")).toBe('"FUTURE"');
  });
});
