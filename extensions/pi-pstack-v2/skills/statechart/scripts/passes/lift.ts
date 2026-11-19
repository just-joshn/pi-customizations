import {
  append,
  type Chart,
  type ChartState,
  type ChartStep,
  must,
  type Region,
  tupleKey,
  unkey,
} from "../ir.ts";

export function liftToParents(states: ChartState[], steps: ChartStep[]) {
  const depths = new Map<string, number>();
  const leaves = new Map<string, number>();
  for (const s of states.values())
    for (let i = 1; i < s.path.length; i++) {
      const prefix = tupleKey(s.path.slice(0, i));
      depths.set(prefix, i);
      leaves.set(prefix, (leaves.get(prefix) ?? 0) + 1);
    }
  if (!depths.size) return steps;
  const leaving = new Map<string, ChartStep[]>();
  for (const s of steps) {
    let same = 0;
    while (same < s.from.length && s.from[same] === s.to[same]) same++;
    for (let i = 1; i < s.from.length; i++) {
      if (i <= same && i < s.to.length) continue;
      const prefix = tupleKey(s.from.slice(0, i));
      if (depths.has(prefix)) append(leaving, prefix, s);
    }
  }
  const removed = new Set<ChartStep>();
  const liftAt = (prefix: string) => {
    const groups = new Map<string, ChartStep[]>();
    for (const s of leaving.get(prefix) ?? [])
      if (!removed.has(s)) append(groups, tupleKey([s.label, s.when, s.to]), s);
    const under = must(leaves, prefix);
    const full = [...groups.values()].filter((group) => under >= 2 && group.length >= under);
    return full.map((group) => {
      for (const s of group) removed.add(s);
      return { ...group[0], from: unkey(prefix) };
    });
  };
  const lifted = [...depths].toSorted((a, b) => a[1] - b[1]).flatMap(([prefix]) => liftAt(prefix));
  return [...steps.filter((s) => !removed.has(s)), ...lifted];
}

const mergeKey = (s: ChartStep, f: number, t: number) =>
  s.when === undefined && f < 2 ** 26 && t < 2 ** 26 ? f * 2 ** 26 + t : `${f},${t}:${s.when}`;

const mergeSteps = (r: Region, pathIndex: (path: string[]) => number) => {
  const merged = new Map<number | string, ChartStep>();
  for (const s of liftToParents(r.states, r.steps)) {
    const k = mergeKey(s, pathIndex(s.from), pathIndex(s.to));
    const prior = merged.get(k);
    merged.set(k, prior ? { ...prior, label: `${prior.label} or ${s.label}` } : { ...s });
  }
  return [...merged.values()];
};

const pathIndexer = (r: Region) => {
  const known = new Map<string[], number>();
  for (const s of r.states) known.set(s.path, known.size);
  let numbers: Map<string, number> | undefined;
  return (path: string[]) => {
    let i = known.get(path);
    if (i !== undefined) return i;
    if (!numbers) {
      numbers = new Map();
      for (const s of r.states) numbers.set(tupleKey(s.path), numbers.size);
    }
    const k = tupleKey(path);
    i = numbers.get(k);
    if (i === undefined) numbers.set(k, (i = numbers.size));
    known.set(path, i);
    return i;
  };
};

export function lift(chart: Chart): Chart {
  const regions = chart.regions.map((r) => ({ ...r, steps: mergeSteps(r, pathIndexer(r)) }));
  return { ...chart, regions };
}
