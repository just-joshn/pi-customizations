import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PINNED_FLAGS } from "../run.ts";
import { commandExit } from "./exit-status.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const jar = process.env.TLA2TOOLS;
export const skip = !jar && "set TLA2TOOLS to the path of tla2tools.jar to run TLC";

const RULES = /^(INVARIANTS?|PROPERTY|PROPERTIES|CHECK_DEADLOCK)$/;

const exitClass = (status: number | null) => (status === null ? 2 : commandExit(status));

const stepsIn = (text: string) =>
  Math.max((text.match(/^State \d+: (?!Stuttering$)/gm)?.length ?? 0) - 1, 0) +
  (text.match(/^Back to state \d+: </gm)?.length ?? 0);

const withSections = (cfg: string) =>
  cfg.split("\n").reduce<{ line: string; section: string }[]>(
    (acc, line) => [
      ...acc,
      { line, section: line.match(/^[A-Z_]+/)?.[0] ?? acc.at(-1)?.section ?? "" },
    ],
    [],
  );

function properties(cfg: string) {
  return withSections(cfg)
    .filter(({ section }) => /^PROPERT(Y|IES)$/.test(section))
    .flatMap(({ line, section }) =>
      line
        .trim()
        .split(/\s+/)
        .filter((word) => word && word !== section),
    );
}

function tlc(dir: string, module: string, cfg: string) {
  const run = `alone-${fs.readdirSync(dir).length}`;
  const file = path.join(dir, `${run}.cfg`);
  fs.writeFileSync(file, cfg);
  const tmp = path.join(dir, `${run}-tmp`);
  fs.mkdirSync(tmp);
  const r = spawnSync(
    process.env.JAVA ?? "java",
    [
      `-Djava.io.tmpdir=${tmp}`,
      "-cp",
      jar ?? "",
      "tlc2.TLC",
      ...PINNED_FLAGS,
      "-config",
      file,
      "-metadir",
      path.join(dir, `${run}-meta`),
      module,
    ],
    { cwd: dir, encoding: "utf8" },
  );
  const out = r.stdout + r.stderr;
  const temporal = properties(cfg);
  const broke =
    out.match(/^Error: (?:Invariant|Action property|Property) (\S+) is violated/m)?.[1] ??
    (/^Error: Deadlock reached\./m.test(out) ? "NoDeadlock" : undefined) ??
    (/^Error: Temporal properties were violated\./m.test(out) && temporal.length === 1
      ? temporal[0]
      : undefined);
  return { status: r.status, out, broke, steps: stepsIn(out) };
}

function alone(cfg: string, rule: string) {
  const kept = withSections(cfg)
    .filter(({ section }) => !RULES.test(section))
    .map(({ line }) => line);
  const kind = properties(cfg).includes(rule) ? "PROPERTY" : "INVARIANT";
  const added = rule === "NoDeadlock" ? [] : [`${kind} ${rule}`, "CHECK_DEADLOCK FALSE"];
  return `${[...kept, ...added].join("\n")}\n`;
}

export type Verdict = {
  status: number | null;
  breaks: Map<string, number>;
  holds: string[];
  unchecked: string[];
  chart: string;
  report: string;
};

type Plain = ReturnType<typeof tlc>;

function assertCli(cli: { status: number | null; stderr: string }, plain: Plain, report: string) {
  const shown = `${cli.stderr}${report}`;
  assert.equal(
    cli.status,
    exitClass(plain.status),
    `TLC says:\n${plain.out}\nThe command says:\n${shown}`,
  );
  assert.doesNotMatch(shown, /Chart\w*Mark/);
  if (cli.status !== 2) assert.equal(cli.stderr, "");
  if (!report) assert.match(cli.stderr, /TLC could not check/);
  if (cli.status === 2) {
    const error = plain.out.match(/^Error: .*$/m)?.[0];
    assert.ok(
      error && shown.includes(error),
      `TLC says:\n${plain.out}\nThe command says:\n${shown}`,
    );
  }
}

function readBreak(out: string, [, rule, body]: RegExpMatchArray) {
  const said = body.match(/has (\d+) steps?:/)?.[1];
  const file = body.match(/ is in (tlc-\S+\.out)\./)?.[1];
  if (!file) return { rule, steps: Number(said), bounded: false };
  const text = fs.readFileSync(path.join(out, file), "utf8");
  if (said) assert.equal(Number(said), stepsIn(text), rule);
  const bounded = /^Semantic processing of module ChartBound$/m.test(text);
  return { rule, steps: stepsIn(text), bounded };
}

const listOf = (report: string, title: string) =>
  report
    .match(new RegExp(`^## ${title}\\n(.*)$`, "m"))?.[1]
    .split(", ")
    .toSorted() ?? [];

function recheck(
  dir: string,
  module: string,
  cfg: string,
  holds: string[],
  found: { rule: string; steps: number; bounded: boolean }[],
) {
  for (const rule of holds) {
    const r = tlc(dir, module, alone(cfg, rule));
    assert.equal(r.status, 0, `${rule} holds in the report, but TLC says:\n${r.out}`);
  }
  for (const { rule, steps, bounded } of found) {
    const r = tlc(dir, module, alone(cfg, rule));
    assert.equal(r.broke, rule, `${rule} breaks in the report, but TLC says:\n${r.out}`);
    if (!bounded) assert.equal(steps, r.steps, rule);
  }
}

export function agrees(module: string, files: { [name: string]: string[] }, cfg: string): Verdict {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-plain-"));
  try {
    for (const [name, lines] of Object.entries(files))
      fs.writeFileSync(path.join(dir, `${name}.tla`), `${lines.join("\n")}\n`);
    fs.writeFileSync(path.join(dir, `${module}.cfg`), cfg);
    const out = path.join(dir, "out");
    const cli = spawnSync(
      process.execPath,
      [path.join(here, "../statechart.ts"), path.join(dir, `${module}.tla`), "--out", out],
      { encoding: "utf8" },
    );
    const plain = tlc(dir, module, cfg);
    const report = fs.existsSync(out) ? fs.readFileSync(path.join(out, "report.md"), "utf8") : "";
    const shown = `${cli.stderr}${report}`;
    assertCli(cli, plain, report);

    const found = [...report.matchAll(/^## (\S+) breaks\n(.*)$/gm)].map((m) => readBreak(out, m));
    const breaks = new Map(found.map(({ rule, steps }) => [rule, steps]));
    const holds = listOf(report, "Rules that hold");
    const unchecked = listOf(report, "Rules not checked");
    const chartFile = path.join(out, "chart.mmd");
    const chart = fs.existsSync(chartFile) ? fs.readFileSync(chartFile, "utf8") : "";
    if (plain.broke) assert.equal(breaks.get(plain.broke), plain.steps, shown);
    recheck(dir, module, cfg, holds, found);
    return { status: cli.status, breaks, holds, unchecked, chart, report };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
