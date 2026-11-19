import {
  type Bug,
  type Graph,
  hasRule,
  type Lasso,
  must,
  type PathStep,
  type Rule,
  stateKey,
  type Step,
  type Trace,
  type TraceState,
  type Vars,
} from "../ir.ts";

export function pathGraph(names: string[]) {
  const taken = new Map<string, Step>();
  const graph: Graph = {
    states: new Map(),
    get steps() {
      return [...taken.values()];
    },
  };
  const ids = new Map<string, string>();
  const idOf = (vars: Vars | undefined, start: boolean) => {
    if (!vars) throw new Error("TLC's trace has a state with no values.");
    const k = stateKey(names.map((name) => vars[name]));
    let id = ids.get(k);
    if (id === undefined) {
      ids.set(k, (id = String(ids.size)));
      graph.states.set(id, { vars, start, breaks: [] });
    } else if (start) graph.states.set(id, { ...must(graph.states, id), start: true });
    return id;
  };
  const route = (seq: { action: string; vars: Vars | undefined }[]) => {
    const start = idOf(seq[0].vars, true);
    const path = seq.slice(1).reduce<{ from: string; path: PathStep[] }>(
      (acc, { action, vars }) => {
        const to = idOf(vars, false);
        const k = `${acc.from} ${to} ${action}`;
        const step = taken.get(k) ?? { from: acc.from, to, action };
        taken.set(k, step);
        return { from: to, path: [...acc.path, { action, state: to, step }] };
      },
      { from: start, path: [] },
    ).path;
    return { start, path };
  };
  return {
    graph,
    bug: (rule: Rule, trace: TraceState[]): Bug => {
      if (!trace.length) throw new Error(`TLC's trace for ${rule.name} has no states.`);
      const bug = { rule, ...route(trace) };
      const endId = bug.path.at(-1)?.state ?? bug.start;
      const end = must(graph.states, endId);
      if (!hasRule(end.breaks, rule))
        graph.states.set(endId, { ...end, breaks: [...end.breaks, rule] });
      return bug;
    },
    lasso: ({ seq, loop }: Trace): Lasso | undefined =>
      seq.length ? { ...route(seq), loop, stutters: loop === seq.length - 1 } : undefined,
  };
}
