import * as realChildProcess from "node:child_process";
import { EventEmitter } from "node:events";
import * as realTimers from "node:timers/promises";
import { afterEach, beforeEach, mock, setSystemTime, spyOn } from "bun:test";
import { OBSERVED_AT, parseLines, type VerdictLine } from "./output.test-helper.ts";
import { createRecorder, type Recorder } from "./recorder.test-helper.ts";

/**
 * The outside world of the real `GhGitHubReader`: the `gh` and `git` processes it spawns,
 * plus the timers and process streams of the default CLI runtime.
 */
export type GhRoute =
  | "origin"
  | "currentPr"
  | "pullRequest"
  | "openPullRequests"
  | "checks"
  | "threads"
  | "commits"
  | "rollup";
export type GhReply =
  | { readonly code?: number; readonly stdout?: string; readonly stderr?: string }
  | { readonly error: Error };
export interface GhCall {
  readonly route: GhRoute;
  readonly argv: readonly string[];
  readonly number: number | null;
  readonly after: string | null;
}
export type GhHandler = (call: GhCall) => GhReply;
export type GhRoutes = Partial<Record<GhRoute, GhHandler>>;

export const GH_PR = 42;
/** Flags for a fully explicit target, so no git or gh lookup precedes the PR read. */
export const GH_TARGET = ["--owner", "owner", "--repo", "repo", "--pr", String(GH_PR)] as const;
/** One failed query ends the run, so a test sees the status-query verdict without retries. */
export const NO_RETRIES = ["--max-query-errors", "1"] as const;

const MS_PER_SECOND = 1000;
const MAX_SLEEPS = 60;
const PR_URL = "https://github.com/owner/repo/pull/1";
const NO_MORE_PAGES = { hasNextPage: false, endCursor: null };

export const json = (value: unknown): GhReply => ({ stdout: JSON.stringify(value) });
export const exit = (code: number, stderr = ""): GhReply => ({ code, stderr });

export const rawPr = (overrides: Record<string, unknown> = {}) => ({
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: "APPROVED",
  headRefOid: "head",
  headRefName: "feature",
  baseRefName: "main",
  state: "OPEN",
  mergedAt: null,
  isDraft: false,
  ...overrides,
});
export const rawFastCheck = (
  name: string,
  bucket: string,
  state: string,
  extra: Record<string, unknown> = {}
) => ({ name, state, bucket, description: "", link: "", workflow: "", ...extra });
export const rawComment = (
  body: string,
  login: string | null,
  where: { path: string | null; line: number | null } = { path: null, line: null }
) => ({
  body,
  createdAt: "now",
  ...where,
  author: login === null ? null : { login },
});
export const rawThread = (id: string, isResolved: boolean, ...comments: unknown[]) => ({
  id,
  isResolved,
  comments: { nodes: comments },
});
const pullRequestData = (pullRequest: unknown) => ({ data: { repository: { pullRequest } } });
export const threadsPage = (nodes: readonly unknown[], pageInfo: unknown = NO_MORE_PAGES) =>
  pullRequestData({ reviewThreads: { pageInfo, nodes } });
export const rollupPage = (nodes: readonly unknown[], pageInfo: unknown = NO_MORE_PAGES) => {
  const contexts = { pageInfo, nodes };
  return pullRequestData({ commits: { nodes: [{ commit: { statusCheckRollup: { contexts } } }] } });
};
/** A rollup response for a PR whose commit has no status check rollup. */
export const emptyRollup = () =>
  pullRequestData({ commits: { nodes: [{ commit: { statusCheckRollup: null } }] } });
export const noCommits = () => pullRequestData({ commits: { nodes: [] } });
const commitNode = ([oid, state]: readonly [string, string | null]) => ({
  commit: { oid, statusCheckRollup: state === null ? null : { state } },
});
export const commitsPage = (entries: readonly (readonly [string, string | null])[]) =>
  pullRequestData({ commits: { nodes: entries.map(commitNode) } });

const HAPPY_PATH: Record<GhRoute, GhHandler> = {
  origin: () => ({ stdout: "git@github.com:owner/repo.git\n" }),
  currentPr: () => json({ number: 1, url: PR_URL }),
  pullRequest: () => json(rawPr()),
  openPullRequests: () => json([]),
  checks: () => json([rawFastCheck("ci", "pass", "SUCCESS")]),
  threads: () => json(threadsPage([])),
  commits: () => json(commitsPage([["head", "SUCCESS"]])),
  rollup: () => json(rollupPage([])),
};

const argAfter = (argv: readonly string[], prefix: string): string | null =>
  argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
const graphqlName = (argv: readonly string[]): string =>
  /query (\w+)/.exec(argAfter(argv, "query=") ?? "")?.[1] ?? "unknown";

function graphqlRoute(argv: readonly string[]): GhRoute {
  const name = graphqlName(argv);
  if (name === "ReviewThreads") return "threads";
  if (name === "PrCommitStatuses") return "commits";
  if (name === "PrCheckRollup") return "rollup";
  throw new Error(`unexpected graphql query ${name}`);
}

