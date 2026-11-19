import {
  type Bug,
  type Chart,
  type Graph,
  list,
  must,
  type Property,
  RERUN_STATES,
  ruleKey,
  type Spec,
  type Stop,
  type Story,
  type Verdict,
} from "../ir.ts";
import { type Drawing, overview, type ReportStates } from "./report-notes.ts";

const stepsOf = (story: Story) =>
  story.map(({ step, state }) => ({
    step,
    state: Object.entries(state)
      .map(([name, names]) => (name ? `${name} ` : "") + names.join(" / "))
      .join(", "),
  }));

const forever = (loop: { state: string }[], stutters: boolean | undefined) => {
  const runs = [...new Set(loop.map((p) => `"${p.state}"`))];
  if (stutters) return `The run stops in ${runs[0]} forever.`;
  return runs.length === 1
    ? `The run stays in ${runs[0]} forever.`
    : `The run loops through ${list(runs)} forever.`;
};

const fenced = (text: string) => ["```", text, "```"].join("\n");

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const bugSection = (bug: Bug, story: Story) => {
  const steps = `${bug.path.length} step${plural(bug.path.length, "", "s")}`;
  const path = stepsOf(story);
  return [
    "",
    `## ${bug.rule.name} breaks`,
    bug.rule.kind === "property"
      ? `TLC's counterexample is in tlc-${bug.rule.name}.out. It has ${steps}:`
      : `The shortest path has ${steps}:`,
    ...path.map((p, i) => `${i}. ${p.step ? `${p.step}: ` : ""}${p.state}`),
    ...(bug.loop === undefined ? [] : [forever(path.slice(bug.loop), bug.stutters)]),
  ];
};

const undrawnBreaks = (all: (Verdict | Property)[], found: Bug[]) => {
  const drawn = new Set(found.map((b) => ruleKey(b.rule)));
  return all
    .filter(
      ({ outcome, messages, rule }) =>
        outcome !== "holds" && outcome !== "not checked" && messages && !drawn.has(ruleKey(rule)),
    )
    .flatMap(({ rule }) => [
      "",
      `## ${rule.name} breaks`,
      `TLC found a counterexample. It is in tlc-${rule.name}.out.`,
    ]);
};

const namesWith = (all: (Verdict | Property)[], outcome: string) =>
  all.filter((v) => v.outcome === outcome).map((v) => v.rule.name);

const stopSection = (stop: Stop | undefined, unchecked: string[]) => {
  if (!stop) return [];
  const rules = plural(unchecked.length, "this rule", "these rules");
  return [
    ...(unchecked.length
      ? [`TLC stopped with exit ${stop.status} before it checked ${rules}:`]
      : ["", "## TLC stopped", `TLC stopped with exit ${stop.status}:`]),
    fenced(stop.message),
  ];
};

const cutNote = (unchecked: string[], cut: boolean) =>
  unchecked.length && cut
    ? [
        `After the first break, each TLC run stops at ${RERUN_STATES.toLocaleString("en-US")} distinct states. A run reached that bound before it checked ${plural(unchecked.length, "this rule", "these rules")} in every state.`,
      ]
    : [];

const initialOnlyNotes = (properties: Property[]) =>
  properties
    .filter((p) => p.outcome === "holds" && p.initialOnly)
    .map(
      (p) =>
        `TLC checked ${p.rule.name} only in the initial states, because it has no [], <>, or ~>. List it as an INVARIANT to check every state.`,
    );

type ReportInput = {
  spec: Spec;
  graph: Graph;
  paths: Bug[] | undefined;
  rules: Verdict[];
  properties: Property[];
  stop: Stop | undefined;
  drawing: Drawing;
  states: ReportStates;
};

export function report(
  { spec, graph, paths, rules, properties, stop, drawing, states }: ReportInput,
  found: Bug[],
  chart: Chart | undefined,
  stories: Map<Bug, Story>,
) {
  const all = [...rules, ...properties];
  const holds = namesWith(all, "holds");
  const unchecked = namesWith(all, "not checked");
  return [
    ...overview({ spec, graph, hasPaths: !!paths, rules, drawing, states, chart }),
    ...found.flatMap((bug) => bugSection(bug, must(stories, bug))),
    ...undrawnBreaks(all, found),
    ...(holds.length ? ["", "## Rules that hold", holds.join(", ")] : []),
    ...(unchecked.length ? ["", "## Rules not checked", unchecked.join(", ")] : []),
    ...cutNote(unchecked, states.cut),
    ...stopSection(stop, unchecked),
    ...initialOnlyNotes(properties),
  ].join("\n");
}
