import { describe, expect, it } from "bun:test";
import { WatcherQueryError } from "./github.ts";
import {
  applyQueueSnapshot,
  assessGitHubMerge,
  classifyPr,
  createQueueState,
  evaluateQueue,
  planQueue,
  queryBackoffSeconds,
  readSnapshot,
  runQueued,
  runSimple,
  selectTierMajorStackDecision,
} from "./policy.ts";
import {
  fakeReader,
  failedCheck,
  passingCheck,
  pendingCheck,
} from "./fakes.test-helper.ts";
import type {
  GitHubReader,
  NonEmpty,
  PollingOptions,
  PrContext,
  ProgressVerdict,
  PullRequestFacts,
  RollupState,
} from "./types.ts";
import { createRecorder, type Recorder } from "./recorder.test-helper.ts";
import { parsePrNumber } from "./types.ts";

const context = (number: number): PrContext => ({
  owner: "owner",
  repo: "repo",
  number: parsePrNumber(number),
});
const options = {
  interval: 10,
  sweepInterval: 300,
  timeout: 0,
  maxQueryErrors: 5,
  allowDraft: false,
} satisfies PollingOptions;

describe("readiness truth table", () => {
  it("covers every specified row and every UNKNOWN rollup value", () => {
    const cases: readonly [
      PullRequestFacts["mergeStateStatus"],
      RollupState,
      "allowed" | "refused",
    ][] = [
      ["BLOCKED", "FAILURE", "refused"],
      ["BLOCKED", "ERROR", "refused"],
      ["BLOCKED", "PENDING", "allowed"],
      ["UNSTABLE", "FAILURE", "allowed"],
      ["UNKNOWN", "ERROR", "allowed"],
      ["UNKNOWN", "EXPECTED", "allowed"],
      ["UNKNOWN", "FAILURE", "allowed"],
      ["UNKNOWN", "PENDING", "allowed"],
      ["UNKNOWN", "SUCCESS", "allowed"],
      ["UNKNOWN", null, "allowed"],
      ["CLEAN", "SUCCESS", "allowed"],
    ];
    for (const [mergeStateStatus, headRollupState, expected] of cases) {
      expect(
        assessGitHubMerge({ mergeStateStatus, headRollupState }).kind
      ).toBe(expected);
    }
  });

  it("turns a clean visible list plus GitHub refusal into an explicit CI blocker", async () => {
    const reader = fakeReader({
      facts: { mergeStateStatus: "BLOCKED" },
      fastPath: { kind: "checks", checks: [passingCheck()] },
      commitRollups: [{ oid: "head", state: "FAILURE" }],
    });
    const snapshot = await readSnapshot({
      reader,
      context: context(1),
      pendingHistory: "include",
      allowDraft: false,
    });
    expect(snapshot.kind).toBe("open");
    if (snapshot.kind !== "open") throw new Error("expected open snapshot");
    expect(snapshot.ci.kind).toBe("ci-github-rejected");
    expect(classifyPr(snapshot)).toMatchObject({
      kind: "blocker",
      blocker: { kind: "failing-checks" },
    });
  });
});

describe("snapshot query planning", () => {
  it("does not query commit rollups while queued checks are pending", async () => {
    const reader = fakeReader({
      fastPath: { kind: "checks", checks: [pendingCheck()] },
    });
    const snapshot = await readSnapshot({
      reader,
      context: context(2),
      pendingHistory: "omit",
      allowDraft: false,
    });
    expect(snapshot.kind).toBe("open");
    if (snapshot.kind !== "open") throw new Error("expected open snapshot");
    expect(snapshot.ci.kind).toBe("ci-pending");
    expect(reader.calls).toEqual([
      "pullRequest",
      "reviewThreadPage:null",
      "checksFastPath",
    ]);
  });

  it("queries rollups for settled and failed lists", async () => {
    const settled = fakeReader();
    await readSnapshot({
      reader: settled,
      context: context(3),
      pendingHistory: "omit",
      allowDraft: false,
    });
    expect(settled.calls).toContain("commitRollups");

    const failed = fakeReader({
      fastPath: { kind: "checks", checks: [failedCheck()] },
    });
    await readSnapshot({
      reader: failed,
      context: context(4),
      pendingHistory: "omit",
      allowDraft: false,
    });
    expect(failed.calls).toContain("commitRollups");
  });

  it("short-circuits merged rows before threads and checks", async () => {
    const reader = fakeReader({
      facts: { state: "MERGED", mergedAt: "2026-07-26T00:00:00Z" },
    });
    const snapshot = await readSnapshot({
      reader,
      context: context(5),
      pendingHistory: "include",
      allowDraft: false,
    });
    expect(snapshot.kind).toBe("merged");
    expect(reader.calls).toEqual(["pullRequest"]);
  });
});

