import { describe, expect, test } from "bun:test";
import { fakeReader, passingCheck, pendingCheck, prContext, type FakeReaderOptions } from "./fakes.test-helper.ts";
import { runCli } from "./harness.test-helper.ts";
import { get, kindsOf, pluck, type VerdictLine } from "./output.test-helper.ts";

const PR = { first: 20, second: 21, third: 22, merging: 40, next: 41, sole: 50 } as const;
const EXIT_TIMEOUT = 5;
const INTERVAL_SECONDS = 10;
const DEADLINE_SECONDS = 5;
const SWEEP_SECONDS = 15;
const SECOND_SWEEP_AT = 20;
const LATE_MERGE_READ = 3;
const QUEUE_SIZE = 3;
const MERGED = { state: "MERGED", mergedAt: "2026-07-26T00:00:00Z" } as const;
const QUEUED = ["--owner", "owner", "--repo", "repo", "--queued-stack", "--interval", String(INTERVAL_SECONDS)] as const;
const THREE = [...QUEUED, "--stack-prs", "20,21,22"] as const;
const TWO = [...QUEUED, "--stack-prs", "40,41"] as const;
const DEADLINE = ["--timeout", String(DEADLINE_SECONDS)] as const;

const kindList = (run: { readonly lines: readonly VerdictLine[] }) => kindsOf(run.lines);
const pendingOn = (...numbers: readonly number[]): FakeReaderOptions["fastPath"] =>
  (pr) => ({ kind: "checks", checks: [numbers.includes(Number(pr.number)) ? pendingCheck("build") : passingCheck()] });
/** Each PR reads as merged once it has been read `schedule[number]` times before. */
const mergesAfterReads =
  (schedule: Readonly<Record<number, number>>): FakeReaderOptions["facts"] =>
  (pr, reads) =>
    reads >= (schedule[Number(pr.number)] ?? Number.POSITIVE_INFINITY) ? MERGED : {};
const pullRequestReads = (reads: readonly string[]) => reads.filter((call) => call.startsWith("pullRequest"));

describe("a queued stack waiting on its frontier's checks", () => {
  const options = { fastPath: pendingOn(PR.first) };

  test("captures the queue, sweeps every PR, then times out at the deadline", async () => {
    const run = await runCli([...THREE, ...DEADLINE], fakeReader(options));
    expect(run.code).toBe(EXIT_TIMEOUT);
    expect(kindList(run)).toEqual(["QUEUE", "STATUS", "WAITING", "TIMEOUT"]);
    expect(run.clock.sleeps).toEqual([DEADLINE_SECONDS]);
    expect(pluck(run.lines[0], "queue", "number")).toEqual([PR.first, PR.second, PR.third]);
    expect(get(run.lines[1], "reason")).toBe("whole-stack-sweep");
    expect(pluck(run.lines[1], "rows", "context.number")).toEqual([PR.first, PR.second, PR.third]);
  });

  test("attributes the wait and the timeout to the frontier", async () => {
    const run = await runCli([...THREE, ...DEADLINE], fakeReader(options));
    expect(get(run.lines[2], "frontier.number")).toBe(PR.first);
    expect(get(run.lines[2], "reason.kind")).toBe("pending-checks");
    expect(get(run.lines[3], "reason.kind")).toBe("queued-stack");
    expect(get(run.lines[3], "reason.frontier.number")).toBe(PR.first);
    expect(get(run.lines[3], "reason.unmergedCount")).toBe(QUEUE_SIZE);
  });

  test("prints the same run as text with --pretty", async () => {
    const run = await runCli([...THREE, ...DEADLINE, "--pretty"], fakeReader(options));
    const text = run.stdout.split("\n");
    expect(text[0]).toBe("QUEUE: captured 3 PRs bottom-to-top: #20,#21,#22");
    expect(text).toContain("WAITING: frontier=#20; 1 check pending");
    expect(text).toContain("TIMEOUT: queued stack still has 3 PRs unmerged; frontier=#20");
  });

  test("waits on the merge queue when only an upstack PR has pending checks", async () => {
    const run = await runCli([...THREE, ...DEADLINE, "--pretty"], fakeReader({ fastPath: pendingOn(PR.second) }));
    expect(run.stdout).toContain("WAITING: frontier=#20 is blocker-free; waiting for merge queue (3 PRs unmerged)");
  });

  test("does not read commit rollups for a PR whose checks are still pending", async () => {
    const reader = fakeReader(options);
    await runCli([...THREE, ...DEADLINE], reader);
    const rollups = reader.reads.filter((call) => call.startsWith("commitRollups"));
    expect(rollups).toEqual(["commitRollups:21", "commitRollups:22"]);
  });
});

