import {
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
  /** The view's group for each model state, as asked while the states were built. */
  groupOf: Map<number, unknown>;
};

const compareRules = (a: Rule, b: Rule) => byText(a.name, b.name) || byText(a.kind, b.kind);

const breaksOf = (members: number[], tla: Walk["states"]) => {
  const rules = new Map(
    members.flatMap((i) => tla[i].breaks.map((rule) => [ruleKey(rule), rule] as const)),
  );
  return [...rules.values()].toSorted(compareRules).map((rule) => ({
    rule,
    always: members.every((i) => hasRule(tla[i].breaks, rule)),
  }));
};

const parentConflict = (path: string[], name: string) =>
  new Error(
    `The view's state() returned ${path.join(" / ")} both as a state and as a parent state${name ? ` in ${name}` : ""}. Give that state a child name of its own.`,
  );

/**
 * Groups the model states of one region into chart states, checking parents and collecting breaks.
 * It asks `group` for one chart state's members right after checking that state's parents, so the
 * view's group() runs lazily, in draw order, after the parent checks of the states before it.
 */
function buildStates(
  name: string,
  r: number,
  { states: tla }: Walk,
  { shapes, keys, kinds, sizes }: Labels,
  group: (i: number) => unknown,
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
  const parents = new Set(
    base.flatMap(({ state }) =>
      Array.from({ length: Math.max(state.path.length - 1, 0) }, (_, k) =>
        tupleKey(state.path.slice(0, k + 1)),
      ),
    ),
  );
  const built = base.map(({ c, members, state }) => {
    if (parents.size && parents.has(tupleKey(state.path))) throw parentConflict(state.path, name);
    const breaks = breaksOf(members, tla);
    const asked = members.map((i): [number, unknown] => [i, group(i)]);
    const values = new Set(asked.map(([, value]) => value));
    const done: ChartState = {
      ...state,
      breaks,
      group: values.size === 1 ? [...values][0] : undefined,
    };
    return { c, key: key[members[0]], state: done, asked };
  });
  const placed = new Map(built.map((b, p) => [b.c, { ...b, p }]));
  const at = (c: number) => must(placed, c);
  const kindNumbers = Array.from({ length: sizes[r] }, (_, c) => c);
  return {
    states: built.map(({ key: k, state }) => ({ key: k, state })),
    objectOf: kindNumbers.map((c) => at(c).state),
    position: Int32Array.from(kindNumbers, (c) => at(c).p),
    keyOf: kindNumbers.map((c) => at(c).key),
    groupOf: new Map(built.flatMap(({ asked }) => asked)),
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

type MoveInfo = { pair: number; js: number[] };

/** Makes the moves of one pair of states in order, each pointing at the one before. */
function* chainOf(infos: MoveInfo[], env: MoveEnv): Generator<RegionMove> {
  const { R, kind, from, to, drawnLabels } = env;
  let previous: RegionMove | undefined;
  for (const { js } of infos) {
    const j = js[0];
    previous = {
      f: kind[from[j]],
      t: kind[to[j]],
      text: drawnLabels[j],
      group: R > 1 ? js : [],
      other: previous,
    };
    yield previous;
  }
}

/** One move per (from state, to state, label) among the drawn steps of a region. */
function collectMoves(env: MoveEnv) {
  const { kind, position, size, from, to, sorted, drawnLabels, loop } = env;
  const pairOf = (j: number) => position[kind[from[j]]] * size + position[kind[to[j]]];
  const drawn = Array.from(sorted).filter((j) => kind[from[j]] !== kind[to[j]] || loop(j));
  const infos = [...Map.groupBy(drawn, (j) => `${pairOf(j)}:${drawnLabels[j]}`).values()].map(
    (js): MoveInfo => ({ pair: pairOf(js[0]), js }),
  );
  const made = new Map(
    [...Map.groupBy(infos, ({ pair }) => pair).values()].flatMap((chain) => {
      const moves = [...chainOf(chain, env)];
      return chain.map((info, k) => [info, moves[k]] as const);
    }),
  );
  return infos.map((info) => must(made, info));
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
  const seenAt = new Map(
    [...new Set(moves.map((move) => move.f))].map((f): [number, string[][]] => {
      const unique = new Map(must(tuplesAt, f).map((i) => [tupleKey(tuple(i)), tuple(i)] as const));
      return [f, [...unique.values()]];
    }),
  );
  const seenOf = (f: number) => must(seenAt, f);
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

/** The chart, and the view's group for each model state as the first region asked for it. */
export function drawRegions(
  walk: Walk,
  labels: Labels,
  order: Int32Array,
  found: Bug[],
  view: View,
): { chart: Chart; groups: unknown[] } {
  const { states: tla, index, from, to } = walk;
  const { names, shapes, drawnLabels, kinds, sorted, pathSteps, notes } = labels;
  const R = names.length;
  const leading = new Set(found.flatMap((b) => seqOf(b, index).slice(0, b.loop)));
  const looping = new Set(found.flatMap((b) => [...loopOf(b, index)]));
  const lead = Uint8Array.from({ length: shapes.length }, (_, i) => (leading.has(i) ? 1 : 0));
  const looped = Uint8Array.from({ length: shapes.length }, (_, i) => (looping.has(i) ? 1 : 0));
  const loop = (j: number) => R === 1 && pathSteps[j] === 1;
  const stays = (j: number) => kinds.every((kind) => kind[from[j]] === kind[to[j]]);
  const inside = Array.from(sorted).filter((j) => stays(j) && !loop(j)).length;
  const dirty = dirtyStates(tla, order, kinds);
  const comboOf = comboFn(kinds);
  const clean = Uint8Array.from({ length: shapes.length }, (_, i) =>
    !dirty.size || !dirty.has(comboOf(i)) ? 1 : 0,
  );
  const flags = { lead, looped, clean };
  const env = { walk, labels, order, flags, loop };
  const head = names.slice(0, 1).map((name) => regionOf(name, 0, { ...env, group: labels.group }));
  const asked = head[0]?.groupOf;
  const group = (i: number) => asked?.get(i);
  const tail = names.slice(1).map((name, k) => regionOf(name, k + 1, { ...env, group }));
  const built = [...head, ...tail];
  const hidden = hiddenStates(dirty, built, kinds);
  const regions = built.map(({ name, states, steps, arrows }) => ({
    name,
    states: states.map((s) => (hidden.has(s) ? { ...s, works: false } : s)),
    steps,
    arrows,
  }));
  const chart = {
    title: view.title,
    regions,
    notes,
    inside,
    quiet: drawnLabels.length - sorted.length,
    colors: view.colors ?? {},
    paths: found.filter((b) => b.loop !== 0).map((b) => b.rule.name),
    loops: found.filter((b) => b.loop !== undefined).map((b) => b.rule.name),
  };
  return { chart, groups: Array.from({ length: shapes.length }, (_, i) => group(i)) };
}

const comboFn = (kinds: Int32Array[]) =>
  kinds.length === 1
    ? (i: number): number | string => kinds[0][i]
    : (i: number): number | string => kinds.map((k) => k[i]).join(",");

const dirtyStates = (tla: Walk["states"], order: Int32Array, kinds: Int32Array[]) => {
  const comboOf = comboFn(kinds);
  const breaking = Array.from(order).filter((i) => tla[i].breaks.length);
  return new Map([...Map.groupBy(breaking, comboOf)].map(([c, is]) => [c, is[0]]));
};

type BuiltRegion = {
  name: string;
  states: ChartState[];
  steps: ChartStep[];
  arrows: Arrow[];
  objectOf: ChartState[];
  groupOf: Map<number, unknown>;
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

type RegionEnv = {
  walk: Walk;
  labels: Labels;
  group: (i: number) => unknown;
  order: Int32Array;
  flags: StateFlags;
  loop: (j: number) => boolean;
};

const regionOf = (name: string, r: number, env: RegionEnv): BuiltRegion => {
  const { walk, labels, group, order, flags, loop } = env;
  const { from, to } = walk;
  const { names, keys, kinds, sizes, sorted, drawnLabels } = labels;
  const R = names.length;
  const kind = kinds[r];
  const { states, objectOf, position, keyOf, groupOf } = buildStates(
    name,
    r,
    walk,
    labels,
    group,
    order,
    flags,
  );
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
  const arrowEnv = {
    names,
    others,
    tuple: (i: number) => others.map((o) => keys[o][i]),
    tuplesAt: Map.groupBy(order, (i) => kind[i]),
    from,
  };
  const arrows = R === 1 ? soloArrows(moves, keyOf) : arrowsOf(moves, keyOf, arrowEnv);
  const steps = arrows.map((a, k): ChartStep => ({
    from: objectOf[moves[k].f].path,
    to: objectOf[moves[k].t].path,
    label: a.label,
    when: a.label.endsWith("]") ? undefined : a.when,
  }));
  return { name, states: states.map((s) => s.state), steps, arrows, objectOf, groupOf };
};
