import { inspect } from "node:util";
import { mermaid as chartText } from "../backends/mermaid.ts";
import { checkView } from "../frontends/view.ts";
import type { Chart, State, Step, View } from "../ir.ts";
import { walk } from "../passes/reach.ts";
import { project } from "../pipeline.ts";
import { expected, readMermaid, readPele, type Tools } from "./labels-oracle.ts";

export type { Html, Mermaid, Render } from "./labels-oracle.ts";

const THEME = ["blue", "orange", "purple", "yellow", "teal", "tan", "pink"];
const WORDS = ["Idle", "Run", "a", "b", "x1", "ok", "Done", "waiting", "on", "off", "p q"];
const SYNTAX = [
  "-->",
  "[*]",
  "{",
  "}",
  "[",
  "]",
  "(",
  ")",
  ":",
  ";",
  "#",
  "%%",
  '"',
  "'",
  "`",
  "|",
  "\\",
  ":::",
  "::: x",
  "--",
  "---",
  "<<fork>>",
  "<<join>>",
  "<<choice>>",
  "[[fork]]",
  "[[join]]",
  "[[choice]]",
  "<br>",
  "<b>x</b>",
  "<a",
  "<a=",
  "=",
  "&amp;",
  "&lt;",
  "&#59;",
  "&quot;",
  "#quot;",
  "#59;",
  "#35;",
  "**",
  "__",
  "*",
  "_",
  "~~",
  "$$",
  "${x}",
  "state",
  "as",
  "note",
  "end",
  "class",
  "classDef",
  "style",
  "click",
  "direction LR",
  "direction TB",
  "Direction rl",
  "direction\tBT",
  "direction  LR",
  "accTitle: x",
  "accDescr: y",
  "title: t",
  "%%{",
  "}%%",
  "%%{init: {}}%%",
  "C4Context",
  "C4Container",
  "C4Component",
  "C4Dynamic",
  "C4Deployment",
  "&nbsp;",
  "\\n",
  "---\n",
  "`**b**`",
  "ﬂ°°65¶ß",
  "ﬂ°lt¶ß",
  'marker-end="url(a#',
  "<<",
  ">>",
  "<<a>>",
  "|->",
  ":>",
  "@@",
  "/\\",
  "\\/",
  "..",
  '"A"',
  'x="a"',
  "[a |-> 1]",
  "{1, 2}",
  '"\\n"',
  "&",
  "<",
  ">",
  "@",
  "~",
  "^",
  "$",
  "%",
];
const SPACE = [
  " ",
  "  ",
  "\t",
  "\n",
  "\r",
  "\r\n",
  "\v",
  "\f",
  "\u00a0",
  "\u2028",
  "\u2029",
  "\u0085",
  "\u200b",
  "\ufeff",
  "\u3000",
];
const OTHER = [
  "é",
  "ü",
  "中文",
  "😀",
  "👩‍💻",
  "e\u0301",
  "\u202e",
  "\u200f",
  "ß",
  "Ω",
  "\ud800",
  "\x7f",
  "\x80",
  "\x9f",
  "\x1b",
  "\x00",
];
const BAD_COLORS: unknown[] = [
  "pink\n  s99: Ghost state",
  "blue\r\nclassDef x fill:#f00",
  "teal\r",
  " pink",
  "Pink",
  "red",
  "#00f",
  "breaks",
  "mayBreak",
  "bugPath",
  "repeats",
  "toString",
  "",
  null,
  7,
  ["blue"],
];

const random = (seed: number) => {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return {
    int,
    range: (lo: number, hi: number) => lo + int(hi - lo + 1),
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]) => items[int(items.length)],
  };
};

type Random = ReturnType<typeof random>;

const label = (r: Random) => {
  let s = "";
  for (let n = r.range(1, 4); n > 0; n--) {
    const k = r.int(13);
    if (k < 4) s += r.pick(WORDS);
    else if (k < 7) s += r.pick(SYNTAX);
    else if (k < 9) s += r.pick(SPACE);
    else if (k < 11) s += r.pick(OTHER);
    else s += String.fromCharCode(32 + r.int(95));
  }
  return s;
};

const color = (r: Random) => {
  if (r.chance(0.85)) return r.pick(THEME);
  const k = r.int(3);
  if (k === 0) return r.pick(BAD_COLORS);
  if (k === 1) return r.pick(THEME) + r.pick(SPACE) + label(r);
  return label(r);
};

const several = <T>(n: number, make: () => T) => Array.from({ length: n }, () => make());

type Shape =
  | { mode: "flat"; leaf: number[] }
  | { mode: "parents"; leaf: number[]; parents: number[]; parentOf: number[] }
  | { mode: "regions"; regions: number[]; pools: number[][]; values: number[][] };

type Groups =
  | { groups?: undefined; colors?: undefined; groupOf?: undefined }
  | { groups: number[]; colors: unknown[]; groupOf: number[] };

type Case = Shape &
  Groups & { n: number; labels: string[]; actions: number[]; steps: number[][]; title?: number };

