import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inspect } from "node:util";
import { fileURLToPath } from "node:url";
import { mermaid } from "../backends/mermaid.ts";
import { report } from "../backends/report.ts";
import { readConfig } from "../frontends/config.ts";
import { readChecks, readSany, readSpec } from "../frontends/spec.ts";
import { type Bug, type Graph, type Rule, type Spec, type Value, type Vars, type View } from "../ir.ts";
import { bugs, walk } from "../passes/reach.ts";
import { project } from "../pipeline.ts";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const corpus = (name: string, file: string) => path.join(here, "corpus", name, file);

export const corpusSpec = (name: string) => {
  const configFile = corpus(name, `${name}.cfg`);
  const config = readConfig({ file: configFile, text: fs.readFileSync(configFile, "utf8") });
  return readSpec({
    module: name,
    sany: readSany(fs.readFileSync(corpus(name, "sany.out"), "utf8")),
    checks: readChecks({ configFile, config }),
  });
};

export type StateRow = [id: string, vars: Vars, start?: boolean, breaks?: string[]];
export type StepRow = [from: string, to: string, action: string];

export const graphOf = (states: StateRow[], steps: StepRow[]): Graph => ({
  states: new Map(
    states.map(([id, vars, start, breaks = []]) => [
      id,
      {
        vars,
        start: !!start,
        breaks: breaks.map((name): Rule => ({ kind: "invariant", name })),
      },
    ]),
  ),
  steps: steps.map(([from, to, action]) => ({ from, to, action })),
});

export const lookup = <K, V>(map: ReadonlyMap<K, V>, k: K) => {
  const v = map.get(k);
  assert.ok(v !== undefined, `${inspect(k)} is missing`);
  return v;
};

export const field = (value: Value, name: string) => {
  if (typeof value !== "object" || value.kind !== "function")
    throw new Error(`${inspect(value)} is not a function.`);
  for (let i = 0; i < value.keys.length; i++) {
    const k = value.keys[i];
    if (k === name || (typeof k === "object" && k.kind === "model" && k.name === name))
      return value.values[i];
  }
  throw new Error(`${inspect(value)} has no ${name}.`);
};

export function draw(graph: Graph, view: View, loops: Bug[] = []) {
  const found = [...bugs(graph), ...loops];
  const { chart, stories } = project(graph, walk(graph), view, found);
  const spec: Spec = {
    module: "Test",
    variables: [],
    invariants: [],
    properties: [],
    deadlock: false,
    written: [],
  };
  const result = {
    spec,
    graph,
    paths: undefined,
    rules: [],
    properties: [],
    stop: undefined,
    drawing: undefined,
    states: { distinct: graph.states.size, initial: 1, complete: true, cut: false },
  };
  return { chart: mermaid(chart), report: report(result, found, chart, stories) };
}

export const marked = (chart: string) => {
  const out: { [label: string]: string } = {};
  for (const [, id, cls] of chart.matchAll(/^ {2}class (s\d+) (breaks|mayBreak)$/gm)) {
    const label = chart.match(new RegExp(`^\\s*${id}: (.*)$`, "m"))?.[1];
    assert.ok(label !== undefined, `${id} has no label`);
    out[label] = cls;
  }
  return out;
};