it("scans stacks tier-major so an upstack conflict outranks frontier CI", async () => {
  const frontier = await readSnapshot({
    reader: fakeReader({
      fastPath: { kind: "checks", checks: [failedCheck()] },
      commitRollups: [{ oid: "head", state: "FAILURE" }],
    }),
    context: context(10),
    pendingHistory: "omit",
    allowDraft: false,
  });
  const upstack = await readSnapshot({
    reader: fakeReader({ facts: { mergeable: "CONFLICTING" } }),
    context: context(11),
    pendingHistory: "omit",
    allowDraft: false,
  });
  const decision = selectTierMajorStackDecision([frontier, upstack]);
  expect(decision).toMatchObject({
    kind: "blocker",
    blocker: { kind: "merge-conflicts", pr: { number: 11 } },
  });
});

it("attributes a stack wait to the PR whose checks are pending, not the bottom", async () => {
  const readyBottom = await readSnapshot({
    reader: fakeReader(),
    context: context(20),
    pendingHistory: "omit",
    allowDraft: false,
  });
  const pendingUpstack = await readSnapshot({
    reader: fakeReader({
      fastPath: { kind: "checks", checks: [pendingCheck("upstack-build")] },
    }),
    context: context(21),
    pendingHistory: "omit",
    allowDraft: false,
  });
  const decision = selectTierMajorStackDecision([readyBottom, pendingUpstack]);
  expect(decision).toMatchObject({
    kind: "waiting",
    frontier: { number: 21 },
    pending: [{ name: "upstack-build" }],
  });
});

it("waits on a draft while checks are pending, then reports the draft gate", async () => {
  const pending = await readSnapshot({
    reader: fakeReader({
      facts: { isDraft: true },
      fastPath: { kind: "checks", checks: [pendingCheck()] },
    }),
    context: context(12),
    pendingHistory: "omit",
    allowDraft: false,
  });
  expect(classifyPr(pending).kind).toBe("waiting");

  const settled = await readSnapshot({
    reader: fakeReader({ facts: { isDraft: true } }),
    context: context(12),
    pendingHistory: "omit",
    allowDraft: false,
  });
  expect(classifyPr(settled)).toMatchObject({
    kind: "blocker",
    blocker: { kind: "merge-gate", reason: "draft-pr" },
  });
});

const rateLimited = () =>
  new WatcherQueryError({
    kind: "command-exit",
    retryable: true,
    detail: "rate limited",
    code: 1,
  });
