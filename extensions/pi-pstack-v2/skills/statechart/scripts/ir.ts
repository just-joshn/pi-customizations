export type Value =
  | boolean
  | number
  | string
  | { kind: "model"; name: string }
  | { kind: "set"; members: Value[] }
  | { kind: "interval"; lo: number; hi: number }
  | { kind: "function"; printedAs: "tuple" | "record" | "pairs"; keys: Value[]; values: Value[] };

export type Vars = { [name: string]: Value };

export type Rule = { kind: "invariant" | "deadlock" | "property"; name: string };

type StateBase = { vars: Vars; start: boolean; breaks: Rule[] };

export type PastState = StateBase & { ends: Rule[]; past: true; excluded: boolean };

export type State =
  (StateBase & { ends?: Rule[]; past?: undefined; excluded?: undefined }) | PastState;

export type Step = { from: string; to: string; action: string };

export type Graph = { states: Map<string, State>; steps: Step[] };

export type PathStep = { action: string; state: string; step: Step };

export type Output = Iterable<Uint8Array>;

export type Lasso = {
  start: string;
  path: PathStep[];
  loop: number | undefined;
  stutters: boolean;
};

export type Mark = { values: Value[]; broken: string[] };

export type Past = Map<string, Set<Rule>>;

export type TraceState = { action: string; vars: Vars };

export type Trace = {
  seq: { action: string; vars: Vars | undefined }[];
  loop: number | undefined;
};

export type Find<Id> = (values: Value[]) => Id | undefined;

export type Bug = {
  rule: Rule;
  start: string;
  path: PathStep[];
  loop?: number;
  stutters?: boolean;
};

export type ConfigSection = { key: string; line: number; tokens: string[] };

export type Config = {
  sections: ConfigSection[];
  invariants: string[];
  properties: string[];
  constraints: string[];
  actionConstraints: string[];
  checkDeadlock?: boolean;
  init?: string;
  next?: string;
  spec?: string;
  view?: string;
  symmetry?: string;
  type?: string;
  typeConstraint?: string;
};

export type Spec = {
  module: string;
  variables: string[];
  invariants: string[];
  properties: string[];
  deadlock: boolean;
  written: ConfigSection[];
};

export type Message = { code: number; level: number; body: Part[]; beforeMarker?: string };

export type Line = string;

export type Part = Line | Message;

export const EC = {
  TLC_INVARIANT_VIOLATED_INITIAL: 2107,
  TLC_PROPERTY_VIOLATED_INITIAL: 2108,
  TLC_INVARIANT_VIOLATED_BEHAVIOR: 2110,
  TLC_ACTION_PROPERTY_VIOLATED_BEHAVIOR: 2112,
  TLC_DEADLOCK_REACHED: 2114,
  TLC_TEMPORAL_PROPERTY_VIOLATED: 2116,
  TLC_BACK_TO_STATE: 2122,
  TLC_FINISHED: 2186,
  TLC_INIT_GENERATED1: 2190,
  TLC_INIT_GENERATED2: 2191,
  TLC_STATS: 2199,
  TLC_PROGRESS_STATS: 2200,
  TLC_STATE_PRINT2: 2217,
  TLC_STATE_PRINT3: 2218,
  TLC_SANY_END: 2219,
  TLC_SANY_START: 2220,
} as const;

export const LEVEL = { NONE: 0, ERROR: 1, TLCBUG: 2, WARNING: 3, STATE: 4 } as const;

export type Outcome = "broken" | "holds" | "not checked";

export type Verdict = {
  rule: Rule;
  outcome: Outcome;
  messages: Iterable<Part> | undefined;
};

export type Property = Verdict & { bug: Lasso | undefined; initialOnly: boolean };

export type Stop = { status: number | null; message: string };

export type CheckResult = {
  spec: Spec & { folder: string };
  graph: Graph;
  paths: Bug[] | undefined;
  rules: Verdict[];
  properties: Property[];
  exit: 0 | 1 | 2;
  stop: Stop | undefined;
  drawing: { status: number | null } | undefined;
  states: { distinct: number; initial: number; complete: boolean; cut: boolean };
  messages: Iterable<Part>;
};

