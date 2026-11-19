import {
  type Answers,
  type Bug,
  type Graph,
  type Hidden,
  isRecord,
  key,
  type Labels,
  list,
  loopOf,
  must,
  type Rule,
  type Shape,
  sortBy,
  stateText,
  type Step,
  type Story,
  tupleKey,
  type Vars,
  type View,
  type Walk,
} from "../ir.ts";

const isLabel = (l: unknown): l is string =>
  typeof l === "string" && l !== "" && !/\bundefined\b|\bNaN\b|\[object Object\]/.test(l);

const shapeOf = (shape: unknown, vars: Vars): Shape => {
  function fail(): never {
    throw new Error(
      `The view's state() returned ${JSON.stringify(shape) ?? "undefined"} for the state ${stateText(vars)}. Return a string, an array of strings, or an object of those.`,
    );
  }
  const path = (p: unknown) => {
    const labels: unknown[] = [p].flat();
    if (!labels.length || !labels.every(isLabel)) fail();
    return labels;
  };
  const regions: [string, unknown][] = isRecord(shape) ? Object.entries(shape) : [["", shape]];
  const pairs = regions.map(([k, v]): [string, string[]] => [k, path(v)]);
  return pairs.length ? Object.fromEntries(pairs) : fail();
};

const stepOf = (view: View) => (action: string, from: Vars, to: Vars) => {
  const label = (view.step ?? ((a: string) => a))(action, from, to);
  if (label === null || isLabel(label)) return label;
  throw new Error(
    `The view's step() returned ${JSON.stringify(label) ?? "undefined"} for the step ${action}.`,
  );
};

function unlabeled(
  action: string,
  before: Vars,
  after: Vars,
  bug: { rule: Rule; loop?: number },
): never {
  const changed = Object.keys(after).filter((k) => key(before[k]) !== key(after[k]));
  throw new Error(
    `The view's step() returned null for the step ${action} that changes ${changed.join(", ") || "nothing"}. It is on the path to the ${bug.rule.name} bug${bug.loop === undefined ? "" : " or leaves its loop"}, so label it.`,
  );
}

export function ask(graph: Graph, { states: tla, nameOf, from, to }: Walk, view: View): Answers {
  const state = view.state;
  const shapes = Array.from({ length: nameOf.length }, (_, i) =>
    shapeOf(state ? state(tla[i].vars) : nameOf[i], tla[i].vars),
  );
  const names = Object.keys(shapes[0] ?? { "": [] });
  const regionsKey = tupleKey(names);
  const odd = shapes.findIndex((shape) => tupleKey(Object.keys(shape)) !== regionsKey);
  if (odd >= 0)
    throw new Error(
      `The view's state() returned the regions ${names.join(", ")} for one state and ${Object.keys(shapes[odd]).join(", ")} for the state ${stateText(tla[odd].vars)}. Return the same regions for every state.`,
    );
  const step = stepOf(view);
  const labels = Array.from({ length: from.length }, (_, j): string | Hidden =>
    step(graph.steps[j].action, tla[from[j]].vars, tla[to[j]].vars),
  );
  const group = (i: number) => view.group?.(tla[i].vars);
  return { names, shapes, labels, group };
}

export function asParents(
  { states: tla }: Walk,
  { names, shapes, labels, group }: Answers,
): Answers {
  const parents = shapes.map((shape, i) =>
    shapeOf(
      names.flatMap((n) => shape[n].map((p) => `${n} ${p}`)),
      tla[i].vars,
    ),
  );
  return { names: [""], shapes: parents, labels, group };
}

const regionKeys = (name: string, shapes: Shape[]) => {
  const key = shapes.map((shape) => tupleKey(shape[name]));
  const firstSeen = [...new Set(key)];
  const code = new Map(firstSeen.map((k, c) => [k, c]));
  return { key, kind: Int32Array.from(key, (k) => must(code, k)), size: firstSeen.length };
};

const unlabeledStep = (
  graph: Graph,
  b: Bug,
  stepLabels: (string | Hidden)[],
  pathStepIndex: Map<Step, number>,
  { index, from, to }: Walk,
) => {
  const onPath = b.path.find((p) => stepLabels[must(pathStepIndex, p.step)] === null);
  if (onPath) return onPath.step;
  const inLoop = loopOf(b, index);
  if (!inLoop.size) return undefined;
  const j = stepLabels.findIndex(
    (label, j) => inLoop.has(from[j]) && !inLoop.has(to[j]) && label === null,
  );
  return j < 0 ? undefined : graph.steps[j];
};

const checkLabeled = (
  graph: Graph,
  found: Bug[],
  stepLabels: (string | Hidden)[],
  pathStepIndex: Map<Step, number>,
  walk: Walk,
) => {
  for (const b of found) {
    const t = unlabeledStep(graph, b, stepLabels, pathStepIndex, walk);
    if (t) unlabeled(t.action, must(graph.states, t.from).vars, must(graph.states, t.to).vars, b);
  }
};

