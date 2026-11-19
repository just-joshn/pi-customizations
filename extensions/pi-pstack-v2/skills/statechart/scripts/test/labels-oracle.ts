import { drawnEdges } from "../backends/mermaid.ts";
import { z } from "zod";
import type { Chart, ChartState, Region } from "../ir.ts";

export type Render = (text: string) => { svg: string };

export type MermaidNode = {
  id: string;
  label?: string;
  shape?: string;
  parentId?: string;
  isGroup?: boolean;
  dir?: string;
};

type MermaidData = {
  nodes: MermaidNode[];
  edges: { start: string; end: string; label?: string }[];
  direction?: string;
};

type MermaidDiagram = { db: { getData: () => MermaidData } };

export type Mermaid = {
  parse: (text: string) => Promise<unknown>;
  mermaidAPI: { getDiagramFromText: (text: string) => Promise<MermaidDiagram> };
};

export type Html = (markup: string) => string;

export type Tools = { render: Render; mermaid: Mermaid; html: Html };

export const visible = (s: string) =>
  s
    .toWellFormed()
    .replace(/(?![\t-\r\x85])[\p{Cc}\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu, "")
    .replace(/\p{White_Space}+/gu, " ")
    .trim();
const wrapped = (s: string) => visible(s).replaceAll(" ", "");
export const titled = (want: Want) => /[^\0\x80-\x84\x86-\x9f]/.test(want.title ?? "");
const NAMED: { [name: string]: string } = {
  quot: '"',
  lt: "<",
  gt: ">",
  amp: "&",
  apos: "'",
  nbsp: "\u00a0",
};
const WINDOWS_1252 = "€\x81‚ƒ„…†‡ˆ‰Š‹Œ\x8dŽ\x8f\x90‘’“”•–—˜™š›œ\x9džŸ";
const MAX_CODE_POINT = 0x10ffff;
const SURROGATE_FIRST = 0xd800;
const SURROGATE_LAST = 0xdfff;
const C1_FIRST = 0x80;
const C1_LAST = 0x9f;
const fromRef = (n: number) => {
  if (n === 0 || n > MAX_CODE_POINT || (n >= SURROGATE_FIRST && n <= SURROGATE_LAST)) return "\ufffd";
  if (n >= C1_FIRST && n <= C1_LAST) return WINDOWS_1252[n - C1_FIRST];
  return String.fromCodePoint(n);
};
const fromMermaid = (s: string) =>
  s.replace(/ﬂ°°(\d+)¶ß|ﬂ°(\w+)¶ß/g, (_, d, n) =>
    d ? fromRef(Number(d)) : (NAMED[n] ?? `&${n};`),
  );
const decoded = (s: string) =>
  s
    .replace(/ﬂ°°/g, "&#")
    .replace(/ﬂ°/g, "&")
    .replace(/¶ß/g, ";");
const MARKER_END = /marker-end=\x22url\([\d+./:=?A-Za-z-]*?#/g;
const rewritten = (s: string) =>
  /ﬂ°|¶ß/.test(s) || s.replace(MARKER_END, 'marker-end="url(#') !== s;
const fromSvg = (s: string) =>
  s
    .replace(/<\/tspan>\s*<tspan[^>]*>/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => fromRef(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => fromRef(Number(d)))
    .replace(/&(quot|lt|gt|apos|nbsp);/g, (_, n) => NAMED[n])
    .replace(/&amp;/g, "&");

type Node = { text: string; parent: string | null; group: boolean };

export type Want = {
  nodes: Map<string, Node>;
  edges: string[][];
  direction: string;
  title: string | undefined;
};

type Ids = (region: string, path: string[]) => string;

const idAllocator = (): Ids => {
  let ids = new Map<string, string>();
  return (region, path) => {
    const key = JSON.stringify([region, path]);
    const found = ids.get(key) ?? `s${ids.size}`;
    ids = new Map([...ids, [key, found]]);
    return found;
  };
};

type Walk = {
  id: Ids;
  chart: Chart;
  region: Region;
  drawn: ReturnType<typeof drawnEdges>;
};

type Walked = { nodes: [string, Node][]; edges: string[][]; used: string[] };

const groupByHead = (below: ChartState[], depth: number) =>
  Map.groupBy(below, (s) => s.path[depth]);

const startEdges = (w: Walk, path: string[], node: string) => {
  const key = JSON.stringify(path);
  return w.drawn
    .filter((e) => e.start && JSON.stringify(e.from) === key)
    .map((e) => [`${node}_start`, w.id(w.region.name, e.to), e.label ?? ""]);
};

const treeEdges = (
  w: Walk,
  prefix: string[],
  parent: string | null,
  below: ChartState[],
): Walked => {
  const parts = [...groupByHead(below, prefix.length)].map(([head, under]): Walked => {
    const path = [...prefix, head];
    const inner = under.filter((s) => s.path.length > path.length);
    const leaf = under.findLast((s) => s.path.length <= path.length);
    const node = w.id(w.region.name, path);
    const self: [string, Node] = [node, { text: head, parent, group: inner.length > 0 }];
    if (inner.length) {
      const nested = treeEdges(w, path, node, inner);
      return {
        nodes: [self, ...nested.nodes],
        edges: [...nested.edges, ...startEdges(w, path, node)],
        used: nested.used,
      };
    }
    const used = leaf?.group !== undefined ? [w.chart.colors[String(leaf.group)]] : [];
    return { nodes: [self], edges: [], used };
  });
  return {
    nodes: parts.flatMap((p) => p.nodes),
    edges: parts.flatMap((p) => p.edges),
    used: parts.flatMap((p) => p.used),
  };
};

const regionEdges = (w: Walk, wrap: string | null): Walked => {
  const nested = treeEdges(w, [], wrap, w.region.states);
  const top = w.drawn
    .filter((e) => !e.start || !e.from.length)
    .map((e) => [
      e.start ? `${wrap ?? "root"}_start` : w.id(w.region.name, e.from),
      w.id(w.region.name, e.to),
      e.label ?? "",
    ]);
  return { ...nested, edges: [...nested.edges, ...top] };
};

export function expected(chart: Chart): Want {
  const id = idAllocator();
  const multi = chart.regions.length > 1;
  const allNode: [string, Node][] = multi
    ? [["all", { text: "At the same time", parent: null, group: true }]]
    : [];
  const walks = chart.regions.map((region, i): Walked => {
    const wrap = multi ? `r${i}` : null;
    const wrapNode: [string, Node][] = wrap
      ? [[wrap, { text: region.name, parent: "all", group: true }]]
      : [];
    const walked = regionEdges({ id, chart, region, drawn: drawnEdges(region) }, wrap);
    return { ...walked, nodes: [...wrapNode, ...walked.nodes] };
  });
  const used = new Set(walks.flatMap((x) => x.used));
  const legend = Object.entries(chart.colors).filter(([, cls]) => used.has(cls));
  const legendNodes = legend.map(([text], n): [string, Node] => [
    `lg${n}`,
    { text, parent: "legend", group: false },
  ]);
  const legendRoot: [string, Node][] = legend.length
    ? [["legend", { text: "Legend", parent: null, group: true }]]
    : [];
  const nodes = new Map([...allNode, ...walks.flatMap((x) => x.nodes), ...legendNodes, ...legendRoot]);
  const edges = walks.flatMap((x) => x.edges);
  return { nodes, edges, direction: multi ? "LR" : "TB", title: chart.title };
}

const edgeKeys = (edges: string[][], withLabels: boolean) =>
  edges
    .map(([from, to, text]) => (withLabels ? `${from} ${to} ${visible(text)}` : `${from} ${to}`))
    .toSorted()
    .join("\n");

const firstLine = (e: Error) => e.message.split("\n")[0];

const IGNORED_SHAPES = ["divider", "stateStart", "stateEnd"];

const mermaidNodeProblems = (
  n: MermaidNode,
  want: Want,
  byId: Map<string | undefined, MermaidNode>,
  html: Html,
): string[] => {
  const parentOf = (node: MermaidNode): MermaidNode | undefined => {
    const parent = byId.get(node.parentId);
    return parent?.shape === "divider" ? parentOf(parent) : parent;
  };
  const parent = parentOf(n);
  const w = want.nodes.get(n.id);
  const shown = fromMermaid(n.label ?? "");
  const drawnText = () => html(decoded(n.label ?? ""));
  const direction =
    n.isGroup && n.dir && n.dir !== "TB" ? [`mermaid-direction: ${n.id} runs ${n.dir}`] : [];
  if (!w || (parent?.id ?? null) !== w.parent || Boolean(n.isGroup) !== w.group)
    return [`mermaid-nodes: Mermaid draws ${n.id} where the chart has no such node`, ...direction];
  if (rewritten(shown))
    return [
      `mermaid-text: Mermaid's SVG cleanup rewrites ${n.id}'s ${JSON.stringify(shown)}`,
      ...direction,
    ];
  if (visible(drawnText()) !== visible(w.text))
    return [
      `mermaid-text: ${n.id} shows ${JSON.stringify(drawnText())} for ${JSON.stringify(w.text)}`,
      ...direction,
    ];
  return direction;
};

const mermaidTitleProblems = (text: string, want: Want): string[] => {
  const head = text.match(/^---\ntitle: (.*)\n---\n/);
  const raw = head ? z.coerce.string().parse(JSON.parse(head[1])) : undefined;
  const title = raw === undefined ? undefined : fromMermaid(raw);
  const wanted = JSON.stringify(want.title);
  if ((title !== undefined) !== titled(want))
    return [`mermaid-title: Mermaid draws a title for ${wanted}`];
  if (raw?.includes("<"))
    return [`mermaid-title: Mermaid's sanitizer reads the < in ${JSON.stringify(raw)} as a tag`];
  if (title?.includes("\0"))
    return [`mermaid-title: a browser draws the NUL in ${JSON.stringify(title)} as U+FFFD`];
  if (title !== undefined && visible(title) !== visible(want.title ?? ""))
    return [`mermaid-text: the title shows ${JSON.stringify(title)} for ${wanted}`];
  return [];
};

const mermaidEdgeProblems = (data: MermaidData, want: Want, html: Html): string[] => {
  const got = data.edges.map((e) => [e.start, e.end, fromMermaid(e.label ?? "")]);
  const shown = data.edges.map((e) => [e.start, e.end, html(decoded(e.label ?? ""))]);
  const joined =
    edgeKeys(got, false) !== edgeKeys(want.edges, false)
      ? ["mermaid-edges: the arrows join other states"]
      : edgeKeys(shown, true) !== edgeKeys(want.edges, true)
        ? ["mermaid-text: an arrow shows other text"]
        : [];
  const rewrites = got
    .filter(([, , text]) => rewritten(text))
    .map(
      ([from, to, text]) =>
        `mermaid-text: Mermaid's SVG cleanup rewrites the arrow from ${from} to ${to}'s ${JSON.stringify(text)}`,
    );
  return [...joined, ...rewrites];
};

export async function readMermaid(
  text: string,
  want: Want,
  { mermaid, html }: Tools,
): Promise<string[]> {
  let data: MermaidData;
  try {
    data = (await mermaid.mermaidAPI.getDiagramFromText(text)).db.getData();
  } catch (e) {
    if (!(e instanceof Error)) throw e;
    return [`mermaid-refuses: ${firstLine(e)}`];
  }
  const byId = new Map<string | undefined, MermaidNode>(data.nodes.map((n) => [n.id, n]));
  const nodes = data.nodes.filter((n) => !IGNORED_SHAPES.includes(n.shape ?? ""));
  const count =
    nodes.length === want.nodes.size
      ? []
      : [`mermaid-nodes: ${nodes.length} nodes for ${want.nodes.size}`];
  const direction =
    (data.direction ?? "TB") === want.direction
      ? []
      : [`mermaid-direction: the chart runs ${data.direction}`];
  return [
    ...nodes.flatMap((n) => mermaidNodeProblems(n, want, byId, html)),
    ...count,
    ...direction,
    ...mermaidTitleProblems(text, want),
    ...mermaidEdgeProblems(data, want, html),
  ];
};

const peleNodes = (svg: string) =>
  new Map<string, string>(
    [
      ...svg.matchAll(
        /<g class="pele-(?:node|cluster) ([^"]*)" data-id="([^"]*)"[^>]*>([\s\S]*?)<\/g>/g,
      ),
    ]
      .filter((m) => !/state-(start|end)/.test(m[1]))
      .map((m) => {
        const t = m[3].match(/<text[^>]*>([\s\S]*?)<\/text>/);
        return [m[2], t ? fromSvg(t[1]) : ""];
      }),
  );

const peleNodeProblems = (svg: string, want: Want): string[] => {
  const drawn = peleNodes(svg);
  const count =
    drawn.size === want.nodes.size ? [] : [`pele-nodes: ${drawn.size} nodes for ${want.nodes.size}`];
  const texts = [...want.nodes].flatMap(([node, w]) => {
    const shown = drawn.get(node);
    if (shown === undefined) return [`pele-nodes: Pele draws no ${node}`];
    if (wrapped(shown) === wrapped(w.text)) return [];
    return [`pele-text: ${node} shows ${JSON.stringify(shown)} for ${JSON.stringify(w.text)}`];
  });
  return [...count, ...texts];
};

const peleEdgeProblems = (svg: string, want: Want): string[] => {
  const arrows = [...svg.matchAll(/<g class="pele-edge pele-transition"/g)].length;
  const count =
    arrows === want.edges.length ? [] : [`pele-edges: ${arrows} arrows for ${want.edges.length}`];
  const labels = [
    ...svg.matchAll(
      /<g class="pele-edge-label" data-id="edge(\d+)"[^>]*>[\s\S]*?<text[^>]*>([\s\S]*?)<\/text>/g,
    ),
  ].flatMap((m) => {
    const w = want.edges[Number(m[1])];
    if (!w) return [`pele-edges: Pele labels edge${m[1]}, which the chart does not have`];
    if (wrapped(fromSvg(m[2])) === wrapped(w[2])) return [];
    return [`pele-text: edge${m[1]} shows ${JSON.stringify(fromSvg(m[2]))} for ${JSON.stringify(w[2])}`];
  });
  return [...count, ...labels];
};

const peleTitleProblems = (svg: string, want: Want): string[] => {
  const title = svg.match(/<text class="pele-title"[^>]*>([\s\S]*?)<\/text>/);
  if (Boolean(title) !== titled(want))
    return [`pele-title: Pele draws a title for ${JSON.stringify(want.title)}`];
  if (title && wrapped(fromSvg(title[1])) !== wrapped(want.title ?? ""))
    return [
      `pele-text: the title shows ${JSON.stringify(fromSvg(title[1]))} for ${JSON.stringify(want.title)}`,
    ];
  return [];
};

export function readPele(text: string, want: Want, render: Render): string[] {
  let svg: string;
  try {
    ({ svg } = render(text));
  } catch (e) {
    if (!(e instanceof Error)) throw e;
    return [`pele-refuses: ${firstLine(e)}`];
  }
  return [...peleNodeProblems(svg, want), ...peleEdgeProblems(svg, want), ...peleTitleProblems(svg, want)];
}