export const RERUN_STATES = 100_000;

export const CHART_STATES = 500;

export type View = {
  state?: (vars: Vars) => unknown;
  step?: (action: string, from: Vars, to: Vars) => unknown;
  group?: (vars: Vars) => unknown;
  colors?: { [group: string]: string };
  title?: string;
};

export const checked = Symbol("checked");

export type CheckedView = View & { readonly [checked]: true };

export type Shape = { [region: string]: string[] };

export type Walk = {
  ids: string[];
  states: State[];
  index: Map<string, number>;
  nameOf: string[];
  nameRank: Int32Array;
  from: Int32Array;
  to: Int32Array;
  action: Int32Array;
  depth: Int32Array;
  via: Int32Array;
  reached: Int32Array;
  starts: number[];
};

export type Hidden = null;

export type Answers = {
  names: string[];
  shapes: Shape[];
  labels: (string | Hidden)[];
  group: (i: number) => unknown;
};

export type Labels = Answers & {
  drawnLabels: string[];
  keys: string[][];
  kinds: Int32Array[];
  sizes: number[];
  sorted: Int32Array;
  pathStepIndex: Map<Step, number>;
  pathSteps: Uint8Array;
  together: Set<string>;
  notes: string[];
};

export type Story = { step?: string; state: Shape }[];

export type ChartState = {
  path: string[];
  start: boolean;
  members: number[];
  works: boolean;
  lead: boolean;
  repeats: boolean;
  breaks: { rule: Rule; always: boolean }[];
  group: unknown;
};

export type Condition =
  { kind: "and" | "or"; otherKeys: Set<string>[] } | { kind: "tuples"; otherTuples: Set<string> };

export type Arrow = {
  from: string;
  to: string;
  label: string;
  condition: Condition;
  when?: string;
};

export type ChartStep = {
  from: string[];
  to: string[];
  label: string;
  when: string | undefined;
};

export type Region = {
  name: string;
  states: ChartState[];
  steps: ChartStep[];
  arrows: Arrow[];
};

export type Chart = {
  title: string | undefined;
  regions: Region[];
  notes: string[];
  inside: number;
  quiet: number;
  colors: { [group: string]: string };
  paths: string[];
  loops: string[];
  lie?: string;
};

export const isRecord = (v: unknown): v is { [key: string]: unknown } =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string");

export const PART = 1 << 24;