function generate(r: Random): Case {
  let labels: readonly string[] = [];
  const slot = () => {
    labels = [...labels, label(r)];
    return labels.length - 1;
  };
  const k = r.int(10);
  const mode = k < 4 ? "flat" : k < 7 ? "parents" : "regions";
  const n = r.range(2, 4);
  let shape: Shape;
  if (mode === "regions") {
    shape = {
      mode,
      regions: [slot(), slot()],
      pools: [
        [slot(), slot()],
        [slot(), slot()],
      ],
      values: several(n, () => [r.int(2), r.int(2)]),
    };
  } else {
    const leaf = several(n, slot);
    if (mode === "parents") {
      const parents = r.chance(0.5) ? [slot(), slot()] : [slot()];
      const parentOf = several(n, () => (r.chance(0.75) ? r.int(parents.length) : -1));
      shape = { mode, leaf, parents, parentOf };
    } else shape = { mode, leaf };
  }
  const actions = several(r.range(1, 3), slot);
  const steps = several(r.range(1, 5), () => [r.int(n), r.int(n), r.int(actions.length)]);
  let groups: Groups = {};
  if (r.chance(0.4)) {
    const named = several(r.range(1, 2), slot);
    const colors = several(named.length, () => color(r));
    const groupOf = several(n, () => (r.chance(0.8) ? r.int(named.length) : -1));
    groups = { groups: named, colors, groupOf };
  }
  const title = r.chance(0.3) ? slot() : undefined;
  return { ...shape, ...groups, n, labels: [...labels], actions, steps, title };
}

type RawView = {
  state: (vars: { k: number }) => unknown;
  step: (action: string) => string;
  group?: (vars: { k: number }) => string | undefined;
  colors?: { [group: string]: unknown };
  title?: string;
};

const regionShape = (c: Case & { mode: "regions" }, labels: string[], k: number) =>
  Object.fromEntries(
    c.regions.map((region, j) => [labels[region], labels[c.pools[j][c.values[k][j]]]]),
  );

const stateView = (c: Case, labels: string[], k: number) => {
  if (c.mode === "regions") return regionShape(c, labels, k);
  const leaf = labels[c.leaf[k]];
  return c.mode === "parents" && c.parentOf[k] >= 0 ? [labels[c.parents[c.parentOf[k]]], leaf] : leaf;
};

const groupView = (c: Case, labels: string[]): Pick<RawView, "group" | "colors"> => {
  const { groups, groupOf, colors } = c;
  if (!groups) return {};
  return {
    group: ({ k }) => (groupOf[k] < 0 ? undefined : labels[groups[groupOf[k]]]),
    colors: Object.fromEntries(groups.map((group, j) => [labels[group], colors[j]])),
  };
};

function build(c: Case, labels: string[]) {
  const states = new Map<string, State>(
    Array.from({ length: c.n }, (_, i): [string, State] => [
      String(i),
      { vars: { k: i }, start: i === 0, breaks: [] },
    ]),
  );
  const steps: Step[] = c.steps.map(([from, to, a]) => ({
    from: String(from),
    to: String(to),
    action: `A${a}`,
  }));
  const view: RawView = {
    state: ({ k }) => stateView(c, labels, k),
    step: (action) => labels[c.actions[Number(action.slice(1))]],
    ...groupView(c, labels),
    ...(c.title === undefined ? {} : { title: labels[c.title] }),
  };
  return { graph: { states, steps }, view };
}

type Checked = { refused?: true; text?: string; problems: string[] };

async function check(c: Case, labels: string[], tools: Tools): Promise<Checked> {
  const { graph, view } = build(c, labels);
  let refuse = false;
  for (const [, value] of Object.entries(view.colors ?? {}))
    if (typeof value !== "string" || !THEME.includes(value)) refuse = true;
  let checked: View;
  try {
    checked = checkView(view, inspect);
  } catch (e) {
    if (!(e instanceof Error)) throw e;
    if (refuse && /^The view\x27s colors give /.test(e.message))
      return { refused: true, problems: [] };
    return { problems: [`skill-throws: ${e.message}`] };
  }
  if (refuse) return { problems: ["colors: checkView accepts a color that is not in the theme"] };
  let chart: Chart;
  let text: string;
  try {
    ({ chart } = project(graph, walk(graph), checked, []));
    text = chartText(chart);
  } catch (e) {
    if (!(e instanceof Error)) throw e;
    if (/^The view\x27s (state|step)\(\) returned /.test(e.message))
      return { refused: true, problems: [] };
    return { problems: [`skill-throws: ${e.constructor.name}: ${e.message}`] };
  }
  const want = expected(chart);
  const mermaidProblems = await readMermaid(text, want, tools);
  return { text, problems: [...mermaidProblems, ...readPele(text, want, tools.render)] };
}

const kind = (problem: string) => problem.slice(0, problem.indexOf(":"));

const sameKind = (problems: string[], first: string) => problems.some((p) => kind(p) === first);

async function shrink(c: Case, first: string, tools: Tools) {
  let labels = c.labels;
  for (let j = 0; j < labels.length; j++) {
    const plain = labels.with(j, `n${j}`);
    const again = await check(c, plain, tools);
    if (sameKind(again.problems, first)) labels = plain;
  }
  return labels;
}

export async function fuzz({
  seed,
  charts,
  ...tools
}: { seed: number; charts: number } & Tools): Promise<{
  drawn: number;
  refused: number;
  failure?: string;
}> {
  await tools.mermaid.parse("stateDiagram-v2\n  s0: a");
  const r = random(seed);
  let drawn = 0;
  let refused = 0;
  for (let i = 1; i <= charts; i++) {
    const c = generate(r);
    const result = await check(c, c.labels, tools);
    if (result.refused) refused++;
    else drawn++;
    if (!result.problems.length) continue;
    const labels = await shrink(c, kind(result.problems[0]), tools);
    const kept = labels.filter((label, j) => label !== `n${j}`);
    const last = await check(c, labels, tools);
    const colors = c.colors ? ` and the colors ${JSON.stringify(c.colors)}` : "";
    return {
      drawn,
      refused,
      failure: [
        `Chart ${i} of seed ${seed} goes wrong with the labels ${JSON.stringify(kept)}${colors}:`,
        ...last.problems,
        "",
        last.text ?? "",
      ].join("\n"),
    };
  }
  return { drawn, refused };
}
