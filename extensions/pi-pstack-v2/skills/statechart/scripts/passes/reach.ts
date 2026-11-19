import {
  type Bug,
  byText,
  count,
  defaultState,
  type Graph,
  must,
  type PathStep,
  type Rule,
  ruleKey,
  sortBy,
  type State,
  type Walk,
} from "../ir.ts";

const nodesOf = (graph: Graph) => {
  const entries = [...graph.states];
  const ids = entries.map(([id]) => id);
  const states = entries.map(([, s]) => s);
  const nameOf = states.map((s) => defaultState(s.vars));
  const startIdx = states.flatMap((s, i) => (s.start ? [i] : []));
  const names = Array.from(new Set(nameOf)).toSorted(byText);
  const rankOf = new Map(names.map((name, i) => [name, i]));
  const nameRank = Int32Array.from(nameOf, (name) => must(rankOf, name));
  const index = new Map(ids.map((id, i) => [id, i]));
  return { ids, states, nameOf, nameRank, index, startIdx };
};

const edgesOf = (graph: Graph, index: Map<string, number>, nameRank: Int32Array) => {
  const steps = graph.steps;
  const actionRank = new Map(
    Array.from(new Set(steps.map((t) => t.action)))
      .toSorted(byText)
      .map((a, i) => [a, i]),
  );
  const from = Int32Array.from(steps, (t) => must(index, t.from));
  const to = Int32Array.from(steps, (t) => must(index, t.to));
  const action = Int32Array.from(steps, (t) => must(actionRank, t.action));
  const toName = Int32Array.from(to, (t) => nameRank[t]);
  return { from, to, action, toName };
};

/** The edges leaving each state, in the order `sortedSteps` lists them. */
const adjacency = (from: Int32Array, sortedSteps: Int32Array) =>
  Map.groupBy(sortedSteps, (j) => from[j]);

/**
 * A set that only grows by adding a whole batch at once. It keeps a few sets of strictly
 * decreasing size and merges the two smallest when they would be as big as the one before,
 * so a node is copied O(log n) times in all.
 */
type Seen = readonly ReadonlySet<number>[];

const seenWith = (seen: Seen, batch: ReadonlySet<number>): Seen => {
  const last = seen.at(-1);
  if (last === undefined || last.size > batch.size) return [...seen, batch];
  return seenWith(seen.slice(0, -1), new Set([...last, ...batch]));
};

const isSeen = (seen: Seen, node: number) => seen.some((part) => part.has(node));

type Reach = { node: number; via: number };

/** The states first reached at each distance from `starts`, each with the step that reached it. */
function* levelsFrom(starts: number[], out: Map<number, number[]>, to: Int32Array) {
  let seen = seenWith([], new Set(starts));
  let level: Reach[] = starts.map((node) => ({ node, via: -1 }));
  while (level.length) {
    yield level;
    const found = level
      .flatMap(({ node }) => (out.get(node) ?? []).map((e): Reach => ({ node: to[e], via: e })))
      .filter((reach) => !isSeen(seen, reach.node));
    level = [...Map.groupBy(found, (reach) => reach.node).values()].map((group) => group[0]);
    seen = seenWith(seen, new Set(level.map((reach) => reach.node)));
  }
}

const breadthFirst = (
  n: number,
  starts: number[],
  out: Map<number, number[]>,
  to: Int32Array,
) => {
  const levels = [...levelsFrom(starts, out, to)];
  const at = new Map(
    levels.flatMap((level, depth) => level.map(({ node, via }) => [node, { depth, via }] as const)),
  );
  return {
    depth: Int32Array.from({ length: n }, (_, i) => at.get(i)?.depth ?? -1),
    via: Int32Array.from({ length: n }, (_, i) => at.get(i)?.via ?? -1),
    reached: Int32Array.from(levels.flat(), ({ node }) => node),
  };
};

export function walk(graph: Graph): Walk {
  const { ids, states, nameOf, nameRank, index, startIdx } = nodesOf(graph);
  const n = ids.length;
  const { from, to, action, toName } = edgesOf(graph, index, nameRank);
  const out = adjacency(from, sortBy(count(from.length), [action, toName]));
  const starts = startIdx.toSorted((a, b) => nameRank[a] - nameRank[b]);
  const { depth, via, reached } = breadthFirst(n, starts, out, to);
  return { ids, states, index, nameOf, nameRank, from, to, action, depth, via, reached, starts };
}

export function drawOrder({ depth, nameRank }: Walk) {
  const n = depth.length;
  const deepest = depth.reduce((most, d) => Math.max(most, d), 0);
  const level = Int32Array.from(depth, (d) => (d < 0 ? deepest + 1 : d));
  const order = sortBy(count(n), [level, nameRank]);
  const position = new Map(Array.from(order, (state, p) => [state, p]));
  const rank = Int32Array.from({ length: n }, (_, state) => must(position, state));
  return { order, rank };
}

function* viaChain(via: Int32Array, from: Int32Array, end: number) {
  for (let at = end, j = via[at]; j >= 0; j = via[at]) {
    yield j;
    at = from[j];
  }
}

const routeTo = (
  graph: Graph,
  { ids, from, via }: Pick<Walk, "ids" | "from" | "via">,
  end: number,
) => {
  const js = Array.from(viaChain(via, from, end));
  const start = js.length ? from[js[js.length - 1]] : end;
  const path: PathStep[] = js.toReversed().map((j) => {
    const step = graph.steps[j];
    return { action: step.action, state: step.to, step };
  });
  return { start: ids[start], path };
};

export function bugs(graph: Graph, { ids, from, via, reached }: Walk = walk(graph)) {
  const ends = new Map(
    [...graph.states].flatMap(([id, s]) => (s.ends ?? []).map((rule) => [ruleKey(rule), id] as const)),
  );
  const candidates = Array.from(reached).flatMap((i) => {
    const s = must(graph.states, ids[i]);
    return (s.past ? s.ends : s.breaks)
      .map((rule) => ({ rule, i, k: ruleKey(rule) }))
      .filter(({ k }) => (ends.get(k) ?? ids[i]) === ids[i]);
  });
  return [...Map.groupBy(candidates, ({ k }) => k).values()].map(([{ rule, i }]): Bug => ({
    rule,
    ...routeTo(graph, { ids, from, via }, i),
  }));
}