const OBSERVED_AT = "2026-07-26T00:00:00.000Z";
const MERGED_FACTS = {
  state: "MERGED",
  mergedAt: "2026-07-26T00:00:00Z",
} as const;
const STOP_AFTER_SLEEPS = 2;
function stoppingClock(timeline: Recorder<string>, message: string) {
  let now = 0;
  let sleeps = 0;
  return {
    now: () => now,
    observedAt: () => OBSERVED_AT,
    async sleep(seconds: number): Promise<void> {
      timeline.add("sleep");
      now += seconds;
      sleeps += 1;
      if (sleeps === STOP_AFTER_SLEEPS) throw new Error(message);
    },
  };
}
function failingOnceReader(failing: PrContext, timeline: Recorder<string>) {
  const base = fakeReader();
  let failNext = true;
  return {
    ...base,
    async pullRequest(pr: PrContext) {
      if (pr.number === failing.number && failNext) {
        failNext = false;
        timeline.add(`fail:${pr.number}`);
        throw rateLimited();
      }
      timeline.add(`read:${pr.number}`);
      return base.pullRequest(pr);
    },
  } satisfies GitHubReader;
}
function mergingOnSecondReadReader(
  target: PrContext,
  timeline: Recorder<string>
) {
  const base = fakeReader();
  let targetReads = 0;
  return {
    ...base,
    async pullRequest(pr: PrContext) {
      timeline.add(`read:${pr.number}`);
      const facts = await base.pullRequest(pr);
      if (pr.number !== target.number) return facts;
      targetReads += 1;
      return targetReads > 1 ? { ...facts, ...MERGED_FACTS } : facts;
    },
  } satisfies GitHubReader;
}
const tracingEmit =
  (timeline: Recorder<string>, emitted?: Recorder<ProgressVerdict>) =>
  (verdict: ProgressVerdict): void => {
    emitted?.add(verdict);
    timeline.add(`emit:${verdict.kind}`);
  };
function recordingClock(sleeps: Recorder<number>) {
  let now = 0;
  return {
    now: () => now,
    get elapsed() {
      return now;
    },
    observedAt: () => OBSERVED_AT,
    async sleep(seconds: number): Promise<void> {
      sleeps.add(seconds);
      now += seconds;
    },
  };
}

describe("queued-stack cadence", () => {
  async function openSnapshot(pr: PrContext) {
    return readSnapshot({
      reader: fakeReader(),
      context: pr,
      pendingHistory: "omit",
      allowDraft: false,
    });
  }

  it("drops a sweep head only after its snapshot succeeds", async () => {
    const queue = [
      context(20),
      context(21),
      context(22),
    ] satisfies NonEmpty<PrContext>;
    let state = createQueueState(queue, 0);
    const first = await openSnapshot(queue[0]);
    state = applyQueueSnapshot(state, first, 0, options).state;
    expect(state.work).toMatchObject({
      kind: "whole-stack-sweep",
      remaining: [{ number: 21 }, { number: 22 }],
    });
    const second = await openSnapshot(queue[1]);
    state = applyQueueSnapshot(state, second, 60, options).state;
    expect(state.work).toMatchObject({
      kind: "whole-stack-sweep",
      remaining: [{ number: 22 }],
    });
  });

  it("resumes the sweep at the PR whose read failed", async () => {
    const middle = context(21);
    const timeline = createRecorder<string>();
    const reader = failingOnceReader(middle, timeline);
    const running = runQueued({
      dependencies: {
        reader,
        clock: stoppingClock(timeline, "stop after resume proof"),
        emit: tracingEmit(timeline),
      },
      contexts: [context(20), middle, context(22)],
      options,
    });
    await expect(running).rejects.toThrow("stop after resume proof");
    expect(timeline.items).toEqual([
      "emit:QUEUE",
      "read:20",
      "fail:21",
      "emit:RETRY",
      "sleep",
      "read:21",
      "read:22",
      "emit:STATUS",
      "emit:WAITING",
      "sleep",
    ]);
  });

  it("emits a completed sweep only after its final successful snapshot", async () => {
    const queue = [context(30), context(31)] satisfies NonEmpty<PrContext>;
    let state = createQueueState(queue, 0);
    const first = applyQueueSnapshot(
      state,
      await openSnapshot(queue[0]),
      0,
      options
    );
    expect(first.completedSweepRows).toBeNull();
    state = first.state;
    const second = applyQueueSnapshot(
      state,
      await openSnapshot(queue[1]),
      5,
      options
    );
    expect(
      second.completedSweepRows?.map((row) => Number(row.context.number))
    ).toEqual([30, 31]);
    expect(second.state.nextSweepAt).toBe(305);
  });

  it("ADVANCE continues directly to the new frontier without sleeping", async () => {
    const one = context(40);
    const two = context(41);
    const timeline = createRecorder<string>();
    const reader = mergingOnSecondReadReader(one, timeline);
    const emitted = createRecorder<ProgressVerdict>();
    const running = runQueued({
      dependencies: {
        reader,
        clock: stoppingClock(timeline, "stop after advance proof"),
        emit: tracingEmit(timeline, emitted),
      },
      contexts: [one, two],
      options,
    });
    await expect(running).rejects.toThrow("stop after advance proof");
    expect(emitted.items.some((event) => event.kind === "ADVANCE")).toBe(true);
    const firstSleep = timeline.items.indexOf("sleep");
    expect(timeline.items.slice(firstSleep, firstSleep + 5)).toEqual([
      "sleep",
      "read:40",
      "emit:ADVANCE",
      "read:41",
      "emit:WAITING",
    ]);
  });

  it("deduplicates identical waits and schedules the next due sweep", async () => {
    const queue = [context(50)] satisfies NonEmpty<PrContext>;
    let state = createQueueState(queue, 0);
    state = applyQueueSnapshot(
      state,
      await openSnapshot(queue[0]),
      0,
      options
    ).state;
    const first = evaluateQueue(state, 0, options);
    expect(first.kind).toBe("waiting");
    if (first.kind !== "waiting") throw new Error("expected waiting");
    expect(first.emit).toBe(true);
    const second = evaluateQueue(first.state, 10, options);
    expect(second.kind).toBe("waiting");
    if (second.kind !== "waiting") throw new Error("expected waiting");
    expect(second.emit).toBe(false);
    expect(planQueue(second.state, 300).work?.kind).toBe("whole-stack-sweep");
  });
});

