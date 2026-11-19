import { setTimeout as delay } from "node:timers/promises";
import {
  Command,
  CommanderError,
  InvalidArgumentError,
  Option,
} from "commander";
import {
  GhGitHubReader,
  WatcherQueryError,
  discoverStack,
  resolveContext,
} from "./github.ts";
import {
  runQueued,
  runSimple,
  statusQueryVerdict,
  verdictFactory,
  type RunDependencies,
  type WatchClock,
} from "./policy.ts";
import { renderJson, renderPretty } from "./render.ts";
import type * as T from "./types.ts";
import type { WatchMode } from "./types.ts";
import { nonEmpty, parsePrNumber } from "./types.ts";
export interface CliOptions {
  readonly owner: string | null;
  readonly repo: string | null;
  readonly pr: T.PrNumber | null;
  readonly mode: T.WatchMode;
  readonly stackPrs: readonly T.PrNumber[];
  readonly statusOnly: boolean;
  readonly pretty: boolean;
  readonly polling: T.PollingOptions;
}
const EXIT_USAGE = 64;
function positiveNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new InvalidArgumentError("must be greater than zero");
  return parsed;
}
function nonNegativeNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new InvalidArgumentError("must be zero or greater");
  return parsed;
}
function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new InvalidArgumentError("must be a positive integer");
  return parsed;
}
function prNumber(value: string): T.PrNumber {
  try {
    return parsePrNumber(Number(value.replace(/^#/, "")));
  } catch {
    throw new InvalidArgumentError("must be a positive integer");
  }
}
function stackPrList(value: string): T.NonEmpty<T.PrNumber> {
  const numbers = value.split(",").map((part) => prNumber(part.trim()));
  if (new Set(numbers).size !== numbers.length)
    throw new InvalidArgumentError("contains a duplicate PR");
  const parsed = nonEmpty(numbers);
  if (parsed === null) throw new InvalidArgumentError("cannot be empty");
  return parsed;
}
interface RawOptions {
  readonly owner?: string;
  readonly repo?: string;
  readonly pr?: T.PrNumber;
  readonly stack: boolean;
  readonly queuedStack: boolean;
  readonly stackPrs?: T.NonEmpty<T.PrNumber>;
  readonly interval: number;
  readonly sweepInterval: number;
  readonly timeout: number;
  readonly maxQueryErrors: number;
  readonly statusOnly: boolean;
  readonly allowDraft: boolean;
  readonly pretty: boolean;
}
const MS_PER_SECOND = 1_000;
const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_SWEEP_INTERVAL_SECONDS = 300;
const DEFAULT_MAX_QUERY_ERRORS = 5;
const PROGRAM_DESCRIPTION =
  "Watch one pull request, a connected stack, or an immutable queued stack.\nJSON (NDJSON while polling) is the default; --pretty renders human text.";
const addTargetOptions = (program: Command): Command =>
  program
    .option("--owner <owner>", "GitHub repository owner")
    .option("--repo <repo>", "GitHub repository name")
    .option("--pr <number>", "pull request number", prNumber)
    .addOption(
      new Option("--stack", "watch the connected open stack")
        .default(false)
        .conflicts("queuedStack")
    )
    .option(
      "--queued-stack",
      "watch the captured stack until all PRs merge",
      false
    )
    .option(
      "--stack-prs <n,...>",
      "frozen bottom-to-top queue (queued mode only)",
      stackPrList
    );
const addPollingOptions = (program: Command): Command =>
  program
    .option(
      "--interval <seconds>",
      "poll interval",
      positiveNumber,
      DEFAULT_INTERVAL_SECONDS
    )
    .option(
      "--sweep-interval <seconds>",
      "whole-stack sweep interval",
      positiveNumber,
      DEFAULT_SWEEP_INTERVAL_SECONDS
    )
    .option(
      "--timeout <seconds>",
      "deadline; 0 disables it",
      nonNegativeNumber,
      0
    )
    .option(
      "--max-query-errors <count>",
      "consecutive query-error budget",
      positiveInteger,
      DEFAULT_MAX_QUERY_ERRORS
    );
const addModeOptions = (program: Command): Command =>
  program
    .option("--status-only", "print one status table and exit 0", false)
    .option("--allow-draft", "do not treat a draft as a merge gate", false)
    .option("--pretty", "render human text instead of JSON", false);
const buildProgram = (io: Pick<CliRuntime, "stdout" | "stderr">): Command => {
  const base = new Command("watch-pr")
    .description(PROGRAM_DESCRIPTION)
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
    .exitOverride();
  return [addTargetOptions, addPollingOptions, addModeOptions].reduce(
    (program, addOptions) => addOptions(program),
    base
  );
};
const watchMode = (raw: RawOptions): WatchMode =>
  raw.queuedStack ? "queued-stack" : raw.stack ? "stack" : "single";
export function parseArgs(
  argv: readonly string[],
  io: Pick<CliRuntime, "stdout" | "stderr">
): CliOptions {
  const program = buildProgram(io);
  program.parse(argv, { from: "user" });
  const raw = program.opts<RawOptions>();
  if (raw.stackPrs !== undefined && !raw.queuedStack)
    program.error("error: --stack-prs requires --queued-stack");
  return {
    owner: raw.owner ?? null,
    repo: raw.repo ?? null,
    pr: raw.pr ?? null,
    mode: watchMode(raw),
    stackPrs: raw.stackPrs ?? [],
    statusOnly: raw.statusOnly,
    pretty: raw.pretty,
    polling: {
      interval: raw.interval,
      sweepInterval: raw.sweepInterval,
      timeout: raw.timeout,
      maxQueryErrors: raw.maxQueryErrors,
      allowDraft: raw.allowDraft,
    },
  };
}
export interface CliRuntime {
  readonly reader: T.GitHubReader;
  readonly clock: WatchClock;
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}
function realRuntime(): CliRuntime {
  return {
    reader: new GhGitHubReader(),
    clock: {
      now: () => performance.now() / MS_PER_SECOND,
      observedAt: () => new Date().toISOString(),
      sleep: async (seconds) => {
        await delay(seconds * MS_PER_SECOND);
      },
    },
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
}
async function resolveContexts(
  runtime: CliRuntime,
  options: CliOptions
): Promise<T.NonEmpty<T.PrContext>> {
  const seed = await resolveContext({
    reader: runtime.reader,
    owner: options.owner,
    repo: options.repo,
    pr: options.pr ?? options.stackPrs[0] ?? null,
  });
  return (
    nonEmpty(options.stackPrs.map((number) => ({ ...seed, number }))) ??
    (options.mode === "single"
      ? [seed]
      : await discoverStack(runtime.reader, seed))
  );
}
const exitCodeFor = (error: CommanderError): number =>
  error.exitCode === 0 ? 0 : EXIT_USAGE;
function tryParseArgs(
  argv: readonly string[],
  runtime: CliRuntime
): CliOptions | number {
  try {
    return parseArgs(argv, runtime);
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    return exitCodeFor(error);
  }
}
function runWatch(
  dependencies: RunDependencies,
  options: CliOptions,
  contexts: T.NonEmpty<T.PrContext>
): Promise<T.TerminalVerdict> {
  if (options.mode === "queued-stack" && !options.statusOnly)
    return runQueued({ dependencies, contexts, options: options.polling });
  return runSimple({
    dependencies,
    contexts,
    mode: options.mode,
    statusOnly: options.statusOnly,
    options: options.polling,
  });
}
export async function main(
  argv: readonly string[],
  runtime: CliRuntime = realRuntime()
): Promise<number> {
  const options = tryParseArgs(argv, runtime);
  if (typeof options === "number") return options;
  const render = options.pretty ? renderPretty : renderJson;
  const emit = (verdict: T.ProgressVerdict): void =>
    runtime.stdout(render(verdict));
  let contexts: T.NonEmpty<T.PrContext>;
  try {
    contexts = await resolveContexts(runtime, options);
  } catch (error) {
    if (!(error instanceof WatcherQueryError)) throw error;
    const verdict = statusQueryVerdict(
      verdictFactory(runtime.clock, options.mode),
      1,
      error.failure
    );
    runtime.stdout(render(verdict));
    return verdict.exitCode;
  }
  const dependencies = { reader: runtime.reader, clock: runtime.clock, emit };
  const verdict = await runWatch(dependencies, options, contexts);
  runtime.stdout(render(verdict));
  return verdict.exitCode;
}
