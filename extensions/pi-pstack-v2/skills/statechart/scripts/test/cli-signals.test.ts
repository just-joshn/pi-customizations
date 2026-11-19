import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { assertEmpty, assertGone, gridCase, signalWhile, sleepyJava, startCommand } from "./cli-process-support.ts";
import { copyCase, corpus, read, run } from "./cli-support.ts";


const blockingView = (drawing: string, release: string) =>
  [
    `import fs from "node:fs";`,
    `export const state = (v) => {`,
    `  if (!fs.existsSync(${JSON.stringify(drawing)})) {`,
    `    fs.writeFileSync(${JSON.stringify(drawing)}, String(process.pid));`,
    `    for (const end = Date.now() + 20_000; Date.now() < end && !fs.existsSync(${JSON.stringify(release)}); );`,
    `  }`,
    `  return JSON.stringify(v);`,
    `};`,
    ``,
  ].join("\n");

const spinningView = (drawing: string) =>
  [
    `import fs from "node:fs";`,
    `export const state = (v) => {`,
    `  if (!fs.existsSync(${JSON.stringify(drawing)})) {`,
    `    fs.writeFileSync(${JSON.stringify(drawing)}, "");`,
    `    for (const end = Date.now() + 30_000; Date.now() < end; );`,
    `  }`,
    `  return JSON.stringify(v);`,
    `};`,
    ``,
  ].join("\n");

test(
  "a SIGKILL of the command stops TLC, removes the temporary folder, and writes nothing",
  { timeout: 30_000 },
  async () => {
    const fakes = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-fakes-"));
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-parent-"));
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-tmpdir-"));
    const { java, pidFile } = sleepyJava(fakes);
    const child = startCommand(path.join(corpus, "DieHard"), parent, { java, tmpdir });
    const exited = once(child, "exit");
    while (!fs.existsSync(pidFile)) await sleep(20);
    child.kill("SIGKILL");
    await exited;
    await assertGone(Number(read(pidFile)));
    await assertEmpty(parent);
    await assertEmpty(tmpdir);
  },
);

test(
  "a SIGKILL of the command while the view draws the chart leaves no folder behind",
  { timeout: 30_000 },
  async () => {
    const fakes = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-fakes-"));
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-parent-"));
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-tmpdir-"));
    const drawing = path.join(fakes, "drawing");
    const release = path.join(fakes, "release");
    const dir = copyCase("Login", (d) =>
      fs.writeFileSync(path.join(d, "view.mjs"), blockingView(drawing, release)),
    );
    const child = startCommand(dir, parent, { tmpdir });
    const exited = once(child, "exit");
    while (!fs.existsSync(drawing) || !read(drawing)) await sleep(20);
    child.kill("SIGKILL");
    await exited;
    fs.writeFileSync(release, "");
    await assertGone(-Number(read(drawing)));
    await assertEmpty(parent);
    await assertEmpty(tmpdir);
  },
);

test(
  "a check killed by a signal stops the command with exit 2, and it writes nothing",
  { timeout: 30_000 },
  async () => {
    const fakes = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-fakes-"));
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-parent-"));
    const { java, pidFile } = sleepyJava(fakes);
    const child = startCommand(path.join(corpus, "DieHard"), parent, { java });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    const closed = once(child, "close");
    while (!fs.existsSync(pidFile) || !read(pidFile)) await sleep(20);
    const ps = spawnSync("ps", ["-o", "ppid=", "-p", read(pidFile)], { encoding: "utf8" });
    process.kill(Number(ps.stdout), "SIGKILL");
    const [status] = await closed;
    assert.equal(stderr, "SIGKILL killed the check, so the command wrote nothing.\n");
    assert.equal(status, 2);
    assert.deepEqual(fs.readdirSync(parent), []);
  },
);

const sleepyPhase = (fakes: string) => {
  const fake = sleepyJava(fakes);
  return {
    dir: path.join(corpus, "DieHard"),
    ...fake,
    reached: () => fs.existsSync(fake.pidFile),
  };
};

const drawingPhase = (fakes: string) => {
  const drawing = path.join(fakes, "drawing");
  const dir = copyCase("Login", (d) =>
    fs.writeFileSync(path.join(d, "view.mjs"), spinningView(drawing)),
  );
  return { dir, reached: () => fs.existsSync(drawing) };
};

const wroteChart = (parent: string) =>
  fs
    .readdirSync(parent, { recursive: true, encoding: "utf8" })
    .some(
      (f) =>
        path.basename(f) === "chart.mmd" &&
        fs.statSync(path.join(parent, f), { throwIfNoEntry: false })?.size,
    );

const writingPhase = () => ({ dir: gridCase(150), reached: wroteChart });

for (const signal of ["SIGINT", "SIGTERM"] satisfies NodeJS.Signals[]) {
  test(
    `${signal} stops TLC, removes the temporary folder, and writes nothing`,
    { timeout: 30_000 },
    async () => {
      const { pidFile } = await signalWhile(signal, sleepyPhase);
      await assertGone(Number(read(pidFile)));
    },
  );

  test(
    `${signal} while the view draws the chart stops the command, and it writes nothing`,
    { timeout: 60_000 },
    () => signalWhile(signal, drawingPhase),
  );

  test(
    `${signal} while the command writes its files stops it, and it writes nothing`,
    { timeout: 60_000 },
    () => signalWhile(signal, writingPhase),
  );
}

for (const signal of ["SIGINT", "SIGTERM"] satisfies NodeJS.Signals[]) {
  test(`${signal} while the command reads TLC's last output stops the check and writes nothing`, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-late-"));
    const java = path.join(tmp, "java.mjs");
    const tmpdir = path.join(tmp, "tmpdir");
    fs.mkdirSync(tmpdir);
    const sendWhileRead = `const fs = require("node:fs");
const [dot, pid, signal, graph] = process.argv.slice(1);
setTimeout(() => process.exit(1), 30_000).unref();
fs.open(dot, "w", (error, fd) => {
  process.kill(Number(pid), signal);
  fs.writeSync(fd, fs.readFileSync(graph));
  fs.closeSync(fd);
});`;
    fs.writeFileSync(
      java,
      `#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const dot = args[args.indexOf("-dump") + 2] + ".dot";
spawnSync("mkfifo", [dot]);
const command = spawnSync("ps", ["-o", "ppid=", "-p", String(process.ppid)], { encoding: "utf8" }).stdout.trim();
spawn(process.execPath, ["-e", ${JSON.stringify(sendWhileRead)}, dot, command, ${JSON.stringify(signal)}, ${JSON.stringify(path.join(corpus, "Login", "graph.dot"))}], { detached: true, stdio: "ignore" }).unref();
`,
      { mode: 0o755 },
    );
    const r = run(path.join(corpus, "Login"), { java, env: { TMPDIR: tmpdir } });
    assert.equal(r.stderr, `${signal} stopped the check, so the command wrote nothing.\n`);
    assert.equal(r.status, 128 + os.constants.signals[signal]);
    assert.deepEqual(fs.readdirSync(tmpdir), []);
    assert.equal(fs.existsSync(r.out), false);
  });
}


