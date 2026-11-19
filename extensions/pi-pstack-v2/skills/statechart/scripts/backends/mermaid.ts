import { byText, type Chart, type ChartState, type Region, tupleKey } from "../ir.ts";
import { code, esc } from "./mermaid-escape.ts";

const or = (names: Iterable<string>) => [...names].toSorted(byText).join(" or ");

type Edge = { from: string[]; start: boolean; to: string[]; label: string | undefined };

const within = (parent: string[], path: string[]) =>
  path.length >= parent.length && parent.every((p, i) => path[i] === p);
const wayIn = (e: Edge) => tupleKey([e.start, e.from]);

const foldInto = (edges: Edge[], parent: string[]): Edge[] => {
  const into = edges.filter(
    (e) => e.to.length > parent.length && within(parent, e.to) && !within(parent, e.from),
  );
  if (!into.length || into.some((e) => wayIn(e) !== wayIn(into[0]))) return edges;
  const one = into.length === 1;
  const at = edges.indexOf(into[0]);
  const rest = edges.filter((e) => !into.includes(e));
  return [
    ...rest.slice(0, at),
    { ...into[0], to: parent, label: one ? into[0].label : undefined },
    ...into.map((e) => ({
      from: parent,
      start: true,
      to: e.to,
      label: one ? undefined : e.label,
    })),
    ...rest.slice(at),
  ];
};

const parentPaths = (r: Region) => {
  const parents = new Map(
    r.states.flatMap((s) =>
      Array.from({ length: Math.max(s.path.length - 1, 0) }, (_, k) => {
        const prefix = s.path.slice(0, k + 1);
        return [tupleKey(prefix), prefix] as const;
      }),
    ),
  );
  return [...parents.values()].toSorted((a, b) => a.length - b.length);
};

export function drawnEdges(r: Region): Edge[] {
  const starts: Edge[] = r.states
    .filter((s) => s.start)
    .map((s) => ({ from: [], start: true, to: s.path, label: undefined }));
  const steps: Edge[] = r.steps.map((s) => ({
    from: s.from,
    start: false,
    to: s.to,
    label: s.label + (s.when ? ` [${s.when}]` : ""),
  }));
  return parentPaths(r).reduce(foldInto, [...starts, ...steps]);
}

const MARK_STYLES = {
  breaks: "fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834",
  mayBreak: "fill:#fff3e6,stroke:#e8730c,stroke-width:2.5px,color:#b85a06",
};

type MarkKind = keyof typeof MARK_STYLES;

type Piece = {
  lines: string[];
  classes: { sid: string; cls: string }[];
  broken: { kind: MarkKind; names: string[] }[];
};

const NO_PIECE: Piece = { lines: [], classes: [], broken: [] };

const joinPieces = (pieces: Piece[]): Piece => ({
  lines: pieces.flatMap((p) => p.lines),
  classes: pieces.flatMap((p) => p.classes),
  broken: pieces.flatMap((p) => p.broken),
});

const markOf = (leaf: ChartState): MarkKind | undefined => {
  if (!leaf.breaks.length || leaf.works) return undefined;
  return leaf.breaks.some((b) => b.always) ? "breaks" : "mayBreak";
};

const idSerial = function* () {
  for (let n = 0; ; n++) yield `s${n}`;
};

type Ids = { id: (path: string[]) => string; idOf: (path: string[]) => string };

const makeIds = (serial: Iterator<string>): Ids => {
  const topIds = new Map<string, string>();
  const nestedIds = new Map<string, string>();
  const known = new Map<string[], string>();
  const id = (path: string[]) => {
    const top = path.length === 1;
    const named = top ? topIds : nestedIds;
    const k = top ? path[0] : tupleKey(path);
    const found = named.get(k) ?? String(serial.next().value);
    named.set(k, found);
    return found;
  };
  const idOf = (path: string[]) => {
    const found = known.get(path) ?? id(path);
    known.set(path, found);
    return found;
  };
  return { id, idOf };
};

type Drawing = { chart: Chart; drawn: Edge[]; ids: Ids };

const edgeLine = ({ ids }: Drawing, e: Edge, indent: string) => {
  const from = e.start ? "[*]" : ids.idOf(e.from);
  const label = e.label === undefined ? "" : `: ${esc(e.label)}`;
  return `${indent}${from} --> ${ids.idOf(e.to)}${label}`;
};

const leafPiece = (d: Drawing, leaf: ChartState, head: string, indent: string): Piece => {
  const sid = d.ids.idOf(leaf.path);
  const mark = markOf(leaf);
  const color = leaf.group === undefined ? undefined : d.chart.colors[String(leaf.group)];
  const classes = [color, mark, leaf.lead && "bugPath", leaf.repeats && "repeats"].filter(
    (cls): cls is string => !!cls,
  );
  return {
    lines: [`${indent}${sid}: ${esc(head)}`],
    classes: classes.map((cls) => ({ sid, cls })),
    broken: mark ? [{ kind: mark, names: leaf.breaks.map((b) => b.rule.name) }] : [],
  };
};

