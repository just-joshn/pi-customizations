import {
  type Chart,
  type ChartState,
  type ChartStep,
  must,
  type Region,
  tupleKey,
  unkey,
} from "../ir.ts";

const MIN_LEAVES = 2;

/** Every proper prefix of each state's path, as a key and its length. */
const prefixesOf = (states: ChartState[]) =>
  states.flatMap((s) =>
    Array.from({ length: Math.max(s.path.length - 1, 0) }, (_, k) => {
      const length = k + 1;
      return [tupleKey(s.path.slice(0, length)), length] as const;
    }),
  );

/** The prefixes of `s.from` that `s` leaves, among the parents in `depths`. */
const leftParents = (s: ChartStep, depths: ReadonlyMap<string, number>) => {
  const same = s.from.findIndex((part, k) => part !== s.to[k]);
  const shared = same === -1 ? s.from.length : same;
  return Array.from({ length: Math.max(s.from.length - 1, 0) }, (_, k) => k + 1)
    .filter((i) => !(i <= shared && i < s.to.length))
    .map((i) => tupleKey(s.from.slice(0, i)))
    .filter((prefix) => depths.has(prefix));
};

type Lifting = { removed: ReadonlySet<ChartStep>; lifted: ChartStep[][] };

export function liftToParents(states: ChartState[], steps: ChartStep[]) {
  const prefixes = prefixesOf(states);
  const depths = new Map(prefixes);
  if (!depths.size) return steps;
  const leaves = new Map([...Map.groupBy(prefixes, ([prefix]) => prefix)].map(([p, g]) => [p, g.length]));
  const leaving = Map.groupBy(
    steps.flatMap((s) => leftParents(s, depths).map((prefix) => ({ prefix, s }))),
    ({ prefix }) => prefix,
  );
  const liftAt = ({ removed, lifted }: Lifting, prefix: string): Lifting => {
    const open = (leaving.get(prefix) ?? []).map(({ s }) => s).filter((s) => !removed.has(s));
    const groups = Map.groupBy(open, (s) => tupleKey([s.label, s.when, s.to]));
    const under = must(leaves, prefix);
    const full = [...groups.values()].filter(
      (group) => under >= MIN_LEAVES && group.length >= under,
    );
    return {
      removed: new Set([...removed, ...full.flat()]),
      lifted: [...lifted, full.map((group) => ({ ...group[0], from: unkey(prefix) }))],
    };
  };
  const order = [...depths].toSorted((a, b) => a[1] - b[1]).map(([prefix]) => prefix);
  const done = order.reduce(liftAt, { removed: new Set(), lifted: [] } as Lifting);
  return [...steps.filter((s) => !done.removed.has(s)), ...done.lifted.flat()];
}

const mergeKey = (s: ChartStep) => tupleKey([s.from, s.to, s.when]);

const mergeSteps = (r: Region) =>
  [...Map.groupBy(liftToParents(r.states, r.steps), mergeKey).values()].map((group) =>
    group.slice(1).reduce((prior, s) => ({ ...prior, label: `${prior.label} or ${s.label}` }), {
      ...group[0],
    }),
  );

export function lift(chart: Chart): Chart {
  const regions = chart.regions.map((r) => ({ ...r, steps: mergeSteps(r) }));
  return { ...chart, regions };
}