function routeOf(argv: readonly string[]): GhRoute {
  const [command, group, action] = argv;
  if (command === "git") return "origin";
  if (group === "api") return graphqlRoute(argv);
  if (action === "list") return "openPullRequests";
  if (action === "checks") return "checks";
  if (action === "view") return argv.includes("--repo") ? "pullRequest" : "currentPr";
  throw new Error(`unexpected spawn: ${argv.join(" ")}`);
}

function callOf(argv: readonly string[]): GhCall {
  const prArg = argAfter(argv, "pr=") ?? argv[3] ?? "";
  const parsed = Number.parseInt(prArg, 10);
  return {
    route: routeOf(argv),
    argv,
    number: Number.isNaN(parsed) ? null : parsed,
    after: argAfter(argv, "after="),
  };
}

/** One readable line per spawned command, so a test can assert what gh was asked. */
export function describeCall(call: GhCall): string {
  if (call.argv[1] !== "api") return call.argv.join(" ");
  const after = call.after === null ? "" : ` after=${call.after}`;
  return `graphql ${graphqlName(call.argv)} pr=${call.number}${after}`;
}

let routes: GhRoutes = {};
let callLog = createRecorder<GhCall>();
let sleepLog = createRecorder<number>();
let virtualSeconds = 0;

function reply(argv: readonly string[]): GhReply {
  const call = callOf(argv);
  callLog.record(call);
  return (routes[call.route] ?? HAPPY_PATH[call.route])(call);
}

class FakeStream extends EventEmitter {
  setEncoding = (): undefined => undefined;
}
class FakeChild extends EventEmitter {
  stdout = new FakeStream();
  stderr = new FakeStream();
}

function deliver(child: FakeChild, answer: GhReply): void {
  if ("error" in answer) {
    child.emit("error", answer.error);
    return;
  }
  child.stdout.emit("data", answer.stdout ?? "");
  child.stderr.emit("data", answer.stderr ?? "");
  child.emit("close", answer.code ?? 0);
}

function fakeSpawn(command: string, args: readonly string[]): FakeChild {
  const answer = reply([command, ...args]);
  const child = new FakeChild();
  queueMicrotask(() => deliver(child, answer));
  return child;
}

mock.module("node:child_process", () => ({ ...realChildProcess, spawn: fakeSpawn }));
mock.module("node:timers/promises", () => ({
  ...realTimers,
  setTimeout: async (milliseconds: number): Promise<void> => {
    if (sleepLog.items.length >= MAX_SLEEPS) throw new Error("scenario kept polling");
    sleepLog.record(milliseconds / MS_PER_SECOND);
    virtualSeconds += milliseconds / MS_PER_SECOND;
  },
}));

export interface GhRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** stdout parsed as one verdict per line; only valid in the default JSON mode. */
  readonly lines: readonly VerdictLine[];
  /** Seconds the watcher slept, in order. */
  readonly sleeps: readonly number[];
  /** Every gh or git command the watcher spawned, one readable line each. */
  readonly commands: readonly string[];
}
export interface GhCli {
  run(argv: readonly string[], overrides?: GhRoutes): Promise<GhRun>;
}

type Writer = (chunk: string | Uint8Array) => boolean;
type Spy = { mockRestore(): void };

function toRun(code: number, stdout: string, stderr: string): GhRun {
  return {
    code,
    stdout,
    stderr,
    get lines() {
      return parseLines(stdout);
    },
    sleeps: sleepLog.items,
    commands: callLog.items.map(describeCall),
  };
}

const capture =
  (sink: Recorder<string>): Writer =>
  (chunk) => {
    sink.record(String(chunk));
    return true;
  };

/**
 * Runs `main` with its default runtime: the real `GhGitHubReader`, a virtual clock,
 * and recorded stdout and stderr. Call once at file scope.
 */
export function useGhCli(): GhCli {
  let out = createRecorder<string>();
  let err = createRecorder<string>();
  let spies: readonly Spy[] = [];
  beforeEach(() => {
    routes = {};
    callLog = createRecorder<GhCall>();
    sleepLog = createRecorder<number>();
    virtualSeconds = 0;
    out = createRecorder<string>();
    err = createRecorder<string>();
    setSystemTime(new Date(OBSERVED_AT));
    spies = [
      spyOn(process.stdout, "write").mockImplementation(capture(out)),
      spyOn(process.stderr, "write").mockImplementation(capture(err)),
      spyOn(performance, "now").mockImplementation(() => virtualSeconds * MS_PER_SECOND),
    ];
  });
  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    setSystemTime();
  });
  return {
    async run(argv, overrides = {}) {
      routes = overrides;
      const { main } = await import("./cli.ts");
      const code = await main(argv);
      return toRun(code, out.items.join(""), err.items.join(""));
    },
  };
}
