import {
  append,
  type Arrow,
  type Bug,
  byText,
  type Chart,
  type ChartState,
  type ChartStep,
  type Condition,
  hasRule,
  holds,
  type Labels,
  loopOf,
  must,
  type Rule,
  ruleKey,
  seqOf,
  tupleKey,
  unkey,
  type View,
  type Walk,
} from "../ir.ts";

type StateFlags = {
  lead: Uint8Array;
  looped: Uint8Array;
  clean: Uint8Array;
};

type BuiltStates = {
  /** Chart states in draw order, with the key each one is drawn under. */
  states: { key: string; state: ChartState }[];
  /** Chart state per kind number. */
  objectOf: ChartState[];
  /** Position in draw order per kind number. */
  position: Int32Array;
  /** Drawn key per kind number. */
  keyOf: string[];
};

const compareRules = (a: Rule, b: Rule) => byText(a.name, b.name) || byText(a.kind, b.kind);

const breaksOf = (members: number[], tla: Walk["states"]) => {
  const rules = new Map<string, Rule>();
  for (const i of members) for (const rule of tla[i].breaks) rules.set(ruleKey(rule), rule);
  return [...rules.values()].toSorted(compareRules).map((rule) => ({
    rule,
    always: members.every((i) => hasRule(tla[i].breaks, rule)),
  }));
};

const parentConflict = (path: string[], name: string) =>
  new Error(
    `The view's state() returned ${path.join(" / ")} both as a state and as a parent state${name ? ` in ${name}` : ""}. Give that state a child name of its own.`,
  );

/** Groups the model states of one region into chart states, checking parents and collecting breaks. */
function buildStates(
  name: string,
  r: number,
  { states: tla }: Walk,
  { shapes, group, keys, kinds, sizes }: Labels,
  order: Int32Array,
  flags: StateFlags,
): BuiltStates {
  const key = keys[r];
  const kind = kinds[r];
  const byKind = Map.groupBy(order, (i) => kind[i]);
  const base = [...byKind].map(([c, members]) => ({
    c,
    members,
    state: {
      path: shapes[members[0]][name],
      start: members.some((i) => tla[i].start),
      members,
      works: members.some((i) => flags.clean[i] === 1),
      lead: members.some((i) => flags.lead[i] === 1),
      repeats: members.some((i) => flags.looped[i] === 1),
      breaks: [] as ChartState["breaks"],
      group: undefined as unknown,
    },
  }));
  const parents = new Set<string>();
  for (const { state } of base)
    for (let i = 1; i < state.path.length; i++) parents.add(tupleKey(state.path.slice(0, i)));
  const built = base.map(({ c, members, state }) => {
    if (parents.size && parents.has(tupleKey(state.path))) throw parentConflict(state.path, name);
    const breaks = breaksOf(members, tla);
    const groups = new Set<unknown>(members.map((i) => group(i)));
    const done: ChartState = {
      ...state,
      breaks,
      group: groups.size === 1 ? [...groups][0] : undefined,
    };
    return { c, key: key[members[0]], state: done };
  });
  const objectOf = new Array<ChartState>(sizes[r]);
  const keyOf = new Array<string>(sizes[r]);
  const position = new Int32Array(sizes[r]);
  for (const [p, { c, key: k, state }] of built.entries()) {
    objectOf[c] = state;
    keyOf[c] = k;
    position[c] = p;
  }
  return {
    states: built.map(({ key: k, state }) => ({ key: k, state })),
    objectOf,
    position,
    keyOf,
  };
}

const ANY_REST: Condition = { kind: "and", otherKeys: [] };

type RegionMove = {
  f: number;
  t: number;
  text: string;
  group: number[];
  other: RegionMove | undefined;
};

type MoveEnv = {
  /** Number of regions. */
  R: number;
  kind: Int32Array;
  position: Int32Array;
  size: number;
  from: Int32Array;
  to: Int32Array;
  sorted: Int32Array;
  drawnLabels: string[];
  loop: (j: number) => boolean;
};

/** One move per (from state, to state, label) among the drawn steps of a region. */
function collectMoves({ R, kind, position, size, from, to, sorted, drawnLabels, loop }: MoveEnv) {
  const pairOf = (j: number) => position[kind[from[j]]] * size + position[kind[to[j]]];
  const drawn = Array.from(sorted).filter((j) => kind[from[j]] !== kind[to[j]] || loop(j));
  const groups = Map.groupBy(drawn, (j) => `${pairOf(j)}:${drawnLabels[j]}`);
  const lastOfPair = new Map<number, RegionMove>();
  return [...groups.values()].map((js) => {
    const j = js[0];
    const pair = pairOf(j);
    const move: RegionMove = {
      f: kind[from[j]],
      t: kind[to[j]],
      text: drawnLabels[j],
      group: R > 1 ? js : [],
      other: lastOfPair.get(pair),
    };
    lastOfPair.set(pair, move);
    return move;
  });
}

