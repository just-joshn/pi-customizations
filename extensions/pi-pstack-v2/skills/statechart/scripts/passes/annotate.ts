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
  stateKey,
  type Step,
  type Trace,
  type TraceState,
  type Value,
  valuesOf,
} from "../ir.ts";

export const finder = (graph: Graph, names: string[]) => {
  let ids: Map<string, string> | undefined;
  const find = (values: Value[]) => {
    if (!ids) {
      ids = new Map();
      for (const [id, s] of graph.states)
        if (!s.excluded) ids.set(stateKey(valuesOf(s.vars, names)), id);
    }
    return ids.get(stateKey(values));
  };
  const add = (id: string, values: Value[]) => ids?.set(stateKey(values), id);
  return Object.assign(find, { add });
};

export function mark(
  graph: Graph,
  marks: Iterable<Mark>,
  names: string[],
  rules: Rule[],
  find = finder(graph, names),
) {
  const byName = new Map<string, Rule>();
  for (const rule of rules) byName.set(rule.name, rule);
  const past: Past = new Map();
  for (const { values, broken } of marks) {
    const id = find(values);
    for (const name of broken) {
      const rule = must(byName, name);
      const state = id === undefined ? undefined : graph.states.get(id);
      if (id !== undefined && state)
        graph.states.set(id, { ...state, breaks: [...state.breaks, rule] });
      else past.set(stateKey(values), (past.get(stateKey(values)) ?? new Set()).add(rule));
    }
  }
  return past;
}

export function deadEnds(graph: Graph, rule: Rule) {
  const from = new Set<string>();
  for (const t of graph.steps) from.add(t.from);
  for (const [id, s] of graph.states)
    if (!s.past && !from.has(id)) graph.states.set(id, { ...s, breaks: [...s.breaks, rule] });
}

export function addPast(
  graph: Graph,
  counterexample: TraceState[],
  names: string[],
  rule: Rule,
  past: Past,
  excludes: boolean,
  find = finder(graph, names),
): Graph {
  const trace = findTrace(counterexample, names, rule, find);
  const end = trace.length - 1;
  const from = trace[end - 1]?.id;
  const action = trace[end].action;
  const taken = (to: string | undefined) => {
    for (const t of graph.steps)
      if (t.from === from && t.to === to && t.action === action) return true;
    return false;
  };
  let to = trace[end].id;
  const reached = to === undefined ? undefined : graph.states.get(to);
  const excluded = excludes && reached !== undefined && end > 0 && !reached.past && !taken(to);
  if (excluded) to = `past ${to} ${action} ${from}`;
  to ??= `past ${graph.states.size}`;
  let last = graph.states.get(to);
  if (!last) {
    const marked = excluded ? reached.breaks : (past.get(stateKey(trace[end].values)) ?? []);
    last = pastState(trace[end].vars, end === 0, marked, excluded);
    graph.states.set(to, last);
    if (!excluded) find.add(to, trace[end].values);
  }
  const breaks = hasRule(last.breaks, rule) ? last.breaks : [...last.breaks, rule];
  graph.states.set(to, { ...last, breaks, ends: [...(last.ends ?? []), rule] });
  if (from === undefined || !last.past || taken(to)) return graph;
  return { ...graph, steps: [...graph.steps, { from, to, action }] };
}

export function lasso(
  graph: Graph,
  trace: Trace,
  names: string[],
  find = finder(graph, names),
): Lasso | undefined {
  const { seq, loop } = findLoop(trace, names, find);
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
