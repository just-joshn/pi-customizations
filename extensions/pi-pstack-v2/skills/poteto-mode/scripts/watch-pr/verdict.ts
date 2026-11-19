import type * as T from "./types.ts";
import type { WatchMode } from "./types.ts";

export interface WatchClock {
  now(): number;
  observedAt(): string;
  sleep(seconds: number): Promise<void>;
}
interface Envelope<M extends WatchMode> {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly observedAt: string;
  readonly mode: M;
}
type Payload<V> = V extends unknown
  ? Omit<V, keyof Envelope<WatchMode>>
  : never;
type VerdictPayload = Payload<T.WatcherVerdict>;
export interface VerdictStamp<M extends WatchMode = WatchMode> {
  <const P extends VerdictPayload>(payload: P): Envelope<M> & P;
  <const P extends VerdictPayload, M2 extends WatchMode>(
    payload: P,
    mode: M2
  ): Envelope<M2> & P;
}
export function verdictFactory<M extends WatchMode>(
  clock: WatchClock,
  mode: M
): VerdictStamp<M> {
  let sequence = 0;
  function stamp<const P extends VerdictPayload>(payload: P): Envelope<M> & P;
  function stamp<const P extends VerdictPayload, M2 extends WatchMode>(
    payload: P,
    mode: M2
  ): Envelope<M2> & P;
  function stamp<const P extends VerdictPayload>(
    payload: P,
    override?: WatchMode
  ): Envelope<WatchMode> & P {
    return {
      schemaVersion: 1,
      sequence: (sequence += 1),
      observedAt: clock.observedAt(),
      mode: override ?? mode,
      ...payload,
    };
  }
  return stamp;
}
export const EXIT = {
  conflicts: 2,
  threads: 3,
  checks: 4,
  timeout: 5,
  gate: 6,
  statusQuery: 7,
} as const;
export function blockerVerdict(
  stamp: VerdictStamp,
  blocker: T.MergeBlocker
): T.BlockerVerdict {
  switch (blocker.kind) {
    case "merge-conflicts":
      return stamp({ kind: "BLOCKER", terminal: true, exitCode: EXIT.conflicts, blocker });
    case "review-threads":
      return stamp({ kind: "BLOCKER", terminal: true, exitCode: EXIT.threads, blocker });
    case "failing-checks":
      return stamp({ kind: "BLOCKER", terminal: true, exitCode: EXIT.checks, blocker });
    case "merge-gate":
      return stamp({ kind: "BLOCKER", terminal: true, exitCode: EXIT.gate, blocker });
    default: {
      const exhaustive: never = blocker;
      return exhaustive;
    }
  }
}
export function statusQueryVerdict(
  stamp: VerdictStamp,
  failures: number,
  failure: T.QueryFailure
): T.BlockerVerdict {
  return stamp({
    kind: "BLOCKER",
    terminal: true,
    exitCode: EXIT.statusQuery,
    blocker: { kind: "status-query", failures, failure },
  });
}