const phrases = (names: string[], others: number[]) => {
  const two = others.length === 1;
  const words = (vs: Iterable<string>) =>
    [...vs]
      .map((v) => unkey(v).join(" / "))
      .toSorted(byText)
      .join(two ? " or " : ", ");
  const is = (o: number, vs: Set<string>) =>
    two ? `when ${words(vs)}` : `${names[o]} is ${vs.size > 1 ? "one of " : ""}${words(vs)}`;
  const isNot = (o: number, vs: string[]) =>
    two
      ? `unless ${words(vs)}`
      : `${names[o]} is ${vs.length > 1 ? "none of" : "not"} ${words(vs)}`;
  return { two, is, isNot };
};

type Sets = { all: Set<string>[]; and: Set<string>[]; or: Set<string>[] };

const setsOf = (seen: string[][], count: number, takes: (t: string[]) => boolean): Sets => {
  const per = Array.from({ length: count }, (_, j) => {
    const all = new Set(seen.map((t) => t[j]));
    const untaken = new Set(seen.filter((t) => !takes(t)).map((t) => t[j]));
    return {
      all,
      and: new Set(seen.filter(takes).map((t) => t[j])),
      or: new Set([...all].filter((v) => !untaken.has(v))),
    };
  });
  return { all: per.map((p) => p.all), and: per.map((p) => p.and), or: per.map((p) => p.or) };
};

type ArrowEnv = {
  names: string[];
  others: number[];
  tuple: (i: number) => string[];
  tuplesAt: Map<number, number[]>;
  from: Int32Array;
};

/** Builds the arrow, and the condition under which it applies, for each move of a region. */
function arrowsOf(moves: RegionMove[], keyOf: string[], env: ArrowEnv): Arrow[] {
  const { names, others, tuple, tuplesAt, from } = env;
  const { two, is, isNot } = phrases(names, others);
  const seenAt = new Map<number, string[][]>();
  const seenOf = (f: number) => {
    const cached = seenAt.get(f);
    if (cached) return cached;
    const unique = new Map(must(tuplesAt, f).map((i) => [tupleKey(tuple(i)), tuple(i)] as const));
    const seen = [...unique.values()];
    seenAt.set(f, seen);
    return seen;
  };
  const andWhen = ({ all, and }: Sets) => {
    const parts = others.flatMap((o, j) => {
      const no = [...all[j]].filter((v) => !and[j].has(v));
      if (!no.length) return [];
      return [and[j].size <= no.length ? is(o, and[j]) : isNot(o, no)];
    });
    return parts.length ? (two ? parts[0] : `when ${parts.join(" and ")}`) : undefined;
  };
  const orWhen = ({ or }: Sets) =>
    `when ${others.flatMap((o, j) => (or[j].size ? [is(o, or[j])] : [])).join(" or ")}`;
  return moves.map((move): Arrow => {
    const base = { from: keyOf[move.f], to: keyOf[move.t], label: move.text };
    const ok = new Set(move.group.map((j) => tupleKey(tuple(from[j]))));
    const takes = (t: string[]) => ok.has(tupleKey(t));
    const seen = seenOf(move.f);
    const sets = setsOf(seen, others.length, takes);
    const fits = (condition: Condition) => seen.every((t) => holds(condition, t) === takes(t));
    const andHolds: Condition = { kind: "and", otherKeys: sets.and };
    const orHolds: Condition = { kind: "or", otherKeys: sets.or };
    if (fits(andHolds)) return { ...base, condition: andHolds, when: andWhen(sets) };
    if (fits(orHolds)) return { ...base, condition: orHolds, when: orWhen(sets) };
    return { ...base, condition: { kind: "tuples", otherTuples: ok } };
  });
}

/** With a single region every move applies whatever the (absent) other regions are. */
const soloArrows = (moves: RegionMove[], keyOf: string[]): Arrow[] =>
  moves.map((move) => ({
    from: keyOf[move.f],
    to: keyOf[move.t],
    label: move.text,
    condition: ANY_REST,
    when: undefined,
  }));

