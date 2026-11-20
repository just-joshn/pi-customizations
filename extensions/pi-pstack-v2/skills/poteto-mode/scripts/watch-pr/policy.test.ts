import { describe, expect, test } from "bun:test";
import {
  failedCheck,
  fakeReader,
  passingCheck,
  pendingCheck,
  reviewThread,
  type FakeReaderOptions,
} from "./fakes.test-helper.ts";
import { runCli, TARGET } from "./harness.test-helper.ts";
import { get, kindsOf } from "./output.test-helper.ts";
import type { PullRequestFacts, RollupState } from "./types.ts";

const EXIT_CONFLICTS = 2;
const EXIT_THREADS = 3;
const EXIT_CHECKS = 4;
const EXIT_GATE = 6;
const DEFAULT_INTERVAL_SECONDS = 60;
const MERGED = { state: "MERGED", mergedAt: "2026-07-26T00:00:00Z" } as const;
const LINT_URL = "https://ci.example/lint";
const READY_TEXT = "READY: no merge conflicts, no unresolved review threads, no failing or pending checks";

const watch = (options: FakeReaderOptions, ...extra: readonly string[]) =>
  runCli([...TARGET, ...extra], fakeReader(options));
const pendingThenSettled = (settled: FakeReaderOptions): FakeReaderOptions => ({
  ...settled,
  fastPath: (_pr, reads) => ({ kind: "checks", checks: [reads === 0 ? pendingCheck() : passingCheck()] }),
});

describe("a clean PR", () => {
  test("is READY with proof of mergeability, threads, CI and gate", async () => {
    const run = await watch({});
    expect(run.code).toBe(0);
    expect(get(run.lines[0], "kind")).toBe("READY");
    expect(get(run.lines[0], "scope.kind")).toBe("single");
    expect(get(run.lines[0], "scope.pr.kind")).toBe("ready-pr");
    expect(get(run.lines[0], "scope.pr.proof.mergeability")).toBe("clear");
    expect(get(run.lines[0], "scope.pr.proof.gate")).toEqual({ state: "OPEN", reviewDecision: "APPROVED", draft: "not-draft" });
  });

  test("prints the merge facts with --pretty", async () => {
    const run = await watch({}, "--pretty");
    expect(run.stdout).toBe(`${READY_TEXT}\nmergeStateStatus=CLEAN\nreviewDecision=APPROVED\nisDraft=false\n`);
  });

  test("is READY even while a review is still required", async () => {
    const run = await watch({ facts: { reviewDecision: "REVIEW_REQUIRED" } });
    expect(get(run.lines[0], "scope.pr.proof.gate.reviewDecision")).toBe("REVIEW_REQUIRED");
  });
});

describe("a PR that is already merged or closed", () => {
  test("a merged PR is READY as merged, without reading threads or checks", async () => {
    const reader = fakeReader({ facts: MERGED });
    const run = await runCli(TARGET, reader);
    expect(run.code).toBe(0);
    expect(get(run.lines[0], "scope.pr.kind")).toBe("merged-pr");
    expect(get(run.lines[0], "scope.pr.mergedAt")).toBe(MERGED.mergedAt);
    expect(reader.calls).toEqual(["pullRequest"]);
  });

  test("an open PR with a merge timestamp counts as merged", async () => {
    const run = await watch({ facts: { mergedAt: MERGED.mergedAt } }, "--pretty");
    expect(run.stdout).toBe(`${READY_TEXT}\n`);
  });

  test("a closed PR is a merge-gate blocker with exit 6", async () => {
    const reader = fakeReader({ facts: { state: "CLOSED" } });
    const run = await runCli(TARGET, reader);
    expect(run.code).toBe(EXIT_GATE);
    expect(get(run.lines[0], "blocker.reason")).toBe("closed-without-merge");
    expect(reader.calls).toEqual(["pullRequest"]);
  });

  test("tells the agent what to do about a closed PR with --pretty", async () => {
    const run = await watch({ facts: { state: "CLOSED" } }, "--pretty");
    expect(run.stdout).toBe(
      "BLOCKER: closed-without-merge\npr=1\naction=restore or remove the closed PR from the queued stack\n"
    );
  });
});

describe("drafts and review decisions", () => {
  test("a draft with pending checks waits, then reports the draft gate", async () => {
    const run = await watch(pendingThenSettled({ facts: { isDraft: true } }));
    expect(kindsOf(run.lines)).toEqual(["WAITING", "BLOCKER"]);
    expect(run.code).toBe(EXIT_GATE);
    expect(get(run.lines[1], "blocker.reason")).toBe("draft-pr");
    expect(run.clock.sleeps).toEqual([DEFAULT_INTERVAL_SECONDS]);
  });

  test("--allow-draft lets a draft be READY and says to leave it a draft", async () => {
    const run = await watch({ facts: { isDraft: true } }, "--allow-draft", "--pretty");
    expect(run.code).toBe(0);
    expect(run.stdout).toBe(
      `${READY_TEXT}\nmergeStateStatus=CLEAN\nreviewDecision=APPROVED\nisDraft=true\nnote=draft allowed (--allow-draft); leave draft — do not mark ready\n`
    );
  });

  test("--allow-draft is recorded in the READY proof", async () => {
    const run = await watch({ facts: { isDraft: true } }, "--allow-draft");
    expect(get(run.lines[0], "scope.pr.proof.gate.draft")).toBe("draft-allowed");
  });

  test("changes requested is a merge-gate blocker with exit 6", async () => {
    const run = await watch({ facts: { reviewDecision: "CHANGES_REQUESTED" } }, "--pretty");
    expect(run.code).toBe(EXIT_GATE);
    expect(run.stdout).toContain("BLOCKER: changes-requested");
    expect(run.stdout).toContain("action=resolve the changes-requested review before waiting for the merge queue");
  });
});

