import { classifyPr, selectTierMajorStackDecision } from "./classify.ts";
import { pollUntilTerminal } from "./poll.ts";
import type { RunDependencies, StepResult } from "./poll.ts";
import { readSnapshot } from "./snapshot.ts";
import type * as T from "./types.ts";
import { nonEmpty } from "./types.ts";
import { EXIT, blockerVerdict, verdictFactory } from "./verdict.ts";
import type { VerdictStamp } from "./verdict.ts";

interface SimpleArgs {
  readonly dependencies: RunDependencies;
  readonly contexts: T.NonEmpty<T.PrContext>;
  readonly mode: T.WatchMode;
  readonly statusOnly: boolean;
  readonly options: T.PollingOptions;
}
type SimpleMode = Exclude<T.WatchMode, "queued-stack">;
type SimpleStep = StepResult<T.TerminalVerdict>;

const readRows = (args: SimpleArgs): Promise<readonly T.PrSnapshot[]> =>
  args.contexts.reduce(
    async (acc: Promise<readonly T.PrSnapshot[]>, context) => {
      const rows = await acc;
      const row = await readSnapshot({
        reader: args.dependencies.reader,
        context,
        pendingHistory: "include",
        allowDraft: args.options.allowDraft,
      });
      return [...rows, row];
    },
    Promise.resolve([])
  );
const terminal = (verdict: T.TerminalVerdict): SimpleStep => ({
  kind: "terminal",
  verdict,
});
function readyStep(
  stamp: VerdictStamp,
  mode: SimpleMode,
  scope: T.ReadyScope
): SimpleStep {
  return terminal(
    stamp(
      { kind: "READY", terminal: true, exitCode: 0, scope },
      mode
    )
  );
}
function waitStep(
  args: SimpleArgs,
  stamp: VerdictStamp,
  frontier: T.PrContext,
  pending: T.NonEmpty<T.PendingCheck>
): SimpleStep {
  args.dependencies.emit(
    stamp({
      kind: "WAITING",
      terminal: false,
      frontier,
      reason: { kind: "pending-checks", pending },
    })
  );
  return {
    kind: "sleep",
    seconds: args.options.interval,
    onDeadline: () =>
      stamp({
        kind: "TIMEOUT",
        terminal: true,
        exitCode: EXIT.timeout,
        reason: { kind: "pending-checks", pending },
      }),
  };
}
function decide(
  args: SimpleArgs,
  mode: SimpleMode,
  stamp: VerdictStamp,
  rows: T.NonEmpty<T.PrSnapshot>
): SimpleStep {
  const decision =
    mode === "single"
      ? classifyPr(rows[0], args.options.allowDraft)
      : selectTierMajorStackDecision(rows, args.options.allowDraft);
  switch (decision.kind) {
    case "blocker":
      return terminal(blockerVerdict(stamp, decision.blocker));
    case "ready":
    case "merged":
      return readyStep(stamp, mode, { kind: "single", pr: decision.pr });
    case "clear":
      return readyStep(stamp, mode, { kind: "stack", prs: decision.prs });
    case "waiting":
      return waitStep(args, stamp, decision.frontier, decision.pending);
    default: {
      const exhaustive: never = decision;
      return exhaustive;
    }
  }
}
async function simpleStep(
  args: SimpleArgs,
  stamp: VerdictStamp
): Promise<SimpleStep> {
  const rows = nonEmpty(await readRows(args));
  if (rows === null) throw new Error("watch context cannot be empty");
  if (args.statusOnly)
    return terminal(
      stamp({
        kind: "STATUS",
        terminal: true,
        exitCode: 0,
        reason: "status-only",
        rows,
      })
    );
  if (args.mode === "queued-stack")
    throw new Error("queued-stack requires status-only in the simple runner");
  const { mode } = args;
  if (mode === "stack")
    args.dependencies.emit(
      stamp({ kind: "STATUS", terminal: false, reason: "poll", rows }, mode)
    );
  return decide(args, mode, stamp, rows);
}
export function runSimple(args: SimpleArgs): Promise<T.TerminalVerdict> {
  const stamp = verdictFactory(args.dependencies.clock, args.mode);
  return pollUntilTerminal({
    dependencies: args.dependencies,
    options: args.options,
    stamp,
    step: () => simpleStep(args, stamp),
  });
}
