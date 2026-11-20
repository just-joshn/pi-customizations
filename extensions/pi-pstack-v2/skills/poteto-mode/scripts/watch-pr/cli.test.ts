import { describe, expect, test } from "bun:test";
import { fakeReader, openPr, passingCheck, pendingCheck, prContext } from "./fakes.test-helper.ts";
import { fakeClock, runCli, TARGET } from "./harness.test-helper.ts";
import { get, kindsOf, pluck } from "./output.test-helper.ts";

const EX_USAGE = 64;
const DEFAULT_INTERVAL_SECONDS = 60;
const CUSTOM_INTERVAL_SECONDS = 2.5;
const OWNER_REPO = ["--owner", "o", "--repo", "r"] as const;
const MERGED = { state: "MERGED", mergedAt: "2026-07-26T00:00:00Z" } as const;
const INFERRED_PR = 9;
const HASH_PR = 7;
const QUEUE_BOTTOM = 10;
const QUEUE_TOP = 12;
const MERGED_LINE_COUNT = 3;

type UsageCase = readonly [name: string, argv: readonly string[], message: string];
const USAGE_CASES: readonly UsageCase[] = [
  ["an unknown option", ["--unknown"], "unknown option '--unknown'"],
  ["a zero interval", ["--interval", "0"], "must be greater than zero"],
  ["a negative sweep interval", ["--sweep-interval", "-1"], "must be greater than zero"],
  ["a negative timeout", ["--timeout", "-1"], "must be zero or greater"],
  ["a fractional error budget", ["--max-query-errors", "1.5"], "must be a positive integer"],
  ["a non-numeric PR", ["--pr", "abc"], "must be a positive integer"],
  ["stack and queued-stack together", ["--stack", "--queued-stack"], "cannot be used with"],
  ["stack PRs outside queued mode", ["--stack-prs", "1,2"], "--stack-prs requires --queued-stack"],
  ["a duplicated stack PR", ["--queued-stack", "--stack-prs", "1,1"], "contains a duplicate PR"],
  ["an empty stack PR entry", ["--queued-stack", "--stack-prs", "1,,2"], "must be a positive integer"],
];

