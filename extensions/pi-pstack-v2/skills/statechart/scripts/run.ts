import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boundRun, chartRun, configText } from "./backends/cfg.ts";
import { readConfig } from "./frontends/config.ts";
import { parseDot } from "./frontends/dot.ts";
import { readCounterexample, readMarks } from "./frontends/marks.ts";
import { readMessages } from "./frontends/messages.ts";
import { initialOnlyProperties, readChecks, readSany, readSpec } from "./frontends/spec.ts";
import { readTrace } from "./frontends/trace.ts";
import { readVerdict } from "./frontends/verdict.ts";
import {
  type Bug,
  CHART_STATES,
  type CheckResult,
  type ConfigSection,
  hasSection,
  type Lasso,
  must,
  type Property,
  type Rule,
  ruleKey,
  type Spec,
  stateRules,
  type Trace,
  type Verdict,
} from "./ir.ts";
import { addPast, deadEnds, finder, lasso, mark } from "./passes/annotate.ts";
import { pathGraph } from "./passes/paths.ts";
import { type FileResult, fileLines, messagesOf, runToFiles } from "./run-io.ts";
import { judge } from "./run-judge.ts";
import { exitClass, findTlc, only, PINNED_FLAGS, sanyErrors, stopOf, tail } from "./run-tlc.ts";

export { fileLines, killGroup, messageOf } from "./run-io.ts";
export { PINNED_FLAGS } from "./run-tlc.ts";

const SANY_JVM = ["-XX:TieredStopAtLevel=1"];

type Runner = {
  config: (name: string, sections: ConfigSection[], extra: string[]) => string[];
  java: (name: string, main: string, args: string[], jvm?: string[]) => Promise<FileResult>;
};

const makeRunner = (dir: string, folder: string, tlc: { jar: string; java: string }): Runner => ({
  config: (name, sections, extra) => {
    fs.writeFileSync(path.join(dir, `${name}.cfg`), configText(sections, extra));
    return ["-metadir", path.join(dir, `meta-${name}`), "-config", path.join(dir, `${name}.cfg`)];
  },
  java: (name, main, args, jvm = []) => {
    const tmp = path.join(dir, `tmp-${name}`);
    fs.mkdirSync(tmp);
    return runToFiles(
      tlc.java,
      [`-Djava.io.tmpdir=${tmp}`, `-DTLA-Library=${folder}`, ...jvm, "-cp", tlc.jar, main, ...args],
      {
        cwd: dir,
        out: path.join(dir, name),
        env: process.platform === "darwin" ? process.env : { ...process.env, LC_ALL: "C.UTF-8" },
      },
    );
  },
});

async function loadSany(run: Runner, specFile: string) {
  const xml = await run.java(
    "sany",
    "tla2sany.xml.XMLExporter",
    ["-o", "-I", path.dirname(path.resolve(specFile)), path.resolve(specFile)],
    SANY_JVM,
  );
  if (xml.status !== 0) {
    const rerun = xml.error
      ? undefined
      : await run.java("sany-errors", "tla2sany.SANY", [path.resolve(specFile)], SANY_JVM);
    const errors = rerun && sanyErrors(rerun);
    throw new Error(
      `SANY could not read ${specFile} (exit ${xml.status}):\n${errors ?? tail(xml)}`,
    );
  }
  return readSany(fs.readFileSync(xml.stdout, "utf8"));
}

type Checked = {
  spec: Spec & { folder: string };
  specFile: string;
  dir: string;
  rules: Rule[];
  all: Rule[];
  verdicts: Map<string, Verdict>;
  run: Runner;
  initialOnly: Set<string>;
};

type Dot = ReturnType<typeof parseDot>;

const failed = (specFile: string, r: FileResult) =>
  new Error(`TLC could not check ${specFile} (exit ${r.status}):\n${stopOf(r).message}`);

const propertiesWith = (k: Checked, bugOf: (trace: Trace) => Lasso | undefined): Property[] =>
  k.all
    .filter((rule) => rule.kind === "property")
    .map((rule) => {
      const v = must(k.verdicts, ruleKey(rule));
      return {
        ...v,
        bug: v.outcome === "broken" && v.messages ? bugOf(readTrace(v.messages)) : undefined,
        initialOnly: k.initialOnly.has(rule.name),
      };
    });

type Drawing = { status: number | null } | undefined;
type Annotation = {
  graph: Dot;
  drawing: Drawing;
  find: ReturnType<typeof finder>;
  past: ReturnType<typeof mark>;
};

const annotateRule = (k: Checked, rule: Rule, { graph, drawing, find, past }: Annotation): Dot => {
  const { outcome, messages } = must(k.verdicts, ruleKey(rule));
  const deadlocked = rule.kind === "deadlock" && outcome === "broken";
  if (deadlocked && !drawing && !hasSection(k.spec, "CONSTRAINT", "ACTION_CONSTRAINT"))
    deadEnds(graph, rule);
  if (outcome !== "broken" || !messages) return graph;
  const counterexample = readCounterexample(messages);
  const { variables } = k.spec;
  if (drawing && !lasso(graph, { seq: counterexample, loop: undefined }, variables, find))
    return graph;
  const excludes = hasSection(k.spec, "ACTION_CONSTRAINT");
  return addPast(graph, counterexample, variables, rule, past, excludes, find);
};

