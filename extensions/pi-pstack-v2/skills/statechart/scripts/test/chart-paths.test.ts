import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { inspect } from "node:util";
import { checkView } from "../frontends/view.ts";
import { type Bug, type Graph, hasSection, type Rule, type Spec, stateRules, type View } from "../ir.ts";
import { addPast, type Annotated, deadEnds, finder, lasso, mark } from "../passes/annotate.ts";
import { graphOf, type PathGraph, pathGraph, withBug } from "../passes/paths.ts";
import { bugs } from "../passes/reach.ts";
import { parseDot } from "../frontends/dot.ts";
import { readCounterexample, readMarks } from "../frontends/marks.ts";
import { readMessages } from "../frontends/messages.ts";
import { readVerdict } from "../frontends/verdict.ts";
import { compile } from "../pipeline.ts";
import { fileLines } from "../run.ts";
import { here, corpus, corpusSpec } from "./chart-support.ts";

const longPathSteps = 5;

const verdictFiles = (name: string) =>
  fs
    .readdirSync(path.join(here, "corpus", name))
    .toSorted()
    .filter((f) => /^verdict-\d+\.out$/.test(f));

type Replay = {
  spec: Spec;
  names: string[];
  rules: Rule[];
  drawn: boolean;
  past: ReturnType<typeof mark>["past"];
};

const replayVerdict = (r: Replay, name: string, acc: Annotated, f: string) => {
  const messages = [...readMessages(fileLines(corpus(name, f)))];
  const { broke } = readVerdict(messages);
  const rule =
    broke &&
    r.rules.findLast(
      (x) => x.kind === broke.kind && (broke.kind === "deadlock" || x.name === broke.name),
    );
  if (!rule) return acc;
  const noConstraint = !hasSection(r.spec, "CONSTRAINT", "ACTION_CONSTRAINT");
  const dead =
    rule.kind === "deadlock" && r.drawn && noConstraint ? deadEnds(acc.graph, rule) : acc.graph;
  const counterexample = readCounterexample(messages);
  if (!r.drawn && !lasso(dead, { seq: counterexample, loop: undefined }, r.names, acc.index))
    return { ...acc, graph: dead };
  const constrained = hasSection(r.spec, "ACTION_CONSTRAINT");
  return addPast(dead, counterexample, r.names, rule, r.past, constrained, acc.index);
};

function replay(name: string, parsed: Graph) {
  const spec = corpusSpec(name);
  const names = spec.variables;
  const rules = stateRules(spec);
  const index0 = finder(parsed, names);
  const marks = readMarks(readMessages(fileLines(corpus(name, "ChartRun.out"))), "chart");
  const { graph: marked, past } = mark(parsed, marks, names, rules, index0);
  const drawn = !fs.existsSync(corpus(name, "ChartRun.exit"));
  const r = { spec, names, rules, drawn, past };
  return verdictFiles(name).reduce<Annotated>((acc, f) => replayVerdict(r, name, acc, f), {
    graph: marked,
    index: index0,
  }).graph;
}

test("each corpus bug path is the shortest way to its rule", () => {
  const names = ["DieHard", "MediaPlayer", "LoginParallel", "TwoPhase", "FirstRule"];
  const paths: { [rule: string]: string[] } = Object.fromEntries(
    names.flatMap((name) => {
      const graph = replay(name, parseDot(fileLines(corpus(name, "graph.dot"))));
      return bugs(graph).map((bug) => [bug.rule.name, bug.path.map((p) => p.action)] as const);
    }),
  );
  assert.deepEqual(paths.NotSolved, [
    "FillBig",
    "BigToSmall",
    "EmptySmall",
    "BigToSmall",
    "FillBig",
    "BigToSmall",
  ]);
  assert.deepEqual(paths.LoudWhenStopped, ["YouTurnItUp"]);
  assert.equal(paths.SignedInWhileLocked.length, longPathSteps);
  assert.equal(paths.TCConsistent.length, longPathSteps);
  assert.equal(paths.TCConsistent.at(-1), "RMRcvCommitMsg");
  assert.deepEqual(paths.NotOne, ["Next"]);
  assert.deepEqual(paths.NotOneOrThree, ["Next"]);
  assert.deepEqual(paths.AlsoNotOne, ["Next"]);
  assert.deepEqual(paths.NoDeadlock, ["Next", "Next", "Next"]);
});

const pathsOnlyResult = (spec: Spec, graph: Graph, paths: Bug[]) => ({
  spec: { ...spec, folder: "" },
  graph,
  paths,
  rules: [],
  properties: [],
  exit: 1 as const,
  stop: undefined,
  drawing: undefined,
  states: { distinct: 1234, initial: 1, complete: true, cut: false },
  messages: [],
});

const brokenBugs = (spec: Spec) => {
  const rules = stateRules(spec);
  const broken = verdictFiles("FirstRule").flatMap((f) => {
    const messages = [...readMessages(fileLines(corpus("FirstRule", f)))];
    const { broke } = readVerdict(messages);
    const breaks = (rule: Rule) =>
      broke?.kind === rule.kind && (broke.kind === "deadlock" || rule.name === broke.name);
    return rules.filter(breaks).map((rule) => ({ rule, trace: readCounterexample(messages) }));
  });
  return broken.reduce<{ paths: PathGraph; found: Bug[] }>(
    ({ paths: acc, found }, { rule, trace }) => {
      const [next, bug] = withBug(acc, rule, trace);
      return { paths: next, found: [...found, bug] };
    },
    { paths: pathGraph(spec.variables), found: [] },
  );
};

test("a chart of only the bug paths words each one with the view, asked once for each state and step", () => {
  const spec = corpusSpec("FirstRule");
  const drawn = brokenBugs(spec);
  let asked: { [question: string]: number } = {};
  const count = (question: string) => {
    asked = { ...asked, [question]: (asked[question] ?? 0) + 1 };
  };
  const view: View = {
    state: (v) => {
      count(`state ${v.x}`);
      return `x is ${v.x}`;
    },
    step: (action, from, to) => {
      count(`step ${from.x} to ${to.x}`);
      return `${action} adds one`;
    },
  };
  const { report: text, files } = compile(
    pathsOnlyResult(spec, graphOf(drawn.paths), drawn.found),
    checkView(view, inspect),
  );
  assert.match(
    text,
    /^TLC reached 1,234 states, more than the chart budget of 500, so the chart draws only the bug paths: 4 states and 3 arrows\.$/m,
  );
  assert.ok(files.has("chart.mmd"));
  for (const rule of ["NotOne", "NotOneOrThree", "AlsoNotOne"])
    assert.match(
      text,
      new RegExp(`^## ${rule} breaks\\n.*\\n0\\. x is 0\\n1\\. Next adds one: x is 1$`, "m"),
    );
  assert.deepEqual(asked, {
    "state 0": 1,
    "step 0 to 1": 1,
    "state 1": 1,
    "step 1 to 2": 1,
    "state 2": 1,
    "step 2 to 3": 1,
    "state 3": 1,
  });
});
