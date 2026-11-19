import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { inspect } from "node:util";
import { checkView } from "../frontends/view.ts";
import { type Bug, type Graph, hasSection, type Rule, stateRules, type View } from "../ir.ts";
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

const verdictFiles = (name: string) =>
  fs
    .readdirSync(path.join(here, "corpus", name))
    .toSorted()
    .filter((f) => /^verdict-\d+\.out$/.test(f));

function replay(name: string, parsed: Graph) {
  const spec = corpusSpec(name);
  const names = spec.variables;
  const rules = stateRules(spec);
  const index0 = finder(parsed, names);
  const marks = readMarks(readMessages(fileLines(corpus(name, "ChartRun.out"))), "chart");
  const { graph: marked, past } = mark(parsed, marks, names, rules, index0);
  const drawn = !fs.existsSync(corpus(name, "ChartRun.exit"));
  return verdictFiles(name).reduce<Annotated>(
    (acc, f) => {
      const messages = [...readMessages(fileLines(corpus(name, f)))];
      const { broke } = readVerdict(messages);
      if (!broke) return acc;
      const rule = rules.findLast(
        (r) => r.kind === broke.kind && (broke.kind === "deadlock" || r.name === broke.name),
      );
      if (!rule) return acc;
      const dead =
        rule.kind === "deadlock" && drawn && !hasSection(spec, "CONSTRAINT", "ACTION_CONSTRAINT")
          ? deadEnds(acc.graph, rule)
          : acc.graph;
      const counterexample = readCounterexample(messages);
      if (!drawn && !lasso(dead, { seq: counterexample, loop: undefined }, names, acc.index))
        return { ...acc, graph: dead };
      return addPast(
        dead,
        counterexample,
        names,
        rule,
        past,
        hasSection(spec, "ACTION_CONSTRAINT"),
        acc.index,
      );
    },
    { graph: marked, index: index0 },
  ).graph;
}

test("each corpus bug path is the shortest way to its rule", () => {
  const paths: { [rule: string]: string[] } = {};
  for (const name of ["DieHard", "MediaPlayer", "LoginParallel", "TwoPhase", "FirstRule"]) {
    const graph = replay(name, parseDot(fileLines(corpus(name, "graph.dot"))));
    for (const bug of bugs(graph)) paths[bug.rule.name] = bug.path.map((p) => p.action);
  }
  assert.deepEqual(paths.NotSolved, [
    "FillBig",
    "BigToSmall",
    "EmptySmall",
    "BigToSmall",
    "FillBig",
    "BigToSmall",
  ]);
  assert.deepEqual(paths.LoudWhenStopped, ["YouTurnItUp"]);
  assert.equal(paths.SignedInWhileLocked.length, 5);
  assert.equal(paths.TCConsistent.length, 5);
  assert.equal(paths.TCConsistent.at(-1), "RMRcvCommitMsg");
  assert.deepEqual(paths.NotOne, ["Next"]);
  assert.deepEqual(paths.NotOneOrThree, ["Next"]);
  assert.deepEqual(paths.AlsoNotOne, ["Next"]);
  assert.deepEqual(paths.NoDeadlock, ["Next", "Next", "Next"]);
});

test("a chart of only the bug paths words each one with the view, asked once for each state and step", () => {
  const spec = corpusSpec("FirstRule");
  const rules = stateRules(spec);
  const broken = verdictFiles("FirstRule").flatMap((f) => {
    const messages = [...readMessages(fileLines(corpus("FirstRule", f)))];
    const { broke } = readVerdict(messages);
    const breaks = (rule: Rule) =>
      broke?.kind === rule.kind && (broke.kind === "deadlock" || rule.name === broke.name);
    return rules.filter(breaks).map((rule) => ({ rule, trace: readCounterexample(messages) }));
  });
  const drawn = broken.reduce<{ paths: PathGraph; found: Bug[] }>(
    ({ paths: acc, found }, { rule, trace }) => {
      const [next, bug] = withBug(acc, rule, trace);
      return { paths: next, found: [...found, bug] };
    },
    { paths: pathGraph(spec.variables), found: [] },
  );
  const paths: Bug[] = drawn.found;
  const asked: { [question: string]: number } = {};
  const count = (question: string) => (asked[question] = (asked[question] ?? 0) + 1);
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
    {
      spec: { ...spec, folder: "" },
      graph: graphOf(drawn.paths),
      paths,
      rules: [],
      properties: [],
      exit: 1,
      stop: undefined,
      drawing: undefined,
      states: { distinct: 1234, initial: 1, complete: true, cut: false },
      messages: [],
    },
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
