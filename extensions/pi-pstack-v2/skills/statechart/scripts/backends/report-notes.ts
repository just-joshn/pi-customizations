import {
  type Chart,
  CHART_STATES,
  type Graph,
  hasSection,
  list,
  must,
  type Spec,
  type Verdict,
} from "../ir.ts";

export type ReportStates = { distinct: number; initial: number; complete: boolean; cut: boolean };
export type Drawing = { status: number | null } | undefined;

type Counts = { past: number; excluded: number; pastSteps: number; size: number; arrows: number };

const count = <T>(items: Iterable<T>, test: (item: T) => boolean) => [...items].filter(test).length;

const countsOf = (graph: Graph, chart: Chart | undefined): Counts => {
  const states = [...graph.states.values()];
  const regions = chart?.regions ?? [];
  return {
    excluded: count(states, (s) => !!s.excluded),
    past: count(states, (s) => !s.excluded && !!s.past),
    pastSteps: count(graph.steps, (t) => !!must(graph.states, t.to).past),
    size: regions.reduce((sum, r) => sum + r.states.length, 0),
    arrows: regions.reduce((sum, r) => sum + r.steps.length, 0),
  };
};

const overBudget = (states: ReportStates) =>
  states.complete && !states.cut && states.distinct > CHART_STATES
    ? `${states.distinct.toLocaleString("en-US")} states, more than`
    : "more states than";

const headline = (
  spec: Spec,
  graph: Graph,
  chart: Chart | undefined,
  hasPaths: boolean,
  states: ReportStates,
  c: Counts,
) => [
  `# ${spec.module}`,
  "",
  hasPaths
    ? `TLC reached ${overBudget(states)} the chart budget of ${CHART_STATES}, so ${chart ? `the chart draws only the bug paths: ${c.size} states and ${c.arrows} arrows` : "the command wrote no chart.mmd"}.`
    : `TLC reached ${graph.states.size - c.past - c.excluded} states and ${graph.steps.length - c.pastSteps} steps. The chart draws ${c.size} states and ${c.arrows} arrows.`,
];

const emptyGraphNote = (states: ReportStates) =>
  states.initial
    ? "Every initial state is outside the constraints, so TLC explores none of them."
    : "TLC found no state that satisfies Init, so no state can break a rule.";

const pastNote = (n: number, includes: string) =>
  `${n === 1 ? "1 state outside the constraints ends" : `${n} states outside the constraints each end`} a rule's path${includes}. TLC checks the rules in a state outside the constraints, but it does not explore past it.`;

const excludedNote = (n: number, includes: string) =>
  `${n === 1 ? "1 step that the constraints exclude ends" : `${n} steps that the constraints exclude each end`} a rule's path${includes}. TLC checks the rules after such a step, but it does not take the step.`;

const constraintNotes = (chart: Chart | undefined, c: Counts) => {
  const includes = (n: number) =>
    chart ? `, and the chart includes ${n === 1 ? "it" : "them"}` : "";
  return [
    ...(c.past ? [pastNote(c.past, includes(c.past))] : []),
    ...(c.excluded ? [excludedNote(c.excluded, includes(c.excluded))] : []),
  ];
};

const chartCountNotes = (chart: Chart | undefined) => [
  ...(chart?.inside
    ? [`The chart does not draw ${chart.inside} steps that stay in one chart state.`]
    : []),
  ...(chart?.quiet
    ? [`The view hides ${chart.quiet} steps, so the chart does not draw them.`]
    : []),
];

const deadlockNote = (drawing: Drawing) =>
  drawing
    ? "The chart marks only the deadlock that TLC reports, because the drawing run stopped before it reached every state."
    : "The chart marks only the deadlock that TLC reports. Under a CONSTRAINT or an ACTION_CONSTRAINT, a state with no step in the chart can still have steps that the constraints leave out, and TLC does not count it as a deadlock.";

const deadlockNotes = (spec: Spec, rules: Verdict[], hasPaths: boolean, drawing: Drawing) =>
  rules
    .filter(
      ({ rule, outcome }) =>
        !hasPaths &&
        rule.kind === "deadlock" &&
        outcome === "broken" &&
        (drawing || hasSection(spec, "CONSTRAINT", "ACTION_CONSTRAINT")),
    )
    .map(() => deadlockNote(drawing));

const representativeNotes = (spec: Spec, chart: Chart | undefined) => {
  const merged = ["VIEW", "SYMMETRY"].filter((k) => hasSection(spec, k));
  return chart && merged.length
    ? [
        `With ${list(merged)}, TLC keeps one representative for each group of states that it counts as the same. An arrow can lead to the representative rather than to the state that the step reaches.`,
      ]
    : [];
};

export type OverviewInput = {
  spec: Spec;
  graph: Graph;
  hasPaths: boolean;
  rules: Verdict[];
  drawing: Drawing;
  states: ReportStates;
  chart: Chart | undefined;
};

export function overview({ spec, graph, hasPaths, rules, drawing, states, chart }: OverviewInput) {
  const c = countsOf(graph, chart);
  const drawingNote = drawing
    ? [
        `TLC stopped the drawing run with exit ${drawing.status}, so the chart draws only the states that it reached before it stopped.`,
      ]
    : [];
  const emptyNote =
    !hasPaths && !drawing && graph.states.size === c.past + c.excluded
      ? [emptyGraphNote(states)]
      : [];
  return [
    ...headline(spec, graph, chart, hasPaths, states, c),
    ...drawingNote,
    ...emptyNote,
    ...constraintNotes(chart, c),
    ...chartCountNotes(chart),
    ...deadlockNotes(spec, rules, hasPaths, drawing),
    ...(chart?.lie ? [`${chart.lie} So the chart draws parent states in place of regions.`] : []),
    ...(chart?.notes ?? []),
    ...representativeNotes(spec, chart),
  ];
}
