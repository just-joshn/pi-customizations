import { WatcherQueryError } from "./github-json.ts";
import type * as T from "./types.ts";
import { EXIT, statusQueryVerdict } from "./verdict.ts";
import type { VerdictStamp, WatchClock } from "./verdict.ts";

const BACKOFF_FLOOR_SECONDS = 60;
const BACKOFF_CAP_SECONDS = 300;

export interface RunDependencies {
  readonly reader: T.GitHubReader;
  readonly clock: WatchClock;
  readonly emit: (verdict: T.ProgressVerdict) => void;
}
export type StepResult<V> =
  | { readonly kind: "terminal"; readonly verdict: V }
  | {
      readonly kind: "sleep";
      readonly seconds: number;
      readonly onDeadline?: () => V;
    }
  | { readonly kind: "continue" };
export const queryBackoffSeconds = (
  interval: number,
  failures: number
): number =>
  Math.min(
    Math.max(interval, BACKOFF_FLOOR_SECONDS) * 2 ** (failures - 1),
    BACKOFF_CAP_SECONDS
  );
export const deadlinePassed = (
  started: number,
  options: T.PollingOptions,
  now: number
): boolean => options.timeout > 0 && now - started >= options.timeout;

interface PollArgs<V> {
  readonly dependencies: RunDependencies;
  readonly options: T.PollingOptions;
  readonly stamp: VerdictStamp;
  readonly step: () => Promise<StepResult<V>>;
}
type PollResult<V> = V | T.BlockerVerdict | T.TimeoutVerdict;
type Attempt<V> =
  | { readonly kind: "ok"; readonly result: StepResult<V> }
  | { readonly kind: "failed"; readonly failure: T.QueryFailure };

async function attempt<V>(step: () => Promise<StepResult<V>>): Promise<Attempt<V>> {
  try {
    return { kind: "ok", result: await step() };
  } catch (error) {
    if (!(error instanceof WatcherQueryError)) throw error;
    return { kind: "failed", failure: error.failure };
  }
}
function cappedSleep<V>(args: PollArgs<V>, started: number) {
  const { clock } = args.dependencies;
  return async (seconds: number): Promise<void> => {
    const remaining =
      args.options.timeout > 0
        ? Math.max(0, args.options.timeout - (clock.now() - started))
        : seconds;
    await clock.sleep(Math.min(seconds, remaining));
  };
}
async function onQueryFailure<V>(
  args: PollArgs<V>,
  started: number,
  failure: T.QueryFailure,
  failures: number
): Promise<PollResult<V> | null> {
  const { clock, emit } = args.dependencies;
  if (!failure.retryable || failures >= args.options.maxQueryErrors)
    return statusQueryVerdict(args.stamp, failures, failure);
  const retryInSeconds = queryBackoffSeconds(args.options.interval, failures);
  emit(
    args.stamp({
      kind: "RETRY",
      terminal: false,
      failure,
      consecutiveFailures: failures,
      retryInSeconds,
    })
  );
  if (deadlinePassed(started, args.options, clock.now()))
    return args.stamp({
      kind: "TIMEOUT",
      terminal: true,
      exitCode: EXIT.timeout,
      reason: { kind: "status-unavailable", failure },
    });
  await cappedSleep(args, started)(retryInSeconds);
  return null;
}
export async function pollUntilTerminal<V>(
  args: PollArgs<V>
): Promise<PollResult<V>> {
  const { clock } = args.dependencies;
  const started = clock.now();
  const sleep = cappedSleep(args, started);
  let failures = 0;
  while (true) {
    const outcome = await attempt(args.step);
    if (outcome.kind === "failed") {
      failures += 1;
      const verdict = await onQueryFailure(args, started, outcome.failure, failures);
      if (verdict !== null) return verdict;
      continue;
    }
    failures = 0;
    const { result } = outcome;
    if (result.kind === "terminal") return result.verdict;
    if (result.kind === "sleep") {
      if (
        result.onDeadline !== undefined &&
        deadlinePassed(started, args.options, clock.now())
      )
        return result.onDeadline();
      await sleep(result.seconds);
    }
  }
}
