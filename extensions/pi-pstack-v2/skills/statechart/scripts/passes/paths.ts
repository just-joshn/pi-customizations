import {
  type Bug,
  type Graph,
  hasRule,
  type Lasso,
  must,
  type PathStep,
  type Rule,
  stateKey,
  type State,
  type Step,
  type Trace,
  type TraceState,
  type Vars,
} from "../ir.ts";

/** The states and steps that the bug paths and loops walk, built up one trace at a time. */
export type PathGraph = {
  names: string[];
  states: ReadonlyMap<string, State>;
  taken: ReadonlyMap<string, Step>;
  ids: ReadonlyMap<string, string>;
};

export const pathGraph = (names: string[]): PathGraph => ({
  names,
  states: new Map(),
  taken: new Map(),
  ids: new Map(),
});

export const graphOf = ({ states, taken }: PathGraph): Graph => ({
  states: new Map(states),
  steps: [...taken.values()],
});

const stepKey = ({ from, to, action }: Step) => `${from} ${to} ${action}`;

type Seq = { action: string; vars: Vars | undefined }[];

const keyOf = (names: string[], vars: Vars | undefined) => {
  if (!vars) throw new Error("TLC's trace has a state with no values.");
  return stateKey(names.map((name) => vars[name]));
};

const withStates = (paths: PathGraph, seq: Seq, keys: string[]) => {
  const fresh = [...new Set(keys.filter((k) => !paths.ids.has(k)))];
  const ids = new Map([...paths.ids, ...fresh.map((k, n) => [k, String(paths.ids.size + n)] as const)]);
  const firstAt = new Map(keys.map((k, i) => [k, i] as const).toReversed());
  const added = fresh.map((k): [string, State] => {
    const at = must(firstAt, k);
    return [must(ids, k), { vars: seq[at].vars as Vars, start: at === 0, breaks: [] }];
  });
  const startId = must(ids, keys[0]);
  const restarted: [string, State][] = paths.ids.has(keys[0])
    ? [[startId, { ...must(paths.states, startId), start: true }]]
    : [];
  return { ids, startId, states: new Map<string, State>([...paths.states, ...restarted, ...added]) };
};

const route = (paths: PathGraph, seq: Seq) => {
  const keys = seq.map(({ vars }) => keyOf(paths.names, vars));
  const { ids, startId, states } = withStates(paths, seq, keys);
  const ofSeq = keys.map((k) => must(ids, k));
  const pairs = seq.slice(1).map(({ action }, k): Step => ({ from: ofSeq[k], to: ofSeq[k + 1], action }));
  const created = Map.groupBy(
    pairs.filter((p) => !paths.taken.has(stepKey(p))),
    stepKey,
  );
  const taken = new Map<string, Step>([
    ...paths.taken,
    ...[...created].map(([k, group]): [string, Step] => [k, group[0]]),
  ]);
  const path = pairs.map(({ action, to }, k): PathStep => ({
    action,
    state: to,
    step: must(taken, stepKey(pairs[k])),
  }));
  return { paths: { ...paths, ids, states, taken }, start: startId, path };
};

export const withBug = (paths: PathGraph, rule: Rule, trace: TraceState[]): [PathGraph, Bug] => {
  if (!trace.length) throw new Error(`TLC's trace for ${rule.name} has no states.`);
  const { paths: routed, start, path } = route(paths, trace);
  const endId = path.at(-1)?.state ?? start;
  const end = must(routed.states, endId);
  const states = hasRule(end.breaks, rule)
    ? routed.states
    : new Map<string, State>([...routed.states, [endId, { ...end, breaks: [...end.breaks, rule] }]]);
  return [{ ...routed, states }, { rule, start, path }];
};

export const withLasso = (paths: PathGraph, { seq, loop }: Trace): [PathGraph, Lasso | undefined] => {
  if (!seq.length) return [paths, undefined];
  const { paths: routed, start, path } = route(paths, seq);
  return [routed, { start, path, loop, stutters: loop === seq.length - 1 }];
};
