import { describe, expect, test } from "bun:test";
import {
  byPr,
  failedCheck,
  fakeReader,
  passingCheck,
  reviewThread,
  type Facts,
  type FakeReaderOptions,
} from "./fakes.test-helper.ts";
import { runCli } from "./harness.test-helper.ts";
import { get, kindsOf } from "./output.test-helper.ts";
import type { ChecksFastPath, ReviewThread } from "./types.ts";

const PR = { first: 20, second: 21, third: 22 } as const;
const PREFIX_LENGTH = 3;
const EXIT = { conflicts: 2, threads: 3, checks: 4, gate: 6 } as const;
const QUEUE = ["--owner", "owner", "--repo", "repo", "--queued-stack", "--stack-prs", "20,21,22"] as const;
const MERGED: Facts = { state: "MERGED", mergedAt: "2026-07-26T00:00:00Z" };
const conflicting: Facts = { mergeable: "CONFLICTING" };
const failing: ChecksFastPath = { kind: "checks", checks: [failedCheck("lint")] };
const passing: ChecksFastPath = { kind: "checks", checks: [passingCheck()] };

type BlockerCase = readonly [name: string, options: FakeReaderOptions, exitCode: number, pr: number];
const BLOCKER_CASES: readonly BlockerCase[] = [
  ["a merge conflict upstack", { facts: byPr<Facts>({ [PR.second]: conflicting }, {}) }, EXIT.conflicts, PR.second],
  ["an unresolved thread on the frontier", { threads: byPr<readonly ReviewThread[]>({ [PR.first]: [reviewThread("t")] }, []) }, EXIT.threads, PR.first],
  ["a failing check at the top", { fastPath: byPr<ChecksFastPath>({ [PR.third]: failing }, passing) }, EXIT.checks, PR.third],
  ["a closed PR", { facts: byPr<Facts>({ [PR.second]: { state: "CLOSED" } }, {}) }, EXIT.gate, PR.second],
  ["a draft PR", { facts: byPr<Facts>({ [PR.first]: { isDraft: true } }, {}) }, EXIT.gate, PR.first],
  ["a changes-requested review", { facts: byPr<Facts>({ [PR.third]: { reviewDecision: "CHANGES_REQUESTED" } }, {}) }, EXIT.gate, PR.third],
  [
    "a conflict upstack, which outranks the frontier's failing check",
    { facts: byPr<Facts>({ [PR.third]: conflicting }, {}), fastPath: byPr<ChecksFastPath>({ [PR.first]: failing }, passing) },
    EXIT.conflicts,
    PR.third,
  ],
  [
    "a conflict on a PR below an already merged one, ignoring the merged PR",
    { facts: byPr<Facts>({ [PR.first]: MERGED, [PR.second]: conflicting }, {}) },
    EXIT.conflicts,
    PR.second,
  ],
];

describe("queued stack blockers", () => {
  test.each(BLOCKER_CASES)("%s ends the watch", async (_name, options, exitCode, pr) => {
    const run = await runCli(QUEUE, fakeReader(options));
    expect(run.code).toBe(exitCode);
    expect(kindsOf(run.lines).slice(0, PREFIX_LENGTH)).toEqual(["QUEUE", "STATUS", "BLOCKER"]);
    expect(get(run.lines.at(-1), "blocker.pr.number")).toBe(pr);
    expect(run.clock.sleeps).toEqual([]);
  });

  test("--allow-draft lets a draft PR wait instead of blocking", async () => {
    const options = { facts: byPr<Facts>({ [PR.first]: { isDraft: true } }, {}) };
    const run = await runCli([...QUEUE, "--allow-draft", "--timeout", "5"], fakeReader(options));
    expect(kindsOf(run.lines).at(-1)).toBe("TIMEOUT");
  });
});
