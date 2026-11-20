import { describe, expect, test } from "bun:test";
import { fakeReader, passingCheck, pendingCheck } from "./fakes.test-helper.ts";
import {
  GH_TARGET,
  exit,
  json,
  rawFastCheck,
  rawPr,
  useGhCli,
  type GhRoutes,
  type GhRun,
} from "./gh.test-helper.ts";
import { runCli, TARGET } from "./harness.test-helper.ts";
import { get, kindsOf } from "./output.test-helper.ts";

const cli = useGhCli();
const EXIT_TIMEOUT = 5;
const EXIT_STATUS_QUERY = 7;
const DEADLINE = ["--timeout", "5"] as const;
const DEADLINE_SECONDS = 5;
const BACKOFF = { first: 60, second: 120, third: 240, capped: 300 } as const;
const BACKOFF_SECONDS = Object.values(BACKOFF);
const FAILURE_COUNTS = BACKOFF_SECONDS.map((_, index) => index + 1);
const LARGE_INTERVAL_SECONDS = 100;
const LARGE_BACKOFF = Object.values({ first: 100, second: 200, third: 300, capped: 300 });
const DEFAULT_ERROR_BUDGET = 5;
const PENDING_READS = 3;
const SECOND_PR = 21;
const DEFAULT_INTERVAL_SECONDS = 60;
const OWNER_REPO = ["--owner", "owner", "--repo", "repo"] as const;
const rateLimited = () => exit(1, "API rate limit exceeded");
const alwaysFailing: GhRoutes = { pullRequest: rateLimited };
const field = (run: GhRun, key: string) => run.lines.map((line) => line[key]);

describe("retrying failed GitHub queries", () => {
  test("backs off 60s, 120s, 240s, then caps at 300s before giving up after five failures", async () => {
    const run = await cli.run(GH_TARGET, alwaysFailing);
    expect(run.code).toBe(EXIT_STATUS_QUERY);
    expect(kindsOf(run.lines)).toEqual(["RETRY", "RETRY", "RETRY", "RETRY", "BLOCKER"]);
    expect(run.sleeps).toEqual(BACKOFF_SECONDS);
    expect(field(run, "retryInSeconds").slice(0, BACKOFF_SECONDS.length)).toEqual(BACKOFF_SECONDS);
    expect(field(run, "consecutiveFailures").slice(0, BACKOFF_SECONDS.length)).toEqual(FAILURE_COUNTS);
    expect(get(run.lines.at(-1), "blocker.failures")).toBe(DEFAULT_ERROR_BUDGET);
  });

  test("never retries sooner than a minute and scales a longer --interval", async () => {
    const run = await cli.run([...GH_TARGET, "--interval", String(LARGE_INTERVAL_SECONDS)], alwaysFailing);
    expect(run.sleeps).toEqual(LARGE_BACKOFF);
  });

  test("gives up after --max-query-errors consecutive failures", async () => {
    const run = await cli.run([...GH_TARGET, "--max-query-errors", "2"], alwaysFailing);
    expect(kindsOf(run.lines)).toEqual(["RETRY", "BLOCKER"]);
    expect(get(run.lines[1], "blocker.failures")).toBe(2);
  });

  test("a successful read resets the consecutive failure count", async () => {
    let views = 0;
    let checkReads = 0;
    const flaky: GhRoutes = {
      pullRequest: () => (++views % 2 === 1 ? rateLimited() : json(rawPr())),
      checks: () => json([rawFastCheck("ci", ++checkReads === 1 ? "pending" : "pass", "PENDING")]),
    };
    const run = await cli.run(GH_TARGET, flaky);
    expect(run.code).toBe(0);
    expect(kindsOf(run.lines)).toEqual(["RETRY", "WAITING", "RETRY", "READY"]);
    expect(field(run, "consecutiveFailures")).toEqual([1, undefined, 1, undefined]);
  });
});

