#!/usr/bin/env node
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { hostEnv } from "./host-env.ts";
import { killGroup, messageOf } from "./run.ts";
import { SHELL } from "./run-io.ts";

const USAGE = [
  "Usage: statechart SPEC.tla [--config FILE] [--view FILE] [--out DIR]",
  "",
  "Checks SPEC.tla with TLC and draws its state graph as Mermaid. Above 500 states, the chart",
  "draws only the paths to the rules that break, and with no rule broken there is no chart.mmd.",
  "  --config FILE  TLC config. Default: SPEC.cfg beside the spec.",
  "  --view FILE    A module that exports state(vars) and, if you want, step(action, from, to),",
  "                 group(vars), colors, and title. state() returns a string for a flat chart, an",
  "                 array for parent states, or an object for regions. Default: each state's values.",
  "                 colors gives each group blue, orange, purple, yellow, teal, tan, or pink.",
  "  --out DIR      Where to write report.md, chart.mmd, tlc.out, and tlc-RULE.out for each",
  "                 property that breaks and each rule that breaks off the chart. The folder must",
  "                 be new or empty. Default: SPEC-chart.",
  "Exit code: TLC's own on the config as written: 0 when every rule holds, 1 when a rule breaks,",
  "and 2 when TLC stops with an error, a signal kills the check, or the command cannot run. 130 or",
  "143 when SIGINT or SIGTERM stops the check. Only exits 0 and 1 write output.",
].join("\n");

let stop: NodeJS.Signals | undefined;
const stopped = new Promise<void>((resolve) => {
  for (const name of ["SIGINT", "SIGTERM"] as const)
    process.on(name, () => {
      stop ??= name;
      resolve();
    });
});

type Flags = { config?: string; view?: string; out?: string };

const parseCli = (): { flags: Flags; specFile: string } => {
  try {
    const args = parseArgs({
      allowPositionals: true,
      options: { config: { type: "string" }, view: { type: "string" }, out: { type: "string" } },
    });
    if (args.positionals.length !== 1) throw new Error("Give one SPEC.tla.");
    return { flags: args.values, specFile: args.positionals[0] };
  } catch (error) {
    console.error(`${messageOf(error)}\n\n${USAGE}`);
    return process.exit(2);
  }
};

const codeOf = (error: unknown) =>
  error instanceof Error && "code" in error ? error.code : undefined;

const unusable = (out: string, reason: string, cause: unknown) =>
  new Error(`${out} cannot be the output folder. ${reason} Pass --out with a new folder.`, {
    cause,
  });

const resolveOut = (out: string) => {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(out);
    return { entries, dest: fs.realpathSync(out) };
  } catch (error) {
    if (codeOf(error) !== "ENOENT") throw unusable(out, `${messageOf(error)}.`, error);
    if (fs.lstatSync(out, { throwIfNoEntry: false }))
      throw unusable(out, "It is a broken link.", error);
    return { entries, dest: path.resolve(out) };
  }
};

const makeStage = (dest: string) => {
  let base = path.dirname(dest);
  while (!fs.existsSync(base)) base = path.dirname(base);
  return fs.mkdtempSync(path.join(base, `.${path.basename(dest)}.statechart-`));
};

const DENO_FLAGS = [
  "run",
  "--quiet",
  "--no-prompt",
  "--allow-read",
  "--allow-write",
  "--allow-run",
  "--allow-env",
];
const JANITOR_SCRIPT = 'while read -r line; do :; done; kill -s KILL -- "-$1"; rm -rf -- "$2" "$3"';

type Job = { stage: string; specFile: string; configFile: string; view: string | undefined };

const startWorker = (job: Job, tmp: string) => {
  const runtime = process.versions.deno ? DENO_FLAGS : process.execArgv;
  const worker = spawn(
    process.execPath,
    [
      ...runtime,
      path.join(import.meta.dirname, "worker.ts"),
      job.stage,
      job.specFile,
      job.configFile,
      ...(job.view ? [job.view] : []),
    ],
    {
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...hostEnv(), TMPDIR: tmp },
    },
  );
  const janitor = spawn(
    SHELL,
    ["-c", JANITOR_SCRIPT, "sh", String(worker.pid), job.stage, tmp],
    {
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
    },
  );
  return { worker, janitor };
};

const publish = (done: string, dest: string, out: string) => {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(done, dest);
  } catch (error) {
    if (codeOf(error) !== "ENOTEMPTY" && codeOf(error) !== "EEXIST") throw error;
    throw new Error(
      `${path.join(out, fs.readdirSync(dest).toSorted()[0])} appeared while the check ran, so the command wrote nothing. Pass --out with a new folder.`,
      { cause: error },
    );
  }
  process.stdout.write(fs.readFileSync(path.join(dest, "report.md")));
  process.stdout.write(`\nWrote ${out}\n`);
};

const SIGNAL_EXIT_BASE = 128;

const outcome = async (worker: ChildProcess, done: string, dest: string, out: string) => {
  const exited = new Promise<number>((resolve) => worker.on("exit", (code) => resolve(code ?? 2)));
  await Promise.race([stopped, exited]);
  await killGroup(worker.pid as number);
  const verdict = await exited;
  if (stop) {
    console.error(`${stop} stopped the check, so the command wrote nothing.`);
    return SIGNAL_EXIT_BASE + os.constants.signals[stop];
  }
  if (worker.signalCode) {
    console.error(`${worker.signalCode} killed the check, so the command wrote nothing.`);
    return 2;
  }
  if ((verdict !== 0 && verdict !== 1) || !fs.existsSync(done)) return 2;
  publish(done, dest, out);
  return verdict;
};

const execute = async (job: Job, dest: string, out: string) => {
  let tmp: string | undefined;
  let janitor: ChildProcess | undefined;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-"));
    const started = startWorker(job, tmp);
    janitor = started.janitor;
    return await outcome(started.worker, path.join(job.stage, "done"), dest, out);
  } finally {
    fs.rmSync(job.stage, { recursive: true, force: true });
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    janitor?.kill("SIGKILL");
  }
};

const main = async (flags: Flags, specFile: string) => {
  const configFile = flags.config ?? specFile.replace(/\.tla$/, ".cfg");
  if (!fs.existsSync(configFile))
    throw new Error(`Cannot find the TLC config ${configFile}. Pass --config FILE.`);
  const out = flags.out ?? specFile.replace(/\.tla$/, "-chart");
  const { entries, dest } = resolveOut(out);
  if (entries.length)
    throw new Error(
      `${out} is not empty. It has ${entries.toSorted()[0]}. The command writes only to a new or empty folder. Pass --out with a new folder.`,
    );
  const stage = makeStage(dest);
  return execute({ stage, specFile, configFile, view: flags.view }, dest, out);
};

const { flags, specFile } = parseCli();
try {
  process.exit(await main(flags, specFile));
} catch (error) {
  console.error(messageOf(error));
  process.exit(2);
}
