import {
  append,
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

const addMove = (moves: Map<string, Move>, m: Move) =>
  moves.set(tupleKey([m.from, m.text, m.to]), m);

const groupsOf = (list: Enabled[], isTogether: boolean) => {
  if (!isTogether) return list.map((m) => [m]);
  const byRegion = new Map<number, Enabled[]>();
  for (const m of list) append(byRegion, m.i, m);
  return [...byRegion.values()].reduce<Enabled[][]>(
    (groups, opts) => groups.flatMap((g) => opts.map((m) => [...g, m])),
    [[]],
  );
};

const drawnMoves = (
  regions: Region[],
  combos: Map<string, string[]>,
  together: Labels["together"],
) => {
  const drawn = new Map<string, Move>();
  for (const c of combos.values()) {
    const enabled = new Map<string, Enabled[]>();
    for (const [i, r] of regions.entries()) {
      const rest = c.filter((_, k) => k !== i);
      for (const a of r.arrows)
        if (a.from === c[i] && holds(a.condition, rest)) append(enabled, a.label, { i, a });
    }
    for (const [text, list] of enabled)
      for (const group of groupsOf(list, together.has(text))) {
        const to = group.reduce((acc, { i, a }) => acc.with(i, a.to), c);
        addMove(drawn, { from: c, text, to });
      }
  }
  return drawn;
};

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
  const real = new Map<string, Move>();
  for (const j of sorted) {
    const before = combo(from[j]);
    const after = combo(to[j]);
    if (tupleKey(before) !== tupleKey(after))
      addMove(real, { from: before, text: drawnLabels[j], to: after });
  }
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
