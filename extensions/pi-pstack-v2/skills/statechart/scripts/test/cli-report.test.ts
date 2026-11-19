import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { plainText } from "../backends/plain-text.ts";
import { readMessages } from "../frontends/messages.ts";
import { copyCase, corpus, here, read, run } from "./cli-support.ts";


const overBudget = (file: string) =>
  fs.writeFileSync(file, read(file).replace(/\b\d+( distinct states found)/g, "1234$1"));


test("a broken property is named in the report, and its TLC trace is in tlc-NAME.out", () => {
  const dir = path.join(corpus, "MediaPlayerProps");
  const r = run(dir);
  assert.equal(r.status, 1);
  for (const p of ["EventuallyPlays", "QuietWhenStopped"]) {
    assert.match(r.report, new RegExp(`^## ${p} breaks\n.*tlc-${p}\\.out`, "m"));
    const out = read(path.join(r.out, `tlc-${p}.out`));
    const from = Object.keys(r.configs).filter((name) => {
      const tool = name.startsWith("verdict-") && read(path.join(dir, `${name}.out`));
      return tool && out === `${[...plainText(readMessages(tool))].join("")}\n`;
    });
    assert.equal(from.length, 1, p);
    assert.match(r.configs[from[0]], new RegExp(`^PROPERTY ${p}$`, "m"));
    assert.match(out, /^TLC2 Version /);
    assert.doesNotMatch(out, /@!@!@/);
  }
  assert.match(read(path.join(r.out, "tlc-QuietWhenStopped.out")), /^State 2: <YouTurnItUp /m);
  assert.match(r.report, /^## Rules that hold\n.*\bEventuallyStops\b.*\bStaysTyped\b/m);
});

test("TLC checks the rules and draws the chart with VIEW and SYMMETRY, and the report says an arrow can lead to a representative", () => {
  const dir = copyCase("MediaPlayer", (d) =>
    fs.appendFileSync(path.join(d, "MediaPlayer.cfg"), "\nVIEW vars\nSYMMETRY Perms\n"),
  );
  const r = run(dir);
  assert.equal(r.status, 1);
  const verdict = r.configs["verdict-1"];
  assert.match(verdict, /^PROPERTY EventuallyStops$/m);
  for (const config of [verdict, r.configs.ChartRun]) {
    assert.match(config, /^VIEW vars$/m);
    assert.match(config, /^SYMMETRY Perms$/m);
  }
  assert.match(
    r.report,
    /^With VIEW and SYMMETRY, TLC keeps one representative for each group of states that it counts as the same\. An arrow can lead to the representative rather than to the state that the step reaches\.$/m,
  );
  assert.doesNotMatch(run(path.join(corpus, "MediaPlayer")).report, /representative/);
});


test("a check above the chart budget skips the drawing run and draws only the bug paths", () => {
  const dir = copyCase("FirstRule", (d) => {
    for (const f of fs.readdirSync(d))
      if (/^verdict-\d+\.out$/.test(f)) overBudget(path.join(d, f));
  });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.equal(r.configs.ChartRun, undefined);
  assert.ok(r.files.includes("chart.mmd"));
  assert.match(
    r.report,
    /^TLC reached more states than the chart budget of 500, so the chart draws only the bug paths: 4 states and 3 arrows\.$/m,
  );
  for (const rule of ["NotOne", "NotOneOrThree", "AlsoNotOne", "NoDeadlock"])
    assert.match(r.report, new RegExp(`^## ${rule} breaks$`, "m"));
});

test("a passing check above the chart budget writes no chart.mmd and gives the state count", () => {
  const dir = copyCase("Login", (d) => overBudget(path.join(d, "verdict-1.out")));
  const r = run(dir);
  assert.equal(r.status, 0);
  assert.equal(r.configs.ChartRun, undefined);
  assert.deepEqual(r.files, ["report.md", "tlc.out"]);
  assert.match(
    r.report,
    /^TLC reached 1,234 states, more than the chart budget of 500, so the command wrote no chart\.mmd\.$/m,
  );
  assert.match(r.report, /^## Rules that hold\nTypeOK, NoDeadlock$/m);
});

test("a property that INSTANCE actions break above the chart budget draws their qualified names and the loop", () => {
  const dir = copyCase("CounterInstance", (d) => overBudget(path.join(d, "verdict-1.out")));
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.equal(r.configs.ChartRun, undefined);
  assert.match(
    r.report,
    /^1\. C!Up: 1\n2\. C!Up: 2\n3\. C!Back: 1\nThe run loops through "1" and "2" forever\.$/m,
  );
  assert.match(read(path.join(r.out, "chart.mmd")), /^  s\d+ --> s\d+: C!Back$/m);
});

test("a drawing run that counts more states than the chart budget gives only the bug paths", () => {
  const dir = copyCase("FirstRule", (d) => overBudget(path.join(d, "ChartRun.out")));
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.configs.ChartRun, /^CONSTRAINT ChartBudget$/m);
  assert.match(
    r.report,
    /^TLC reached more states than the chart budget of 500, so the chart draws only the bug paths: 4 states and 3 arrows\.$/m,
  );
});

test("a property with no temporal operator says TLC checked it only in the initial states", () => {
  const r = run(path.join(corpus, "Counter"));
  assert.equal(r.status, 0);
  assert.match(r.report, /^## Rules that hold\nLow, StaysSmall\n/m);
  assert.match(
    r.report,
    /^TLC checked Low only in the initial states, because it has no \[\], <>, or ~>\. List it as an INVARIANT to check every state\.$/m,
  );
  assert.doesNotMatch(r.report, /TLC checked StaysSmall/);
});

test("a property that the config replaces with a state predicate gets the initial-states note", () => {
  const dir = copyCase("Counter", (d) =>
    fs.writeFileSync(
      path.join(d, "Counter.cfg"),
      "SPECIFICATION Spec\nCONSTANT StaysSmall <- Low\nPROPERTY StaysSmall\nCHECK_DEADLOCK FALSE\n",
    ),
  );
  const r = run(dir);
  assert.equal(r.status, 0);
  assert.match(r.report, /^TLC checked StaysSmall only in the initial states, /m);
});

test("a property that an extended module also defines as LOCAL takes the root definition's level", () => {
  const r = run(path.join(corpus, "Shadow"));
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.report, /TLC checked Shadow/);
  assert.match(r.report, /^TLC checked Shade only in the initial states, /m);
  assert.match(r.report, /^TLC checked Hold only in the initial states, /m);
});

test("a property from an extended module gets the initial-states note too", () => {
  const dir = copyCase("MediaPlayerProps", (d) => {
    fs.appendFileSync(path.join(d, "MediaPlayerProps.cfg"), "\nPROPERTY TypeOK\n");
    fs.copyFileSync(path.join(d, "verdict-6.out"), path.join(d, "verdict-7.out"));
  });
  const r = run(dir);
  assert.match(r.report, /^TLC checked TypeOK only in the initial states, /m);
  assert.doesNotMatch(r.report, /TLC checked (EventuallyStops|StaysTyped)/);
});

test("a spec that SANY cannot read stops the command with exit 2", () => {
  const dir = copyCase("MediaPlayer", (d) => fs.writeFileSync(path.join(d, "sany.exit"), "150\n"));
  const r = run(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /SANY could not read .*MediaPlayer\.tla \(exit 150\)/);
  assert.deepEqual(r.files, []);
});

test("a first verdict run that TLC cannot finish stops the command with exit 2", () => {
  const dir = copyCase("Login", (d) => fs.writeFileSync(path.join(d, "verdict-1.exit"), "150\n"));
  const r = run(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /TLC could not check .*Login\.tla \(exit 150\)/);
  assert.deepEqual(r.files, []);
});

test("a later verdict run that TLC cannot finish keeps the exit and leaves its rules not checked", () => {
  const dir = copyCase("CounterJump", (d) =>
    fs.writeFileSync(path.join(d, "verdict-2.exit"), "150\n"),
  );
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.report, /^## NotThree breaks$/m);
  assert.match(
    r.report,
    /^## Rules not checked\nNoDeadlock\nTLC stopped with exit 150 before it checked this rule:$/m,
  );
});

test("a drawing run that TLC cannot finish stops the command with exit 2", () => {
  const dir = copyCase("Login", (d) => {
    fs.rmSync(path.join(d, "graph.dot"));
    fs.writeFileSync(path.join(d, "ChartRun.exit"), "150\n");
  });
  const r = run(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /TLC could not check .*Login\.tla \(exit 150\)/);
});

test("a java that cannot start stops the command with exit 2 on a runtime that emits no close for it", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-no-java-"));
  const noClose = path.join(tmp, "no-close.mjs");
  fs.writeFileSync(
    noClose,
    `import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const { spawn } = childProcess;
childProcess.spawn = (...args) => {
  const child = spawn(...args);
  const { emit } = child;
  child.emit = (name, ...rest) =>
    name === "close" && child.pid === undefined ? false : emit.call(child, name, ...rest);
  return child;
};
syncBuiltinESMExports();
`,
  );
  const java = path.join(tmp, "java");
  const spec = path.join(corpus, "Login", "Login.tla");
  const r = run(path.dirname(spec), {
    java,
    command: [
      process.execPath,
      `--import=${pathToFileURL(noClose).href}`,
      path.join(here, "../statechart.ts"),
    ],
  });
  assert.equal(r.stderr, `SANY could not read ${spec} (exit null):\nspawn ${java} ENOENT\n`);
  assert.equal(r.status, 2);
  assert.equal(fs.existsSync(r.out), false);
});


