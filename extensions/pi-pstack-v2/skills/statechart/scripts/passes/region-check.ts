import {
  type Arrow,
  holds,
  type Labels,
  type Region,
  tupleKey,
  unkey,
  type Walk,
} from "../ir.ts";

type Move = { from: string[]; text: string; to: string[] };
type Enabled = { i: number; a: Arrow };

const moveEntry = (m: Move) => [tupleKey([m.from, m.text, m.to]), m] as const;

const groupsOf = (list: Enabled[], isTogether: boolean) => {
  if (!isTogether) return list.map((m) => [m]);
  return [...Map.groupBy(list, (m) => m.i).values()].reduce<Enabled[][]>(
    (groups, opts) => groups.flatMap((g) => opts.map((m) => [...g, m])),
    [[]],
  );
};

const movesFrom = (regions: Region[], c: string[], together: Labels["together"]): Move[] => {
  const enabled = regions.flatMap((r, i) => {
    const rest = c.filter((_, k) => k !== i);
    return r.arrows
      .filter((a) => a.from === c[i] && holds(a.condition, rest))
      .map((a): Enabled => ({ i, a }));
  });
  return [...Map.groupBy(enabled, ({ a }) => a.label)].flatMap(([text, list]) =>
    groupsOf(list, together.has(text)).map((group) => ({
      from: c,
      text,
      to: group.reduce((acc, { i, a }) => acc.with(i, a.to), c),
    })),
  );
};

const drawnMoves = (
  regions: Region[],
  combos: Map<string, string[]>,
  together: Labels["together"],
) =>
  new Map(
    [...combos.values()].flatMap((c) => movesFrom(regions, c, together)).map(moveEntry),
  );

const startsLie = (regions: Region[], realStarts: Set<string>, words: (c: string[]) => string) => {
  const product = regions.reduce<string[][]>(
    (acc, r) =>
      acc.flatMap((c) => r.states.filter((s) => s.start).map((s) => [...c, tupleKey(s.path)])),
    [[]],
  );
  const bad = product.find((c) => !realStarts.has(tupleKey(c)));
  return bad && `The regions chart starts at ${words(bad)}, where the model never starts.`;
};

const conditionLie = (regions: Region[], names: string[]) => {
  for (const [i, r] of regions.entries())
    for (const a of r.arrows)
      if (a.condition.kind === "tuples")
        return `In ${names[i]}, ${a.label} from ${unkey(a.from).join(" / ")} depends on the other regions in a way that one "and" or "or" condition cannot say.`;
  return undefined;
};

export function regionsLie(
  regions: Region[],
  { names, keys, sorted, drawnLabels, together }: Labels,
  { from, to, starts }: Walk,
  order: Int32Array,
) {
  if (names.length < 2) return undefined;
  const combo = (i: number) => names.map((_, r) => keys[r][i]);
  const words = (c: string[]) =>
    names.map((name, i) => `${name} ${unkey(c[i]).join(" / ")}`).join(", ");
  const early =
    startsLie(regions, new Set(Array.from(starts, (i) => tupleKey(combo(i)))), words) ??
    conditionLie(regions, names);
  if (early) return early;
  const real = new Map(
    Array.from(sorted).flatMap((j): Move[] => {
      const before = combo(from[j]);
      const after = combo(to[j]);
      return tupleKey(before) === tupleKey(after)
        ? []
        : [{ from: before, text: drawnLabels[j], to: after }];
    }).map(moveEntry),
  );
  const combos = new Map(Array.from(order, (i) => [tupleKey(combo(i)), combo(i)] as const));
  const drawn = drawnMoves(regions, combos, together);
  for (const [k, extra] of drawn)
    if (!real.has(k))
      return `The regions chart lets ${words(extra.from)} go to ${words(extra.to)} by ${extra.text}, which the model never does.`;
  for (const [k, missing] of real)
    if (!drawn.has(k))
      return `The model goes from ${words(missing.from)} to ${words(missing.to)} by ${missing.text}, which the regions chart cannot show.`;
  return undefined;
}