describe("text output while retrying", () => {
  test("prints each retry and the final status-query blocker", async () => {
    const run = await cli.run([...GH_TARGET, "--max-query-errors", "2", "--pretty"], alwaysFailing);
    expect(run.stdout.split("\n")).toEqual([
      "RETRY: GitHub status query failed; retrying in 60s",
      "detail=API rate limit exceeded",
      "BLOCKER: status-query",
      "failures=2",
      "detail=API rate limit exceeded",
      "action=verify current PR context, GitHub authentication, and API availability, then rearm",
      "",
    ]);
  });
});

describe("the --timeout deadline", () => {
  test("caps a pending single PR's sleep at the deadline and exits 5", async () => {
    const reader = fakeReader({ fastPath: { kind: "checks", checks: [pendingCheck()] } });
    const run = await runCli([...TARGET, ...DEADLINE, "--pretty"], reader);
    expect(run.code).toBe(EXIT_TIMEOUT);
    expect(run.clock.sleeps).toEqual([DEADLINE_SECONDS]);
    expect(run.clock.elapsed).toBe(DEADLINE_SECONDS);
    expect(run.stdout.split("\n")).toContain("TIMEOUT: checks still pending");
  });

  test("names the pending checks in the JSON verdict", async () => {
    const reader = fakeReader({ fastPath: { kind: "checks", checks: [pendingCheck("build")] } });
    const run = await runCli([...TARGET, ...DEADLINE], reader);
    expect(kindsOf(run.lines)).toEqual(["WAITING", "WAITING", "TIMEOUT"]);
    expect(get(run.lines[2], "reason.kind")).toBe("pending-checks");
    expect(get(run.lines[2], "reason.pending.0.name")).toBe("build");
  });

  test("also bounds retries of a failing GitHub query", async () => {
    const run = await cli.run([...GH_TARGET, ...DEADLINE], alwaysFailing);
    expect(run.code).toBe(EXIT_TIMEOUT);
    expect(kindsOf(run.lines)).toEqual(["RETRY", "RETRY", "TIMEOUT"]);
    expect(run.sleeps).toEqual([DEADLINE_SECONDS]);
    expect(get(run.lines[2], "reason.kind")).toBe("status-unavailable");
    expect(get(run.lines[2], "reason.failure.detail")).toBe("API rate limit exceeded");
  });

  test("tells a text reader that GitHub stayed unavailable", async () => {
    const run = await cli.run([...GH_TARGET, ...DEADLINE, "--pretty"], alwaysFailing);
    expect(run.stdout.split("\n").at(-2)).toBe("TIMEOUT: GitHub status remained unavailable");
  });

  test("is off by default, so a slow PR is polled at the default interval until it settles", async () => {
    const fastPath = (_pr: unknown, reads: number) => ({
      kind: "checks" as const,
      checks: [reads < PENDING_READS ? pendingCheck() : passingCheck()],
    });
    const run = await runCli(TARGET, fakeReader({ fastPath }));
    expect(run.code).toBe(0);
    expect(run.clock.sleeps).toEqual(Array.from({ length: PENDING_READS }, () => DEFAULT_INTERVAL_SECONDS));
  });
});

describe("a queued stack that loses a read mid-sweep", () => {
  const QUEUE = [...OWNER_REPO, "--queued-stack", "--stack-prs", "20,21,22"] as const;
  const mergedPr = rawPr({ state: "MERGED", mergedAt: "2026-07-26T00:00:00Z" });
  const viewedPrs = (run: GhRun) =>
    run.commands.flatMap((command) => /^gh pr view (\d+) --repo/.exec(command)?.[1] ?? []);

  test("retries after the backoff and resumes at the PR whose read failed", async () => {
    let failedOnce = false;
    const run = await cli.run(QUEUE, {
      pullRequest: ({ number }) => {
        const failNow = number === SECOND_PR && !failedOnce;
        failedOnce = failedOnce || failNow;
        return failNow ? rateLimited() : json(mergedPr);
      },
    });
    expect(run.code).toBe(0);
    expect(kindsOf(run.lines)).toEqual(["QUEUE", "RETRY", "STATUS", "COMPLETE"]);
    expect(viewedPrs(run)).toEqual(["20", "21", "21", "22"]);
    expect(run.sleeps).toEqual([DEFAULT_INTERVAL_SECONDS]);
  });
});