it("uses the specified retry floor and cap", () => {
  expect(queryBackoffSeconds(1, 1)).toBe(60);
  expect(queryBackoffSeconds(1, 2)).toBe(120);
  expect(queryBackoffSeconds(60, 4)).toBe(300);
});


const failingPullRequest = async (): Promise<PullRequestFacts> => {
  throw new WatcherQueryError({
    kind: "command-exit",
    retryable: true,
    code: 1,
    detail: "temporary failure",
  });
};
const SIMPLE = { mode: "single", statusOnly: false } as const;
const readerFor = (
  mode: "single" | "queued-stack" | "query-retry",
  pending: GitHubReader
): GitHubReader =>
  mode === "query-retry"
    ? { ...pending, pullRequest: failingPullRequest }
    : pending;
const pendingFastPath = {
  kind: "checks",
  checks: [pendingCheck()],
} as const;

describe("polling deadline sleeps", () => {
  for (const mode of ["single", "queued-stack", "query-retry"] as const) {
    it(`caps ${mode} sleeps at the configured deadline`, async () => {
      const sleeps = createRecorder<number>();
      const clock = recordingClock(sleeps);
      const pending = fakeReader({ fastPath: pendingFastPath });
      const reader = readerFor(mode, pending);
      const dependencies = { reader, clock, emit() {} };
      const polling = { ...options, interval: 60, timeout: 5 };
      const contexts = [context(1)] satisfies NonEmpty<PrContext>;
      const queued = () => runQueued({ dependencies, contexts, options: polling });
      const simple = () =>
        runSimple({ dependencies, contexts, ...SIMPLE, options: polling });
      const result = await (mode === "queued-stack" ? queued : simple)();
      expect(result.kind).toBe("TIMEOUT");
      expect(sleeps.items).toEqual([5]);
      expect(clock.elapsed).toBe(5);
    });
  }
  it("preserves the polling interval when the deadline is disabled", async () => {
    let reads = 0;
    const sleeps = createRecorder<number>();
    const pending = fakeReader({ fastPath: pendingFastPath });
    const passed = fakeReader({
      fastPath: { kind: "checks", checks: [passingCheck()] },
    });
    const reader = {
      ...pending,
      checksFastPath(pr: PrContext) {
        reads += 1;
        const source = reads === 1 ? pending : passed;
        return source.checksFastPath(pr);
      },
    };
    const result = await runSimple({
      dependencies: { reader, clock: recordingClock(sleeps), emit() {} },
      contexts: [context(1)],
      mode: "single",
      statusOnly: false,
      options: { ...options, interval: 60, timeout: 0 },
    });
    expect(result.kind).toBe("READY");
    expect(sleeps.items).toEqual([60]);
  });
});