const treePiece = (d: Drawing, prefix: string[], indent: string, below: ChartState[]): Piece =>
  joinPieces(
    [...Map.groupBy(below, (s) => s.path[prefix.length])].map(([head, under]) =>
      headPiece(d, [...prefix, head], indent, under),
    ),
  );

const headPiece = (d: Drawing, path: string[], indent: string, under: ChartState[]): Piece => {
  const head = path[path.length - 1];
  const inner = under.filter((s) => s.path.length > path.length);
  if (!inner.length) {
    const leaf = under.findLast((s) => s.path.length <= path.length);
    return leaf ? leafPiece(d, leaf, head, indent) : NO_PIECE;
  }
  const open = `${indent}state "${esc(head, true)}" as ${d.ids.id(path)} {`;
  const children = treePiece(d, path, `${indent}  `, inner);
  const key = tupleKey(path);
  const starts = d.drawn
    .filter((e) => e.start && tupleKey(e.from) === key)
    .map((e) => edgeLine(d, e, `${indent}  `));
  return { ...children, lines: [open, ...children.lines, ...starts, `${indent}}`] };
};

const regionPiece = (chart: Chart, serial: Iterator<string>, r: Region): Piece => {
  const d = { chart, drawn: drawnEdges(r), ids: makeIds(serial) };
  const tree = treePiece(d, [], "  ", r.states);
  const arrows = d.drawn.filter((e) => !e.start || !e.from.length).map((e) => edgeLine(d, e, "  "));
  return { ...tree, lines: [...tree.lines, ...arrows] };
};

const indented = (p: Piece, pad: string): Piece => ({ ...p, lines: p.lines.map((l) => pad + l) });

const bodyPiece = (chart: Chart, serial: Iterator<string>): Piece => {
  if (chart.regions.length <= 1) return regionPiece(chart, serial, chart.regions[0]);
  const regions = chart.regions.map((r, i) => {
    const inner = indented(regionPiece(chart, serial, r), "    ");
    return {
      ...inner,
      lines: [
        ...(i ? ["    --"] : []),
        `    state "${esc(r.name, true)}" as r${i} {`,
        ...inner.lines,
        "    }",
      ],
    };
  });
  const all = joinPieces(regions);
  return { ...all, lines: [`  state "At the same time" as all {`, ...all.lines, "  }"] };
};

const legendEntries = (chart: Chart, rules: Record<MarkKind, Set<string>>, used: Set<string>) =>
  [
    ...Object.entries(chart.colors),
    [`Breaks ${or(rules.breaks)}`, "breaks"],
    [`Breaks ${or(rules.mayBreak)} in some cases`, "mayBreak"],
    [`Path to the ${or(chart.paths)} bug`, "bugPath"],
    [`Repeats forever, so ${or(chart.loops)} breaks`, "repeats"],
  ].filter((entry) => used.has(entry[1]));

const legendLines = (legend: string[][]) =>
  legend.length
    ? [
        `  state "Legend" as legend {`,
        ...legend.map(([text], i) => `    lg${i}: ${esc(text)}`),
        "  }",
        ...legend.map(([, cls], i) => `  class lg${i} ${cls}`),
      ]
    : [];

const titleLines = (chart: Chart) => {
  const title = chart.title && code(chart.title, (n) => `ﬂ°°${n}¶ß`).replaceAll("<", "ﬂ°°60¶ß");
  return title ? ["---", `title: ${JSON.stringify(title)}`, "---"] : [];
};

const rulesOf = (broken: Piece["broken"]): Record<MarkKind, Set<string>> => ({
  breaks: new Set(broken.filter((b) => b.kind === "breaks").flatMap((b) => b.names)),
  mayBreak: new Set(broken.filter((b) => b.kind === "mayBreak").flatMap((b) => b.names)),
});

export function mermaidLines(chart: Chart) {
  const body = bodyPiece(chart, idSerial());
  const used = new Set(body.classes.map((m) => m.cls));
  const legend = legendEntries(chart, rulesOf(body.broken), used);
  return [
    ...titleLines(chart),
    "stateDiagram-v2",
    ...(chart.regions.length > 1 ? ["  direction LR"] : []),
    ...legendLines(legend),
    ...body.lines,
    ...Object.entries(MARK_STYLES)
      .filter(([cls]) => used.has(cls))
      .map(([cls, style]) => `  classDef ${cls} ${style}`),
    ...body.classes.map(({ sid, cls }) => `  class ${sid} ${cls}`),
  ];
}

export const mermaid = (chart: Chart) => mermaidLines(chart).join("\n");
