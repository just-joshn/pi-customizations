import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { copyCase, corpus, here, read, run } from "./cli-support.ts";
import { commandExit } from "./exit-status.ts";


const launcherMissingStatus = 127;
const idStart = 9000;
const idStep = 17;
const lcgMultiplier = 48271;
const lcgModulus = 2147483647;
const lcgSeed = 7;

const named = (report: string) => [
  ...new Set([...report.matchAll(/\btlc-\w+\.out\b/g)].map(([file]) => file)),
];


for (const name of fs.readdirSync(corpus)) {
  test(`${name} writes the committed chart and report from TLC's output`, () => {
    const dir = path.join(corpus, name);
    const r = run(dir);
    assert.equal(r.stderr, "");
    const first = path.join(dir, "verdict-1.exit");
    const plain = fs.existsSync(first) ? Number(read(first)) : 0;
    assert.equal(r.status, commandExit(plain));
    assert.equal(r.report, read(path.join(dir, "report.md")));
    assert.equal(read(path.join(r.out, "chart.mmd")), read(path.join(dir, "chart.mmd")));
    assert.deepEqual(r.files, ["chart.mmd", "report.md", "tlc.out", ...named(r.report)].toSorted());
    for (const f of r.files) assert.doesNotMatch(read(path.join(r.out, f)), /@!@!@/, f);
    assert.match(r.configs.ChartRun, /^INVARIANT ChartMark$/m);
    assert.match(r.configs.ChartRun, /^CONSTRAINT ChartBudget$/m);
  });
}

const launcher = path.join(here, "../statechart");

const launcherTools = () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-bin-"));
  for (const tool of ["dirname", "readlink", "sed"]) {
    const found = spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" });
    fs.symlinkSync(found.stdout.trim(), path.join(bin, tool));
  }
  return bin;
};

const linkedLauncher = () => {
  const links = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-links-"));
  const [first, second] = [path.join(links, "a"), path.join(links, "b")];
  fs.mkdirSync(first);
  fs.mkdirSync(second);
  fs.symlinkSync(path.relative(second, launcher), path.join(second, "statechart"));
  fs.symlinkSync(path.join(second, "statechart"), path.join(first, "statechart"));
  return path.join(first, "statechart");
};

for (const [how, command] of [
  ["by its own path", () => launcher],
  ["through an absolute and a relative symlink", linkedLauncher],
] satisfies [string, () => string][]) {
  test(`the launcher reached ${how} writes the committed chart on this Node`, () => {
    const dir = path.join(corpus, "MediaPlayer");
    const r = run(dir, {
      command: [command()],
      env: { PATH: `${path.dirname(process.execPath)}${path.delimiter}${launcherTools()}` },
    });
    assert.equal(r.stderr, "");
    assert.equal(r.status, 1);
    assert.equal(read(path.join(r.out, "chart.mmd")), read(path.join(dir, "chart.mmd")));
  });
}

const unsetNode = () => {
  const bin = launcherTools();
  fs.writeFileSync(
    path.join(bin, "node"),
    '#!/bin/sh\necho "No version is set for node." >&2\nexit 1\n',
    { mode: 0o755 },
  );
  return bin;
};

const fakeBun = (version: string) => () => {
  const bin = launcherTools();
  fs.writeFileSync(
    path.join(bin, "bun"),
    `#!/bin/sh\n[ "$1" = --version ] && echo ${version} && exit\necho "$1"\n`,
    { mode: 0o755 },
  );
  return bin;
};

test("the launcher runs statechart.ts on Bun 1.1.5 when PATH has no Node", () => {
  const r = run(path.join(corpus, "Login"), {
    command: [launcher],
    env: { PATH: fakeBun("1.1.5")() },
  });
  assert.equal(r.stderr, "");
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `${path.join(here, "../statechart.ts")}\n`);
});

for (const [what, bin] of [
  ["has none", launcherTools],
  ["has only a node that fails --version", unsetNode],
  ["has only Bun 1.1.4", fakeBun("1.1.4")],
] satisfies [string, () => string][]) {
  test(`the launcher stops with exit 127 and names only the runtimes when PATH ${what}`, () => {
    const r = run(path.join(corpus, "Login"), { command: [launcher], env: { PATH: bin() } });
    assert.equal(r.status, launcherMissingStatus);
    assert.equal(
      r.stderr,
      "statechart needs Node 22.18 to 22.x, Node 23.6 or later, Bun 1.1.5 or later, or Deno 2.0 or later.\n",
    );
    assert.deepEqual(r.files, []);
  });
}

const renumbered = (dot: string, random: () => number) => {
  const edge = /^(-?\d+)(?: -> (-?\d+))?/;
  const kept = dot.split("\n").filter((l) => /^-?\d+ (\[|->)/.test(l));
  const firstSeen = [
    ...new Set(kept.flatMap((l) => (edge.exec(l) ?? []).slice(1).filter((n) => n !== undefined))),
  ];
  const ids = new Map(firstSeen.map((n, i) => [n, String(idStart - i * idStep)]));
  const id = (n: string) => ids.get(n);
  const renumber = (l: string) =>
    l.replace(edge, (_: string, a: string, b: string | undefined) => id(a) + (b ? ` -> ${id(b)}` : ""));
  const lines = kept.map(renumber);
  const shuffled = lines.reduceRight((rest, _, i) => {
    if (i === 0) return rest;
    const j = Math.floor(random() * (i + 1));
    return rest.map((l, k) => (k === i ? rest[j] : k === j ? rest[i] : l));
  }, lines);
  return ["strict digraph DiskGraph {", ...shuffled, "}"].join("\n");
};

test("the order of TLC's dump and its state IDs do not change the chart or the report", () => {
  let seed = lcgSeed;
  const random = () => (seed = (seed * lcgMultiplier) % lcgModulus) / lcgModulus;
  for (const name of ["DieHard", "LoginParallel", "TwoPhase"]) {
    const dir = copyCase(name, (d) => {
      const file = path.join(d, "graph.dot");
      fs.writeFileSync(file, renumbered(read(file), random));
    });
    const r = run(dir);
    assert.equal(r.report, read(path.join(corpus, name, "report.md")), name);
    assert.equal(
      read(path.join(r.out, "chart.mmd")),
      read(path.join(corpus, name, "chart.mmd")),
      name,
    );
  }
});