describe("a queued stack making progress", () => {
  test("ADVANCE continues straight to the new frontier, then COMPLETE", async () => {
    const reader = fakeReader({ facts: mergesAfterReads({ [PR.merging]: 1, [PR.next]: 2 }) });
    const run = await runCli(TWO, reader);
    expect(run.code).toBe(0);
    expect(kindList(run)).toEqual(["QUEUE", "STATUS", "WAITING", "ADVANCE", "WAITING", "COMPLETE"]);
    expect(run.clock.sleeps).toEqual([INTERVAL_SECONDS, INTERVAL_SECONDS]);
    expect(pullRequestReads(reader.reads)).toEqual([
      "pullRequest:40", "pullRequest:41", "pullRequest:40", "pullRequest:41", "pullRequest:41",
    ]);
  });

  test("ADVANCE names the merged PR, the new frontier and what remains", async () => {
    const run = await runCli([...TWO, "--pretty"], fakeReader({ facts: mergesAfterReads({ [PR.merging]: 1, [PR.next]: 2 }) }));
    expect(run.stdout).toContain("ADVANCE: merged #40; next=#41; remaining=1");
    expect(run.stdout).toContain("WAITING: frontier=#41 is blocker-free; waiting for merge queue (1 PR unmerged)");
    expect(run.stdout.endsWith("COMPLETE: queued stack merged (2 PRs)\n")).toBe(true);
  });

  test("COMPLETE lists the merged PRs in queue order", async () => {
    const run = await runCli(THREE, fakeReader({ facts: MERGED }));
    expect(kindList(run)).toEqual(["QUEUE", "STATUS", "COMPLETE"]);
    expect(pluck(run.lines[2], "merged", "context.number")).toEqual([PR.first, PR.second, PR.third]);
    expect(run.clock.sleeps).toEqual([]);
  });

  test("numbers every verdict in sequence with the queued-stack mode", async () => {
    const run = await runCli(TWO, fakeReader({ facts: mergesAfterReads({ [PR.merging]: 1, [PR.next]: 2 }) }));
    const sequences = run.lines.map((line) => line.sequence);
    expect(sequences).toHaveLength(kindList(run).length);
    expect(sequences).toEqual(sequences.map((_, index) => index + 1));
    expect(new Set(run.lines.map((line) => line.mode))).toEqual(new Set(["queued-stack"]));
  });

  test("uses singular wording for a one-PR queue", async () => {
    const args = [...QUEUED, "--stack-prs", String(PR.sole), "--pretty"];
    const run = await runCli(args, fakeReader({ facts: MERGED }));
    expect(run.stdout).toContain("QUEUE: captured 1 PR bottom-to-top: #50");
    expect(run.stdout).toContain("COMPLETE: queued stack merged (1 PR)");
  });
});

describe("queued stack cadence", () => {
  const sole = [...QUEUED, "--stack-prs", String(PR.sole), "--sweep-interval", String(SWEEP_SECONDS)] as const;

  test("repeats identical waits silently and sweeps the whole stack when due", async () => {
    const reader = fakeReader({ facts: mergesAfterReads({ [PR.sole]: LATE_MERGE_READ }) });
    const run = await runCli(sole, reader);
    expect(kindList(run)).toEqual(["QUEUE", "STATUS", "WAITING", "STATUS", "COMPLETE"]);
    expect(run.clock.sleeps).toEqual([INTERVAL_SECONDS, INTERVAL_SECONDS, INTERVAL_SECONDS]);
    expect(get(run.lines[3], "reason")).toBe("whole-stack-sweep");
    expect(run.clock.elapsed).toBeGreaterThanOrEqual(SECOND_SWEEP_AT);
  });

  test("polls only the frontier between sweeps", async () => {
    const reader = fakeReader({ facts: mergesAfterReads({ [PR.merging]: LATE_MERGE_READ, [PR.next]: 1 }) });
    const run = await runCli(TWO, reader);
    expect(kindList(run)).toEqual(["QUEUE", "STATUS", "WAITING", "ADVANCE", "COMPLETE"]);
    expect(pullRequestReads(reader.reads)).toEqual([
      "pullRequest:40", "pullRequest:41", "pullRequest:40", "pullRequest:40", "pullRequest:40", "pullRequest:41",
    ]);
  });
});
