import { describe, expect, test } from "bun:test";
import {
  byPr,
  failedCheck,
  fakeReader,
  openPr,
  passingCheck,
  pendingCheck,
  type Facts,
  type FakeReaderOptions,
} from "./fakes.test-helper.ts";
import { runCli } from "./harness.test-helper.ts";
import { get, kindsOf, pluck } from "./output.test-helper.ts";
import type { OpenPullRequest } from "./types.ts";

const PR = { bottom: 1, middle: 2, top: 3, fourth: 4, upstackConflict: 11, frontierFailing: 10 } as const;
const EXIT_CONFLICTS = 2;
const DEFAULT_INTERVAL_SECONDS = 60;
const MERGED = { state: "MERGED", mergedAt: "2026-07-26T00:00:00Z" } as const;
const OWNER_REPO = ["--owner", "owner", "--repo", "repo"] as const;

const watchStack = (start: number, options: FakeReaderOptions, ...extra: readonly string[]) =>
  runCli([...OWNER_REPO, "--pr", String(start), "--stack", ...extra], fakeReader(options));
const numbersOf = (run: { readonly lines: readonly unknown[] }) =>
  pluck(run.lines.at(-1), "scope.prs", "context.number");

type OrderCase = readonly [name: string, start: number, open: readonly OpenPullRequest[], expected: readonly number[]];
const chain = [openPr(PR.top, "top", "middle"), openPr(PR.bottom, "bottom", "main"), openPr(PR.middle, "middle", "bottom")];
const ORDER_CASES: readonly OrderCase[] = [
  ["from the middle of a chain", PR.middle, chain, [PR.bottom, PR.middle, PR.top]],
  ["from the bottom of a chain", PR.bottom, chain, [PR.bottom, PR.middle, PR.top]],
  ["from the top of a chain", PR.top, chain, [PR.bottom, PR.middle, PR.top]],
  ["with siblings ordered by number", PR.bottom, [openPr(PR.top, "y", "b"), openPr(PR.middle, "x", "b"), openPr(PR.bottom, "b", "main")], [PR.bottom, PR.middle, PR.top]],
  ["when the PR is not in the open list", PR.middle, [openPr(PR.bottom, "bottom", "main")], [PR.middle]],
  ["ignoring a fork head that shares the parent's name", PR.middle, [openPr(PR.bottom, "base", "main", true), openPr(PR.middle, "feat", "base")], [PR.middle]],
  ["ignoring children of a fork head", PR.middle, [openPr(PR.middle, "feat", "main", true), openPr(PR.top, "up", "feat")], [PR.middle]],
  ["when an unrelated fork opens main against main", PR.middle, [openPr(PR.bottom, "main", "main", true), openPr(PR.middle, "feat", "main")], [PR.middle]],
  ["when two PRs name each other as base", PR.bottom, [openPr(PR.bottom, "a", "b"), openPr(PR.middle, "b", "a")], [PR.middle, PR.bottom]],
];

describe("connected stack discovery", () => {
  test.each(ORDER_CASES)("orders the stack bottom to top %s", async (_name, start, open, expected) => {
    const run = await watchStack(start, { openPullRequests: open });
    expect(run.code).toBe(0);
    expect(numbersOf(run)).toEqual(expected);
  });
});

const twoPrStack = [openPr(PR.upstackConflict, "up", "mid"), openPr(PR.frontierFailing, "mid", "main")];

describe("stack verdicts", () => {
  test("an upstack conflict outranks the frontier's failing CI", async () => {
    const run = await watchStack(PR.frontierFailing, {
      openPullRequests: twoPrStack,
      facts: byPr<Facts>({ [PR.upstackConflict]: { mergeable: "CONFLICTING" } }, {}),
      fastPath: (pr) => ({ kind: "checks", checks: [pr.number === PR.frontierFailing ? failedCheck() : passingCheck()] }),
    });
    expect(run.code).toBe(EXIT_CONFLICTS);
    expect(get(run.lines.at(-1), "blocker.pr.number")).toBe(PR.upstackConflict);
  });

  test("a wait is attributed to the PR whose checks are pending, not the bottom", async () => {
    const run = await watchStack(PR.frontierFailing, {
      openPullRequests: twoPrStack,
      fastPath: (pr, reads) => ({
        kind: "checks",
        checks: [pr.number === PR.upstackConflict && reads === 0 ? pendingCheck("upstack-build") : passingCheck()],
      }),
    });
    expect(kindsOf(run.lines)).toEqual(["STATUS", "WAITING", "STATUS", "READY"]);
    expect(get(run.lines[1], "frontier.number")).toBe(PR.upstackConflict);
    expect(pluck(run.lines[1], "reason.pending", "name")).toEqual(["upstack-build"]);
    expect(run.clock.sleeps).toEqual([DEFAULT_INTERVAL_SECONDS]);
  });

  test("READY covers merged and open PRs of the stack", async () => {
    const run = await watchStack(PR.frontierFailing, {
      openPullRequests: twoPrStack,
      facts: byPr<Facts>({ [PR.frontierFailing]: MERGED }, {}),
    });
    expect(kindsOf(run.lines)).toEqual(["STATUS", "READY"]);
    expect(get(run.lines[1], "scope.kind")).toBe("stack");
    expect(pluck(run.lines[1], "scope.prs", "kind")).toEqual(["merged-pr", "ready-pr"]);
    expect(get(run.lines[0], "reason")).toBe("poll");
    expect(get(run.lines[0], "mode")).toBe("stack");
  });
});
