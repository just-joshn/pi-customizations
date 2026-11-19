import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { corpus, here, read } from "./cli-support.ts";
import { hostEnv } from "./host-env.ts";
import { attempt } from "./attempt.ts";

export const signalExitBase = 128;
export const pollMs = 20;
const phaseTimeoutMs = 60_000;
const pollAttempts = 250;
const gridIdBase = 1_000_000;

export function startCommand(
  dir: string,
  parent: string,
  {
    java = path.join(here, "java.ts"),
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-tmpdir-")),
  }: { java?: string; tmpdir?: string } = {},
) {
  const name = path.basename(dir);
  const view = path.join(dir, "view.mjs");
  return spawn(
    process.execPath,
    [
      path.join(here, "../statechart.ts"),
      path.join(dir, `${name}.tla`),
      ...(fs.existsSync(view) ? ["--view", view] : []),
      "--out",
      path.join(parent, "out"),
    ],
    {
      env: {
        ...hostEnv(),
        JAVA: java,
        TLA2TOOLS: "tla2tools.jar",
        STATECHART_REPLAY: dir,
        TMPDIR: tmpdir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

export async function signalWhile<T extends { dir: string; reached: (parent: string) => boolean }>(
  signal: NodeJS.Signals,
  setup: (fakes: string) => T & { java?: string },
) {
  const fakes = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-fakes-"));
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-parent-"));
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-tmpdir-"));
  const phase = setup(fakes);
  const child = startCommand(phase.dir, parent, { java: phase.java, tmpdir });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
  const closed = once(child, "close");
  const end = Date.now() + phaseTimeoutMs;
  while (!phase.reached(parent))
    assert.ok(Date.now() < end, "The command did not reach the phase.");
  child.kill(signal);
  const [status] = await closed;
  assert.equal(stderr, `${signal} stopped the check, so the command wrote nothing.\n`);
  assert.equal(status, signalExitBase + os.constants.signals[signal]);
  assert.deepEqual(fs.readdirSync(parent), []);
  assert.deepEqual(fs.readdirSync(tmpdir), []);
  return phase;
}

export async function assertGone(pid: number) {
  for (let i = 0; ; i++) {
    const { error } = await attempt(() => process.kill(pid, 0));
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    // macOS gives EPERM for a process group of only zombies, until they are reaped.
    if (error && code !== "EPERM") {
      assert.equal(code, "ESRCH");
      return;
    }
    assert.ok(
      i < pollAttempts,
      `Process ${pid} ${code ? "exited, but it was not reaped" : "is still running"}.`,
    );
    await sleep(pollMs);
  }
}

export async function assertEmpty(dir: string) {
  for (let i = 0; i < pollAttempts && fs.readdirSync(dir).length; i++) await sleep(pollMs);
  assert.deepEqual(fs.readdirSync(dir), []);
}

export function gridCase(n: number) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "statechart-case-")), "Grid");
  fs.cpSync(path.join(here, "grid"), dir, { recursive: true });
  for (const run of ["ChartRun.out", "verdict-1.out"])
    fs.copyFileSync(path.join(corpus, "Login", run), path.join(dir, run));
  const id = (x: number, y: number) => String(gridIdBase + x * n + y);
  const cell = (x: number, y: number) => [
    `${id(x, y)} [label="/\\\\ x = ${x}\\n/\\\\ y = ${y}"${x + y ? "" : ",style = filled"}]`,
    ...(x + 1 < n ? [`${id(x, y)} -> ${id(x + 1, y)} [label="IncX"];`] : []),
    ...(y + 1 < n ? [`${id(x, y)} -> ${id(x, y + 1)} [label="IncY"];`] : []),
  ];
  const lines = [
    "strict digraph DiskGraph {",
    ...Array.from({ length: n * n }, (_, k) => cell(Math.floor(k / n), k % n)).flat(),
    "}",
  ];
  fs.writeFileSync(path.join(dir, "graph.dot"), lines.join("\n"));
  return dir;
}

export function sleepyJava(fakes: string) {
  const java = path.join(fakes, "java.mjs");
  const pidFile = path.join(fakes, "java.pid");
  fs.writeFileSync(
    java,
    `#!/usr/bin/env node\nimport fs from "node:fs";\n` +
      `process.on("SIGTERM", () => {});\n` +
      `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n` +
      `setTimeout(() => {}, 60_000);\n`,
    { mode: 0o755 },
  );
  return { java, pidFile };
}

