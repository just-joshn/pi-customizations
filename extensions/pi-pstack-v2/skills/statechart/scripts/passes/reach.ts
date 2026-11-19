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

const adjacency = (n: number, from: Int32Array, sortedSteps: Int32Array) => {
  const m = from.length;
  const first = new Int32Array(n + 1);
  for (let j = 0; j < m; j++) first[from[j] + 1]++;
  for (let i = 0; i < n; i++) first[i + 1] += first[i];
  const fill = first.slice(0, n);
  const next = new Int32Array(m);
  for (const j of sortedSteps) next[fill[from[j]]++] = j;
  return { first, next };
};

const breadthFirst = (
  n: number,
  starts: number[],
  { first, next }: { first: Int32Array; next: Int32Array },
  to: Int32Array,
) => {
  const depth = new Int32Array(n).fill(-1);
  const via = new Int32Array(n).fill(-1);
  const reached = new Int32Array(n);
  let size = 0;
  for (const s of starts) {
    depth[s] = 0;
    reached[size++] = s;
  }
  for (let q = 0; q < size; q++) {
    const s = reached[q];
    for (let e = first[s]; e < first[s + 1]; e++) {
      const t = to[next[e]];
      if (depth[t] >= 0) continue;
      depth[t] = depth[s] + 1;
      via[t] = next[e];
      reached[size++] = t;
    }
  }
  return { depth, via, reached: reached.subarray(0, size) };
};

export function walk(graph: Graph): Walk {
  const { ids, states, nameOf, nameRank, index, startIdx } = nodesOf(graph);
  const n = ids.length;
  const { from, to, action, toName } = edgesOf(graph, index, nameRank);
  const csr = adjacency(n, from, sortBy(count(from.length), [action, toName]));
  const starts = startIdx.toSorted((a, b) => nameRank[a] - nameRank[b]);
  const { depth, via, reached } = breadthFirst(n, starts, csr, to);
  return { ids, states, index, nameOf, nameRank, from, to, action, depth, via, reached, starts };
}

export function drawOrder({ depth, nameRank }: Walk) {
  const n = depth.length;
  let deepest = 0;
  for (let i = 0; i < n; i++) if (depth[i] > deepest) deepest = depth[i];
  const level = new Int32Array(n);
  for (let i = 0; i < n; i++) level[i] = depth[i] < 0 ? deepest + 1 : depth[i];
  const order = sortBy(count(n), [level, nameRank]);
  const rank = new Int32Array(n);
  for (let p = 0; p < n; p++) rank[order[p]] = p;
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
  const ends = new Map<string, string>();
  for (const [id, s] of graph.states) for (const rule of s.ends ?? []) ends.set(ruleKey(rule), id);
  const first = new Map<string, { rule: Rule; i: number }>();
  for (const i of reached) {
    const s = must(graph.states, ids[i]);
    for (const rule of s.past ? s.ends : s.breaks) {
      const k = ruleKey(rule);
      if (!first.has(k) && (ends.get(k) ?? ids[i]) === ids[i]) first.set(k, { rule, i });
    }
  }
  return [...first.values()].map(({ rule, i }): Bug => ({
    rule,
    ...routeTo(graph, { ids, from, via }, i),
  }));
}