describe("usage errors", () => {
  test.each(USAGE_CASES)("rejects %s with exit 64 on stderr only", async (_name, argv, message) => {
    const run = await runCli(argv);
    expect(run.code).toBe(EX_USAGE);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("error:");
    expect(run.stderr).toContain(message);
    expect(run.reader.calls).toEqual([]);
  });

  test("names the offending option and value", async () => {
    const run = await runCli(["--interval", "0"]);
    expect(run.stderr).toContain("option '--interval <seconds>' argument '0' is invalid");
  });

  test("prints usage on stdout and exits 0 for --help without reading GitHub", async () => {
    const run = await runCli(["--help"]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("JSON (NDJSON while polling)");
    expect(run.stdout).toContain("--queued-stack");
    expect(run.reader.calls).toEqual([]);
  });
});

const pendingThenPassing = () =>
  fakeReader({
    fastPath: (_pr, reads) => ({
      kind: "checks",
      checks: [reads === 0 ? pendingCheck() : passingCheck()],
    }),
  });

describe("polling cadence flags", () => {
  test("polls every 60 seconds by default", async () => {
    const run = await runCli(TARGET, pendingThenPassing());
    expect(run.code).toBe(0);
    expect(run.clock.sleeps).toEqual([DEFAULT_INTERVAL_SECONDS]);
  });

  test("honors --interval", async () => {
    const args = [...TARGET, "--interval", String(CUSTOM_INTERVAL_SECONDS)];
    const run = await runCli(args, pendingThenPassing());
    expect(run.clock.sleeps).toEqual([CUSTOM_INTERVAL_SECONDS]);
  });
});

describe("explicit target flags", () => {
  test("accepts a #-prefixed PR number", async () => {
    const run = await runCli([...OWNER_REPO, "--pr", `#${HASH_PR}`]);
    expect(get(run.lines[0], "scope.pr.context")).toEqual({ owner: "o", repo: "r", number: HASH_PR });
  });

  test("uses every explicit flag without asking git or gh", async () => {
    const run = await runCli(TARGET);
    expect(run.reader.calls).not.toContain("originRepo");
    expect(run.reader.calls).not.toContain("currentPr");
  });

  test("fills the repository from the local origin for an explicit PR", async () => {
    const reader = fakeReader({ origin: { owner: "local", repo: "checkout" } });
    const run = await runCli(["--pr", "5"], reader);
    expect(get(run.lines[0], "scope.pr.context.owner")).toBe("local");
    expect(get(run.lines[0], "scope.pr.context.repo")).toBe("checkout");
    expect(run.reader.calls).not.toContain("currentPr");
  });

  test("lets --owner override the owner taken from the origin", async () => {
    const reader = fakeReader({ origin: { owner: "local", repo: "checkout" } });
    const run = await runCli(["--owner", "fork-owner", "--pr", "5"], reader);
    expect(get(run.lines[0], "scope.pr.context.owner")).toBe("fork-owner");
    expect(get(run.lines[0], "scope.pr.context.repo")).toBe("checkout");
  });
});

describe("inferred target", () => {
  const current = { ...prContext(INFERRED_PR), owner: "inferred", repo: "branch" };

  test("uses the current branch's PR when no PR is given", async () => {
    const run = await runCli([], fakeReader({ current }));
    expect(get(run.lines[0], "scope.pr.context")).toEqual(current);
  });

  test("asks gh for the current PR when git has no usable origin", async () => {
    const run = await runCli(["--pr", "5"], fakeReader({ origin: null }));
    expect(run.reader.calls.slice(0, 2)).toEqual(["originRepo", "currentPr"]);
    expect(run.code).toBe(0);
  });
});

describe("queued stack target", () => {
  test("is seeded from --stack-prs, bottom to top", async () => {
    const reader = fakeReader({ facts: MERGED });
    const args = ["--queued-stack", "--stack-prs", "#10, 11,#12", ...OWNER_REPO];
    const run = await runCli(args, reader);
    expect(kindsOf(run.lines)).toEqual(["QUEUE", "STATUS", "COMPLETE"]);
    expect(pluck(run.lines[0], "queue", "number")).toEqual([QUEUE_BOTTOM, QUEUE_BOTTOM + 1, QUEUE_TOP]);
    expect(run.reader.calls).not.toContain("openPullRequests");
    expect(get(run.lines.at(-1), "merged")).toHaveLength(MERGED_LINE_COUNT);
  });

  test("is discovered from the connected stack without --stack-prs", async () => {
    const open = [openPr(2, "top", "bottom"), openPr(1, "bottom", "main")];
    const reader = fakeReader({ facts: MERGED, openPullRequests: open });
    const run = await runCli(["--queued-stack", ...OWNER_REPO, "--pr", "1"], reader);
    expect(pluck(run.lines[0], "queue", "number")).toEqual([1, 2]);
  });
});

describe("output modes", () => {
  const statusOnly = [...TARGET, "--status-only"];

  test("prints one compact JSON verdict per line by default", async () => {
    const run = await runCli(statusOnly);
    expect(run.code).toBe(0);
    expect(run.stdout.endsWith("\n")).toBe(true);
    expect(run.stdout.trimEnd()).not.toContain("\n");
    expect(run.lines[0]).toMatchObject({ schemaVersion: 1, sequence: 1, mode: "single" });
    expect(run.lines[0]).toMatchObject({ kind: "STATUS", terminal: true, exitCode: 0 });
    expect(run.lines[0]?.observedAt).toBe("2026-07-26T00:00:00.000Z");
  });

  test("renders the same status as a Markdown table with --pretty", async () => {
    const run = await runCli([...statusOnly, "--pretty"]);
    expect(run.code).toBe(0);
    expect(run.stdout.split("\n")).toEqual([
      "| PR | CI | Review | Merge |",
      "| --- | --- | --- | --- |",
      "| [#1](https://github.com/owner/repo/pull/1) | ✅ | ✅ | ✅ |",
      "",
    ]);
  });

  test("bypasses the queue machine for queued-stack --status-only", async () => {
    const args = [...OWNER_REPO, "--queued-stack", "--stack-prs", "1", "--status-only"];
    const run = await runCli(args);
    expect(run.code).toBe(0);
    expect(kindsOf(run.lines)).toEqual(["STATUS"]);
    expect(run.lines[0]).toMatchObject({ mode: "queued-stack", terminal: true, exitCode: 0 });
  });
});

test("an unexpected reader failure crashes the watcher instead of being retried", async () => {
  const reader = {
    ...fakeReader(),
    async pullRequest(): Promise<never> {
      throw new Error("reader exploded");
    },
  };
  await expect(runCli(TARGET, reader, fakeClock())).rejects.toThrow("reader exploded");
});