const annotate = (k: Checked, graph: Dot, drawn: FileResult, tag: string): Annotation => {
  const find = finder(graph, k.spec.variables);
  const broken = new Set(
    [...k.verdicts.values()]
      .filter(({ rule, outcome }) => rule.kind === "invariant" && outcome === "broken")
      .map(({ rule }) => rule.name),
  );
  const marks = only(readMarks(readMessages(fileLines(drawn.stdout)), tag), broken);
  const past = mark(graph, marks, k.spec.variables, k.rules, find);
  const drawing = drawn.status === 0 ? undefined : { status: drawn.status };
  const annotation = { graph, drawing, find, past };
  const annotated = k.rules.reduce(
    (g, rule) => annotateRule(k, rule, { ...annotation, graph: g }),
    graph,
  );
  return { ...annotation, graph: annotated };
};

type Common = Omit<CheckResult, "graph" | "paths" | "properties" | "drawing">;

async function drawChart(k: Checked, common: Common): Promise<CheckResult | undefined> {
  const { spec, run, dir } = k;
  const tag = `chart-${randomBytes(16).toString("hex")}`;
  fs.writeFileSync(path.join(dir, "ChartRun.tla"), chartRun(spec, tag));
  const drawn = await run.java("ChartRun", "tlc2.TLC", [
    "-tool",
    ...PINNED_FLAGS,
    "-deadlock",
    ...run.config("ChartRun", spec.written, ["INVARIANT ChartMark", "CONSTRAINT ChartBudget"]),
    "-dump",
    "dot,actionlabels",
    path.join(dir, "graph"),
    "ChartRun",
  ]);
  const file = path.join(dir, "graph.dot");
  if (!fs.existsSync(file)) throw failed(k.specFile, drawn);
  if (readVerdict(messagesOf(drawn.output)).distinct > CHART_STATES) return undefined;
  const { graph, drawing, find } = annotate(k, parseDot(fileLines(file)), drawn, tag);
  const properties = propertiesWith(k, (trace) => lasso(graph, trace, spec.variables, find));
  return { ...common, graph, paths: undefined, properties, drawing };
}

const pathResult = (k: Checked, common: Common): CheckResult => {
  const drawn = pathGraph(k.spec.variables);
  const paths: Bug[] = k.rules.flatMap((rule) => {
    const { outcome, messages } = must(k.verdicts, ruleKey(rule));
    return outcome === "broken" && messages ? [drawn.bug(rule, readCounterexample(messages))] : [];
  });
  return {
    ...common,
    graph: drawn.graph,
    paths,
    properties: propertiesWith(k, drawn.lasso),
    drawing: undefined,
  };
};

const judged = (k: Omit<Checked, "initialOnly">) =>
  judge({
    specFile: k.specFile,
    module: k.spec.module,
    all: k.all,
    verdicts: k.verdicts,
    runJava: k.run.java,
    config: (name, extra) => k.run.config(name, k.spec.written, extra),
  });

async function checkIn(dir: string, specFile: string, configFile: string): Promise<CheckResult> {
  const cfg = readConfig({ file: configFile, text: fs.readFileSync(configFile, "utf8") });
  const checks = readChecks({ configFile, config: cfg });
  const folder = path.dirname(path.resolve(specFile));
  const run = makeRunner(dir, folder, await findTlc(dir));
  const sany = await loadSany(run, specFile);
  const spec = { ...readSpec({ module: path.basename(specFile, ".tla"), sany, checks }), folder };
  const rules = stateRules(spec);
  const all: Rule[] = [
    ...rules,
    ...spec.properties.map((name) => ({ kind: "property" as const, name })),
  ];
  const base = { spec, specFile, dir, rules, all, verdicts: new Map<string, Verdict>(), run };
  fs.writeFileSync(path.join(dir, "ChartBound.tla"), boundRun(spec.module));
  const result = await judged(base);
  const k: Checked = { ...base, initialOnly: initialOnlyProperties(sany, spec) };
  const exit = exitClass(result.first.status);
  if (exit === 2) throw failed(specFile, result.first);
  const common: Common = {
    spec,
    exit,
    stop: result.stop,
    states: result.states,
    messages: messagesOf(result.first.output),
    rules: rules.map((rule) => must(k.verdicts, ruleKey(rule))),
  };
  const charted = result.states.distinct <= CHART_STATES ? await drawChart(k, common) : undefined;
  return charted ?? pathResult(k, common);
}

export async function check(specFile: string, configFile: string): Promise<CheckResult> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-"));
  try {
    return await checkIn(dir, specFile, configFile);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