type Together = { changed: boolean[]; sets: Set<string> };

const changesByLabel = (
  names: string[],
  kinds: Int32Array[],
  sorted: Int32Array,
  drawnLabels: string[],
  { from, to }: Walk,
) => {
  if (names.length < 2) return new Map<string, Together>();
  const movesOf = (j: number) => names.map((_, r) => kinds[r][from[j]] !== kinds[r][to[j]]);
  const changedAt = (j: number) => names.filter((_, r) => movesOf(j)[r]);
  const togetherOf = (js: number[]): Together => ({
    changed: names.map((_, r) => js.some((j) => movesOf(j)[r])),
    sets: new Set(js.map(changedAt).flatMap((changed) => (changed.length > 1 ? [list(changed)] : []))),
  });
  return new Map(
    [...Map.groupBy(sorted, (j) => drawnLabels[j])].map(([text, js]) => [text, togetherOf(js)]),
  );
};

const notesOf = (names: string[], byLabel: Map<string, Together>, together: Set<string>) =>
  [...byLabel].flatMap(([text, entry]) => {
    const changed = names.filter((_, r) => entry.changed[r]);
    if (changed.length < 2) return [];
    if (!together.has(text))
      return [`The step ${text} changes only one of ${list(changed)} at a time.`];
    const sets = [...entry.sets];
    return [
      `The step ${text} changes ${sets.length > 1 ? `${sets.join(", or ")},` : sets[0]} at the same time.`,
    ];
  });

const pathIndexOf = (graph: Graph, found: Bug[], m: number) => {
  const onPath = new Set<Step>(found.flatMap((b) => b.path.map((p) => p.step)));
  return new Map(
    graph.steps.slice(0, m).flatMap((step, j) => (onPath.has(step) ? [[step, j] as const] : [])),
  );
};

export function labelGraph(
  graph: Graph,
  walk: Walk,
  answers: Answers,
  rank: Int32Array,
  found: Bug[],
): Labels {
  const { from, to, action } = walk;
  const { names, shapes, labels: stepLabels } = answers;
  const m = stepLabels.length;
  const pathStepIndex = pathIndexOf(graph, found, m);
  const perRegion = names.map((name) => regionKeys(name, shapes));
  const keys = perRegion.map((p) => p.key);
  const kinds = perRegion.map((p) => p.kind);
  const sizes = perRegion.map((p) => p.size);
  checkLabeled(graph, found, stepLabels, pathStepIndex, walk);
  const drawn = Array.from({ length: m }, (_, j) => j).filter((j) => stepLabels[j] !== null);
  const drawnLabels = stepLabels.map((label) => (label === null ? undefined : label)) as string[];
  const fromRank = Int32Array.from(from, (f) => rank[f]);
  const toRank = Int32Array.from(to, (t) => rank[t]);
  const sorted = sortBy(Int32Array.from(drawn), [fromRank, toRank, action]);
  const onPathStep = new Set(pathStepIndex.values());
  const pathSteps = Uint8Array.from({ length: m }, (_, j) => (onPathStep.has(j) ? 1 : 0));
  const byLabel = changesByLabel(names, kinds, sorted, drawnLabels, walk);
  const together = new Set([...byLabel].filter(([, e]) => e.sets.size).map(([text]) => text));
  const notes = notesOf(names, byLabel, together);
  return {
    ...answers,
    drawnLabels,
    keys,
    kinds,
    sizes,
    sorted,
    pathStepIndex,
    pathSteps,
    together,
    notes,
  };
}

type Told<Id> = { rule: Rule; start: Id; path: { action: string; state: Id }[]; loop?: number };

function tell<Id, B extends Told<Id>>(
  states: ReadonlyMap<Id, { vars: Vars }>,
  found: B[],
  shapeAt: (id: Id) => Shape,
  labelAt: (bug: B, k: number, from: Id) => string | Hidden,
) {
  const vars = (id: Id) => must(states, id).vars;
  const storyOf = (bug: B): Story => {
    const rest = bug.path.reduce<{ from: Id; story: Story }>(
      ({ from, story }, p, k) => {
        const step = labelAt(bug, k, from);
        if (step === null) unlabeled(p.action, vars(from), vars(p.state), bug);
        return { from: p.state, story: [...story, { step, state: shapeAt(p.state) }] };
      },
      { from: bug.start, story: [{ state: shapeAt(bug.start) }] },
    );
    return rest.story;
  };
  return new Map(found.map((bug) => [bug, storyOf(bug)]));
}

export const storiesOf = (
  graph: Graph,
  found: Bug[],
  { index }: Walk,
  { shapes, drawnLabels, pathStepIndex }: Labels,
) =>
  tell(
    graph.states,
    found,
    (id) => shapes[must(index, id)],
    (bug, k) => drawnLabels[must(pathStepIndex, bug.path[k].step)],
  );
