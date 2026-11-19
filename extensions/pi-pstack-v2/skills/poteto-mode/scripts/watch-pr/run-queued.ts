import { pollUntilTerminal } from "./poll.ts";
import type { RunDependencies, StepResult } from "./poll.ts";
import {
  applyQueueSnapshot,
  createQueueState,
  evaluateQueue,
  planQueue,
} from "./queue.ts";
import type { QueueEvaluation, QueueState } from "./queue.ts";
import { readSnapshot } from "./snapshot.ts";
import type * as T from "./types.ts";
import { EXIT, blockerVerdict, verdictFactory } from "./verdict.ts";
import type { VerdictStamp } from "./verdict.ts";

type QueuedStamp = VerdictStamp<"queued-stack">;

interface QueuedArgs {
  readonly dependencies: RunDependencies;
  readonly contexts: T.NonEmpty<T.PrContext>;
  readonly options: T.PollingOptions;
}
type QueuedStep = StepResult<T.QueueTerminalVerdict>;
interface Advance {
  readonly state: QueueState;
  readonly step: QueuedStep;
}

const completeStep = (
  stamp: QueuedStamp,
  queue: T.NonEmpty<T.PrContext>,
  merged: T.NonEmpty<T.MergedPr>
): QueuedStep => ({
  kind: "terminal",
  verdict: stamp({
    kind: "COMPLETE",
    terminal: true,
    exitCode: 0,
    queue,
    merged,
  }),
});
const timeoutStep = (
  stamp: QueuedStamp,
  evaluation: Extract<QueueEvaluation, { kind: "timeout" }>
): QueuedStep => ({
  kind: "terminal",
  verdict: stamp({
    kind: "TIMEOUT",
    terminal: true,
    exitCode: EXIT.timeout,
    reason: {
      kind: "queued-stack",
      frontier: evaluation.frontier,
      unmergedCount: evaluation.unmergedCount,
    },
  }),
});
function advanceStep(
  args: QueuedArgs,
  stamp: QueuedStamp,
  evaluation: Extract<QueueEvaluation, { kind: "advance" }>
): QueuedStep {
  args.dependencies.emit(
    stamp({
      kind: "ADVANCE",
      terminal: false,
      merged: evaluation.merged,
      frontier: evaluation.frontier,
      remaining: evaluation.remaining,
    })
  );
  return { kind: "continue" };
}
function waitingStep(
  args: QueuedArgs,
  stamp: QueuedStamp,
  evaluation: Extract<QueueEvaluation, { kind: "waiting" }>
): QueuedStep {
  if (evaluation.emit)
    args.dependencies.emit(
      stamp({
        kind: "WAITING",
        terminal: false,
        frontier: evaluation.frontier,
        reason: evaluation.reason,
      })
    );
  return { kind: "sleep", seconds: args.options.interval };
}
function evaluationStep(
  args: QueuedArgs,
  stamp: QueuedStamp,
  evaluation: QueueEvaluation
): QueuedStep {
  switch (evaluation.kind) {
    case "complete":
      return completeStep(stamp, evaluation.state.queue, evaluation.merged);
    case "blocker":
      return {
        kind: "terminal",
        verdict: blockerVerdict(stamp, evaluation.blocker),
      };
    case "advance":
      return advanceStep(args, stamp, evaluation);
    case "timeout":
      return timeoutStep(stamp, evaluation);
    case "waiting":
      return waitingStep(args, stamp, evaluation);
    default: {
      const exhaustive: never = evaluation;
      return exhaustive;
    }
  }
}
function idleStep(
  args: QueuedArgs,
  stamp: QueuedStamp,
  state: QueueState
): QueuedStep {
  const complete = evaluateQueue(
    state,
    args.dependencies.clock.now(),
    args.options
  );
  if (complete.kind !== "complete")
    throw new Error("queue has no work while active");
  return completeStep(stamp, state.queue, complete.merged);
}
async function readNext(
  args: QueuedArgs,
  work: NonNullable<QueueState["work"]>
): Promise<T.PrSnapshot> {
  const context =
    work.kind === "whole-stack-sweep" ? work.remaining[0] : work.frontier;
  return readSnapshot({
    reader: args.dependencies.reader,
    context,
    pendingHistory: "omit",
    allowDraft: args.options.allowDraft,
  });
}
async function advanceQueue(
  args: QueuedArgs,
  stamp: QueuedStamp,
  planned: QueueState,
  work: NonNullable<QueueState["work"]>
): Promise<Advance> {
  const { clock, emit } = args.dependencies;
  const snapshot = await readNext(args, work);
  const applied = applyQueueSnapshot(planned, snapshot, clock.now(), args.options);
  if (applied.completedSweepRows !== null)
    emit(
      stamp({
        kind: "STATUS",
        terminal: false,
        reason: "whole-stack-sweep",
        rows: applied.completedSweepRows,
      })
    );
  if (applied.state.work !== null)
    return { state: applied.state, step: { kind: "continue" } };
  const evaluation = evaluateQueue(applied.state, clock.now(), args.options);
  return {
    state: evaluation.state,
    step: evaluationStep(args, stamp, evaluation),
  };
}
export function runQueued(args: QueuedArgs): Promise<T.QueueTerminalVerdict> {
  const { clock, emit } = args.dependencies;
  const stamp = verdictFactory(clock, "queued-stack");
  emit(stamp({ kind: "QUEUE", terminal: false, queue: args.contexts }));
  let state = createQueueState(args.contexts, clock.now());
  const step = async (): Promise<QueuedStep> => {
    const planned = planQueue(state, clock.now());
    state = planned;
    if (planned.work === null) return idleStep(args, stamp, planned);
    const advanced = await advanceQueue(args, stamp, planned, planned.work);
    state = advanced.state;
    return advanced.step;
  };
  return pollUntilTerminal({
    dependencies: args.dependencies,
    options: args.options,
    stamp,
    step,
  });
}