export const list = (items: string[], and = "and") =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ${and} ${items.at(-1)}`;

export const must = <K, V>(map: ReadonlyMap<K, V>, key: K): V => {
  const value = map.get(key);
  if (value === undefined) throw new Error(`The chart lost track of ${JSON.stringify(key)}.`);
  return value;
};

export const seqOf = (bug: Bug, index: ReadonlyMap<string, number>) => [
  must(index, bug.start),
  ...bug.path.map((p) => must(index, p.state)),
];

export const loopOf = (bug: Bug, index: ReadonlyMap<string, number>) =>
  new Set(bug.loop === undefined ? [] : seqOf(bug, index).slice(bug.loop));

export const defaultState = (vars: Vars) => {
  const entries = Object.entries(vars);
  if (entries.length === 1) return show(entries[0][1]);
  return entries.map(([k, v]) => `${k}=${show(v)}`).join(" ");
};

export const stateText = (vars: Vars) =>
  Object.entries(vars)
    .map(([k, v]) => `${k} = ${show(v)}`)
    .join(" /\\ ");

export const count = (n: number) => Int32Array.from({ length: n }, (_, i) => i);

const byNumber = ([a]: [number, unknown], [b]: [number, unknown]) => a - b;

/** A stable sort of `items` by each of `keys` in turn, the first key most significant. */
export const sortBy = (items: Int32Array, keys: Int32Array[]) =>
  keys.toReversed().reduce(
    (current, key) =>
      Int32Array.from(
        [...Map.groupBy(current, (item) => key[item])].toSorted(byNumber).flatMap(([, group]) => group),
      ),
    items,
  );

export function holds(condition: Condition, others: string[]) {
  switch (condition.kind) {
    case "and":
      for (let j = 0; j < others.length; j++)
        if (!condition.otherKeys[j].has(others[j])) return false;
      return true;
    case "or":
      for (let j = 0; j < others.length; j++)
        if (condition.otherKeys[j].has(others[j])) return true;
      return false;
    case "tuples":
      return condition.otherTuples.has(tupleKey(others));
  }
}

export const ruleKey = (rule: Rule) => tupleKey([rule.kind, rule.name]);

export const hasRule = (rules: Rule[], rule: Rule) =>
  rules.some((r) => r.kind === rule.kind && r.name === rule.name);

export const valuesOf = (vars: Vars, names: string[]) => names.map((n) => vars[n]);

export const findTrace = <Id>(
  counterexample: TraceState[],
  names: string[],
  rule: Rule,
  find: Find<Id>,
) => {
  const trace = counterexample.map(({ action, vars }) => {
    const values = valuesOf(vars, names);
    return { action, vars, values, id: find(values) };
  });
  const end = trace.length - 1;
  if (end < 0) throw new Error(`TLC's trace for ${rule.name} has no states.`);
  if (trace.slice(0, end).some((t) => t.id === undefined))
    throw new Error(
      `TLC's trace for ${rule.name} has a state before its last that the dump does not list.`,
    );
  return trace;
};

export const findLoop = <Id>({ seq, loop }: Trace, names: string[], find: Find<Id>) => ({
  seq: seq.map(({ action, vars }) => ({ action, id: vars && find(valuesOf(vars, names)) })),
  loop,
});

export const pastState = (
  vars: Vars,
  start: boolean,
  marked: Iterable<Rule>,
  excluded: boolean,
): PastState => {
  const breaks = [...marked].reduce<Rule[]>(
    (kept, r) => (hasRule(kept, r) ? kept : [...kept, r]),
    [],
  );
  return { vars, start, breaks, ends: [], past: true, excluded };
};

export const CHECK_DEADLOCK = "CHECK_DEADLOCK";

const deadlockRule = ({ invariants, properties }: Spec): Rule => ({
  kind: "deadlock",
  name:
    invariants.includes("NoDeadlock") || properties.includes("NoDeadlock")
      ? CHECK_DEADLOCK
      : "NoDeadlock",
});

export const hasSection = ({ written }: Spec, ...keys: string[]) =>
  written.some((s) => keys.includes(s.key));

export const stateRules = (spec: Spec): Rule[] => [
  ...spec.invariants.map((name) => ({ kind: "invariant" as const, name })),
  ...(spec.deadlock ? [deadlockRule(spec)] : []),
];

export const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const ESCAPES: { [c: string]: string } = {
  '"': '\\"',
  "\\": "\\\\",
  "\n": "\\n",
  "\t": "\\t",
  "\r": "\\r",
  "\f": "\\f",
};
const quote = (s: string) => `"${s.replace(/["\\\n\t\r\f]/g, (c) => ESCAPES[c])}"`;

const joined = (items: Value[], sep: string) => items.map((item) => show(item)).join(sep);

const showFunction = (v: Extract<Value, { kind: "function" }>) => {
  if (v.printedAs === "tuple") return `<<${joined(v.values, ", ")}>>`;
  if (v.printedAs === "record") {
    const fields = v.keys.map((k, i) => `${String(k)} |-> ${show(v.values[i])}`);
    return `[${fields.join(", ")}]`;
  }
  const pairs = v.keys.map((k, i) => `${show(k)} :> ${show(v.values[i])}`);
  return `(${pairs.join(" @@ ")})`;
};