type ConflictCase = readonly [name: string, facts: NonNullable<FakeReaderOptions["facts"]>];
const CONFLICT_CASES: readonly ConflictCase[] = [
  ["mergeable CONFLICTING", { mergeable: "CONFLICTING" }],
  ["mergeStateStatus DIRTY", { mergeStateStatus: "DIRTY" }],
  ["mergeStateStatus CONFLICTING", { mergeStateStatus: "CONFLICTING" }],
];

describe("merge conflicts", () => {
  test.each(CONFLICT_CASES)("%s blocks with exit 2", async (_name, facts) => {
    const run = await watch({ facts });
    expect(run.code).toBe(EXIT_CONFLICTS);
    expect(get(run.lines[0], "blocker.kind")).toBe("merge-conflicts");
  });

  test("tell the agent to resolve them with --pretty", async () => {
    const run = await watch({ facts: { mergeStateStatus: "DIRTY" } }, "--pretty");
    expect(run.stdout.split("\n")).toEqual([
      "BLOCKER: merge-conflicts",
      "pr=1",
      "mergeable=MERGEABLE",
      "mergeStateStatus=DIRTY",
      "action=resolve merge conflicts before waiting for CI",
      "",
    ]);
  });
});

describe("failing checks and review threads", () => {
  test("a failing check blocks with exit 4 and its details", async () => {
    const lint = failedCheck("lint", { description: "2 errors", link: LINT_URL });
    const run = await watch({ fastPath: { kind: "checks", checks: [passingCheck(), lint] } }, "--pretty");
    expect(run.code).toBe(EXIT_CHECKS);
    expect(run.stdout).toBe(`BLOCKER: failing-checks\npr=1\nfailed=1\nlint FAILURE 2 errors ${LINT_URL}\n`);
  });

  test("a failure blocks even while other checks are pending", async () => {
    const checks = [failedCheck("lint"), pendingCheck("build")];
    const run = await watch({ fastPath: { kind: "checks", checks } });
    expect(run.code).toBe(EXIT_CHECKS);
    expect(run.clock.sleeps).toEqual([]);
    expect(get(run.lines[0], "blocker.ci.pending.0.name")).toBe("build");
  });

  test("an unresolved review thread blocks with exit 3", async () => {
    const run = await watch({ threads: [reviewThread("t1")] });
    expect(run.code).toBe(EXIT_THREADS);
    expect(get(run.lines[0], "blocker.threads.0.id")).toBe("t1");
  });
});

type PriorityStep = readonly [name: string, options: FakeReaderOptions, exitCode: number];
const everything: FakeReaderOptions = {
  facts: { mergeable: "CONFLICTING", reviewDecision: "CHANGES_REQUESTED" },
  threads: [reviewThread("t1")],
  fastPath: { kind: "checks", checks: [failedCheck()] },
};
const PRIORITY: readonly PriorityStep[] = [
  ["conflicts", everything, EXIT_CONFLICTS],
  ["review threads", { ...everything, facts: { reviewDecision: "CHANGES_REQUESTED" } }, EXIT_THREADS],
  ["failing checks", { ...everything, facts: { reviewDecision: "CHANGES_REQUESTED" }, threads: [] }, EXIT_CHECKS],
  ["the merge gate", { facts: { reviewDecision: "CHANGES_REQUESTED" } }, EXIT_GATE],
];

describe("blocker priority", () => {
  test.each(PRIORITY)("reports %s first when several blockers apply", async (_name, options, exitCode) => {
    const run = await watch(options);
    expect(run.code).toBe(exitCode);
  });
});

type Readiness = readonly [mergeState: PullRequestFacts["mergeStateStatus"], headRollup: RollupState, exitCode: number];
const READINESS: readonly Readiness[] = [
  ["BLOCKED", "FAILURE", EXIT_CHECKS],
  ["BLOCKED", "ERROR", EXIT_CHECKS],
  ["BLOCKED", "PENDING", 0],
  ["BLOCKED", "SUCCESS", 0],
  ["BLOCKED", null, 0],
  ["UNSTABLE", "FAILURE", 0],
  ["UNKNOWN", "ERROR", 0],
  ["UNKNOWN", "EXPECTED", 0],
  ["UNKNOWN", "FAILURE", 0],
  ["UNKNOWN", "PENDING", 0],
  ["UNKNOWN", "SUCCESS", 0],
  ["UNKNOWN", null, 0],
  ["CLEAN", "SUCCESS", 0],
];

describe("GitHub's own verdict on a clean check list", () => {
  test.each(READINESS)("%s with head rollup %s exits %d", async (mergeStateStatus, state, exitCode) => {
    const commitRollups = state === null ? [] : [{ oid: "head", state }];
    const run = await watch({ facts: { mergeStateStatus }, commitRollups });
    expect(run.code).toBe(exitCode);
  });

  test("only the head commit's rollup counts", async () => {
    const commitRollups = [{ oid: "older", state: "FAILURE" as const }];
    const run = await watch({ facts: { mergeStateStatus: "BLOCKED" }, commitRollups });
    expect(run.code).toBe(0);
  });
});
