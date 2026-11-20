import "./gh.test-helper.ts";
import { fakeReader, type FakeReader } from "./fakes.test-helper.ts";
import { OBSERVED_AT, parseLines, type VerdictLine } from "./output.test-helper.ts";
import { createRecorder } from "./recorder.test-helper.ts";

const { main } = await import("./cli.ts");

const MAX_SLEEPS = 60;

/** Explicit target flags, so no test depends on the checkout it runs in. */
export const TARGET = ["--owner", "owner", "--repo", "repo", "--pr", "1"] as const;
export const STACK_TARGET = ["--owner", "owner", "--repo", "repo", "--pr", "2"] as const;

export interface FakeClock {
  now(): number;
  observedAt(): string;
  sleep(seconds: number): Promise<void>;
  /** Seconds the watcher asked to sleep, in order. */
  readonly sleeps: readonly number[];
  /** Virtual seconds elapsed. */
  readonly elapsed: number;
}

/** A virtual clock: sleeping advances time instantly and is recorded. */
export function fakeClock(): FakeClock {
  const slept = createRecorder<number>();
  let elapsed = 0;
  return {
    now: () => elapsed,
    observedAt: () => OBSERVED_AT,
    async sleep(seconds) {
      if (slept.items.length >= MAX_SLEEPS) throw new Error("scenario kept polling");
      slept.record(seconds);
      elapsed += seconds;
    },
    get sleeps() {
      return slept.items;
    },
    get elapsed() {
      return elapsed;
    },
  };
}

export interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** stdout parsed as one verdict per line; only valid in the default JSON mode. */
  readonly lines: readonly VerdictLine[];
  readonly reader: FakeReader;
  readonly clock: FakeClock;
}

/** Runs the watch-pr command the way an agent does, against a fake GitHub reader and clock. */
export async function runCli(
  argv: readonly string[],
  reader: FakeReader = fakeReader(),
  clock: FakeClock = fakeClock()
): Promise<CliRun> {
  const out = createRecorder<string>();
  const err = createRecorder<string>();
  const code = await main(argv, {
    reader,
    clock,
    stdout: out.record,
    stderr: err.record,
  });
  const stdout = out.items.join("");
  return {
    code,
    stdout,
    stderr: err.items.join(""),
    get lines() {
      return parseLines(stdout);
    },
    reader,
    clock,
  };
}
