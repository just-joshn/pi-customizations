import {
  type Arrow,
  type Bug,
  type Chart,
  holds,
  type Labels,
  loopOf,
  must,
  tupleKey,
  unkey,
  type Walk,
} from "../ir.ts";

const takesFor =
  (
    stepsFrom: Map<number, number[]>,
    drawnLabels: string[],
    key: string[],
    to: Walk["to"],
    twins: number[],
  ) =>
  (a: Arrow) =>
    twins.some((s) =>
      (stepsFrom.get(s) ?? []).some((j) => drawnLabels[j] === a.label && key[to[j]] === a.to),
    );

const cannotTake = (a: Arrow, name: string, b: Bug) =>
  new Error(
    `The chart draws the step ${a.label} out of ${name ? `${name} ` : ""}${unkey(a.from).join(" / ")}, but the ${b.rule.name} loop cannot take it there. Show in a label what stops it.`,
  );

export function loopCheck(
  { regions, loops }: Chart,
  { names, keys, drawnLabels, sorted }: Labels,
  { index, from, to }: Walk,
  found: Bug[],
) {
  const combo = (i: number) => tupleKey(names.map((_, r) => keys[r][i]));
  const stepsFrom: Map<number, number[]> = loops.length
    ? Map.groupBy(sorted, (j) => from[j])
    : new Map();
  const arrowsFrom: Map<string, Arrow[]>[] = (loops.length ? regions : []).map(({ arrows }) =>
    Map.groupBy(arrows, (a) => a.from),
  );
  for (const b of found) {
    if (b.loop === undefined) continue;
    const twinsOf = Map.groupBy(loopOf(b, index), combo);
    const inLoop = new Set(twinsOf.keys());
    for (const i of loopOf(b, index)) {
      const twins = must(twinsOf, combo(i));
      for (const [r, name] of names.entries()) {
        const takes = takesFor(stepsFrom, drawnLabels, keys[r], to, twins);
        const rest = keys.flatMap((k, o) => (o === r ? [] : [k[i]]));
        const next = (a: Arrow) => keys.map((k, o) => (o === r ? a.to : k[i]));
        const live = (arrowsFrom[r].get(keys[r][i]) ?? []).filter((a) => holds(a.condition, rest));
        const stuck = live.find((a) => !inLoop.has(tupleKey(next(a))) && !takes(a));
        if (stuck) throw cannotTake(stuck, name, b);
      }
    }
  }
}