export const show = (v: Value): string => {
  switch (typeof v) {
    case "boolean":
      return v ? "TRUE" : "FALSE";
    case "number":
      return String(v);
    case "string":
      return quote(v);
  }
  switch (v.kind) {
    case "model":
      return v.name;
    case "interval":
      return `${v.lo}..${v.hi}`;
    case "set":
      return `{${joined(v.members, ", ")}}`;
    case "function":
      return showFunction(v);
  }
};

const JSON_STRINGS = /^\[(?:"(?:[^"\\]|\\.)*"(?:,"(?:[^"\\]|\\.)*")*)?\]$/;
const JSON_STRING = /"((?:[^"\\]|\\.)*)"/g;
const UNESCAPES: { [c: string]: string } = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
const unescape = (text: string) =>
  text.replace(/\\(?:u([0-9a-fA-F]{4})|(.))/g, (_, hex, c) =>
    hex ? String.fromCharCode(Number.parseInt(hex, 16)) : (UNESCAPES[c] ?? c),
  );

export const tupleKey = (parts: unknown[]) => JSON.stringify(parts);
export const unkey = (k: string) => {
  if (!JSON_STRINGS.test(k)) throw new Error(`The chart cannot read the key ${k}.`);
  return Array.from(k.matchAll(JSON_STRING), (m) => unescape(m[1]));
};

const ascending = (keys: string[]) => keys.every((k, i) => !i || keys[i - 1] <= k);

const span = (lo: number, hi: number) => (hi > lo ? `${lo}..${hi}` : String(lo));

const intRanges = (ints: number[]) => {
  const starts = ints.flatMap((v, i) => (!i || v - ints[i - 1] > 1 ? [i] : []));
  const ends = ints.flatMap((v, i) => (i === ints.length - 1 || ints[i + 1] - v > 1 ? [i] : []));
  return starts.map((start, r) => span(ints[start], ints[ends[r]]));
};

const setKey = (members: Value[]) => {
  const ints = members.filter((m): m is number => typeof m === "number");
  const others = members.filter((m) => typeof m !== "number").map((m) => key(m));
  const strictlyAscending = ints.every((n, i) => !i || ints[i - 1] < n);
  const sortedInts = strictlyAscending ? ints : ints.toSorted((a, b) => a - b);
  const sortedOthers = ascending(others) ? others : others.toSorted(byText);
  const distinct = sortedOthers.filter((o, i) => !i || o !== sortedOthers[i - 1]);
  return `{${[...intRanges(sortedInts), ...distinct].join(",")}}`;
};

const functionKey = ({ keys, values }: { keys: Value[]; values: Value[] }) => {
  const keyTexts = keys.map((k) => key(k));
  const rank = (i: number) => (typeof keys[i] === "number" ? (keys[i] as number) : Infinity);
  const order = keys
    .map((_, i) => i)
    .toSorted((a, b) => rank(a) - rank(b) || byText(keyTexts[a], keyTexts[b]) || a - b);
  const tuple =
    keys.every((k) => typeof k === "number") && order.every((k, i) => keys[k] === i + 1);
  const kept = order.filter((k, i) => !i || keyTexts[k] !== keyTexts[order[i - 1]]);
  const items = kept.map((k) => {
    const v = key(values[k]);
    return tuple ? v : `${keyTexts[k]}:>${v}`;
  });
  return tuple ? `<<${items.join(",")}>>` : `(${items.join("@@")})`;
};

const compositeKey = (v: Exclude<Value, boolean | number | string | { kind: "model" }>) => {
  if (v.kind === "interval") return `{${v.lo > v.hi ? "" : span(v.lo, v.hi)}}`;
  return v.kind === "set" ? setKey(v.members) : functionKey(v);
};

export const key = (v: Value): string => {
  switch (typeof v) {
    case "boolean":
      return v ? "TRUE" : "FALSE";
    case "number":
      return String(v);
    case "string":
      return JSON.stringify(v);
  }
  if (v.kind === "model") return v.name;
  return compositeKey(v);
};

export const stateKey = (values: Value[]) => values.map((v) => key(v)).join(",");