export function drawRegions(
  walk: Walk,
  labels: Labels,
  order: Int32Array,
  found: Bug[],
  view: View,
): Chart {
  const { states: tla, index, from, to } = walk;
  const { names, shapes, drawnLabels, kinds, sorted, pathSteps, notes } = labels;
  const R = names.length;
  const lead = new Uint8Array(shapes.length);
  const looped = new Uint8Array(shapes.length);
  for (const b of found) {
    for (const i of seqOf(b, index).slice(0, b.loop)) lead[i] = 1;
    for (const i of loopOf(b, index)) looped[i] = 1;
  }
  const loop = (j: number) => R === 1 && pathSteps[j] === 1;
  const stays = (j: number) => kinds.every((kind) => kind[from[j]] === kind[to[j]]);
  let inside = 0;
  for (const j of sorted) if (stays(j) && !loop(j)) inside++;
  const dirty = dirtyStates(tla, order, kinds);
  const comboOf = comboFn(kinds);
  const clean = new Uint8Array(shapes.length);
  for (let i = 0; i < shapes.length; i++) clean[i] = !dirty.size || !dirty.has(comboOf(i)) ? 1 : 0;
  const flags = { lead, looped, clean };
  const built = names.map((name, r) => regionOf(name, r, walk, labels, order, flags, loop));
  const hidden = hiddenStates(dirty, built, kinds);
  const regions = built.map(({ name, states, steps, arrows }) => ({
    name,
    states: states.map((s) => (hidden.has(s) ? { ...s, works: false } : s)),
    steps,
    arrows,
  }));
  return {
    title: view.title,
    regions,
    notes,
    inside,
    quiet: drawnLabels.length - sorted.length,
    colors: view.colors ?? {},
    paths: found.filter((b) => b.loop !== 0).map((b) => b.rule.name),
    loops: found.filter((b) => b.loop !== undefined).map((b) => b.rule.name),
  };
}

const comboFn = (kinds: Int32Array[]) =>
  kinds.length === 1
    ? (i: number): number | string => kinds[0][i]
    : (i: number): number | string => kinds.map((k) => k[i]).join(",");

const dirtyStates = (tla: Walk["states"], order: Int32Array, kinds: Int32Array[]) => {
  const comboOf = comboFn(kinds);
  const dirty = new Map<number | string, number>();
  for (const i of order)
    if (tla[i].breaks.length) {
      const c = comboOf(i);
      if (!dirty.has(c)) dirty.set(c, i);
    }
  return dirty;
};

type BuiltRegion = {
  name: string;
  states: ChartState[];
  steps: ChartStep[];
  arrows: Arrow[];
  objectOf: ChartState[];
};

/** Chart states that work in every region but sit in a combination that breaks a rule. */
const hiddenStates = (
  dirty: Map<number | string, number>,
  built: BuiltRegion[],
  kinds: Int32Array[],
) =>
  new Set(
    [...dirty.values()].flatMap((i) => {
      const ps = built.map((b, r) => b.objectOf[kinds[r][i]]);
      return ps.every((s) => s.works) ? ps : [];
    }),
  );

const regionOf = (
  name: string,
  r: number,
  walk: Walk,
  labels: Labels,
  order: Int32Array,
  flags: StateFlags,
  loop: (j: number) => boolean,
): BuiltRegion => {
  const { from, to } = walk;
  const { names, keys, kinds, sizes, sorted, drawnLabels } = labels;
  const R = names.length;
  const kind = kinds[r];
  const { states, objectOf, position, keyOf } = buildStates(name, r, walk, labels, order, flags);
  const moves = collectMoves({
    R,
    kind,
    position,
    size: sizes[r],
    from,
    to,
    sorted,
    drawnLabels,
    loop,
  });
  const others = names.flatMap((_, o) => (o === r ? [] : [o]));
  const env = {
    names,
    others,
    tuple: (i: number) => others.map((o) => keys[o][i]),
    tuplesAt: Map.groupBy(order, (i) => kind[i]),
    from,
  };
  const arrows = R === 1 ? soloArrows(moves, keyOf) : arrowsOf(moves, keyOf, env);
  const steps = arrows.map((a, k): ChartStep => ({
    from: objectOf[moves[k].f].path,
    to: objectOf[moves[k].t].path,
    label: a.label,
    when: a.label.endsWith("]") ? undefined : a.when,
  }));
  return { name, states: states.map((s) => s.state), steps, arrows, objectOf };
};
