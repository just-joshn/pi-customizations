import {
  findLoop,
  findTrace,
  type Graph,
  hasRule,
  type Lasso,
  type Mark,
  must,
  type Past,
  pastState,
  type PathStep,
  type Rule,
  type State,
  stateKey,
  type Step,
  type Trace,
  type TraceState,
  type Value,
  valuesOf,
} from "../ir.ts";

/** The id of the drawn state that holds each combination of values, by `stateKey`. */
export type Index = ReadonlyMap<string, string>;

export type Annotated = { graph: Graph; index: Index };

export const finder = (graph: Graph, names: string[]): Index =>
  new Map(
    [...graph.states].flatMap(([id, s]) =>
      s.excluded ? [] : [[stateKey(valuesOf(s.vars, names)), id] as const],
    ),
  );

const lookup = (index: Index) => (values: Value[]) => index.get(stateKey(values));

type Placement = { id: string; rule: Rule } | { key: string; rule: Rule };

function* placements(
  graph: Graph,
  marks: Iterable<Mark>,
  byName: ReadonlyMap<string, Rule>,
  index: Index,
): Generator<Placement> {
  const find = lookup(index);
  for (const { values, broken } of marks)
    for (const name of broken) {
      const rule = must(byName, name);
      const id = find(values);
      yield id !== undefined && graph.states.has(id)
        ? { id, rule }
        : { key: stateKey(values), rule };
    }
}

/** Puts the rules that TLC marked on their states, and returns the rules marked on states it never drew. */
export function mark(
  graph: Graph,
  marks: Iterable<Mark>,
  names: string[],
  rules: Rule[],
  index = finder(graph, names),
): { graph: Graph; past: Past } {
  const byName = new Map(rules.map((rule) => [rule.name, rule]));
  const placed = [...placements(graph, marks, byName, index)];
  const onState = Map.groupBy(
    placed.filter((p) => "id" in p),
    (p) => p.id,
  );
  const states = new Map(
    [...graph.states].map(([id, s]) => {
      const here = onState.get(id);
      return [id, here ? { ...s, breaks: [...s.breaks, ...here.map((p) => p.rule)] } : s] as const;
    }),
  );
  const offState = Map.groupBy(
    placed.filter((p) => "key" in p),
    (p) => p.key,
  );
  const past: Past = new Map(
    [...offState].map(([key, group]) => [key, new Set(group.map((p) => p.rule))]),
  );
  return { graph: { ...graph, states }, past };
}

export function deadEnds(graph: Graph, rule: Rule): Graph {
  const from = new Set(graph.steps.map((t) => t.from));
  const states = new Map(
    [...graph.states].map(([id, s]) => [
      id,
      !s.past && !from.has(id) ? { ...s, breaks: [...s.breaks, rule] } : s,
    ]),
  );
  return { ...graph, states };
}

export function addPast(
  graph: Graph,
  counterexample: TraceState[],
  names: string[],
  rule: Rule,
  past: Past,
  excludes: boolean,
  index = finder(graph, names),
): Annotated {
  const trace = findTrace(counterexample, names, rule, lookup(index));
  const end = trace.length - 1;
  const from = trace[end - 1]?.id;
  const action = trace[end].action;
  const taken = (to: string | undefined) =>
    graph.steps.some((t) => t.from === from && t.to === to && t.action === action);
  const reachedId = trace[end].id;
  const reached = reachedId === undefined ? undefined : graph.states.get(reachedId);
  const excluded = excludes && reached !== undefined && end > 0 && !reached.past && !taken(reachedId);
  const to = excluded
    ? `past ${reachedId} ${action} ${from}`
    : (reachedId ?? `past ${graph.states.size}`);
  const known = graph.states.get(to);
  const marked = excluded ? reached.breaks : (past.get(stateKey(trace[end].values)) ?? []);
  const last = known ?? pastState(trace[end].vars, end === 0, marked, excluded);
  const breaks = hasRule(last.breaks, rule) ? last.breaks : [...last.breaks, rule];
  const states = new Map<string, State>([
    ...graph.states,
    [to, { ...last, breaks, ends: [...(last.ends ?? []), rule] }],
  ]);
  const found: Index =
    known || excluded ? index : new Map([...index, [stateKey(trace[end].values), to]]);
  const steps =
    from === undefined || !last.past || taken(to)
      ? graph.steps
      : [...graph.steps, { from, to, action }];
  return { graph: { ...graph, states, steps }, index: found };
}

export function lasso(
  graph: Graph,
  trace: Trace,
  names: string[],
  index = finder(graph, names),
): Lasso | undefined {
  const { seq, loop } = findLoop(trace, names, lookup(index));
  const start = seq[0]?.id;
  if (start === undefined) return undefined;
  const ids = new Set(seq.map((s) => s.id));
  const out = Map.groupBy(
    graph.steps.filter((t) => ids.has(t.from)),
    (t) => t.from as string | undefined,
  );
  const steps = seq
    .slice(1)
    .map((s, i) => (out.get(seq[i].id) ?? []).find((t) => t.to === s.id && t.action === s.action));
  if (steps.some((step) => !step)) return undefined;
  const route: PathStep[] = (steps as Step[]).map((step) => ({
    action: step.action,
    state: step.to,
    step,
  }));
  const stutters = loop === seq.length - 1;
  return {
    start,
    path: route,
    loop,
    stutters,
  };
}
