import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { mermaid as chartText } from "../backends/mermaid.ts";
import type { Graph } from "../ir.ts";
import { walk } from "../passes/reach.ts";
import { project } from "../pipeline.ts";
import { fuzz, type Html, type Mermaid, type Render } from "./labels.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const charts = [
  ...fs.readdirSync(path.join(here, "charts")).map((f) => path.join(here, "charts", f)),
  ...fs.readdirSync(path.join(here, "corpus")).map((d) => path.join(here, "corpus", d, "chart.mmd")),
];
const guide = fs.readFileSync(path.join(here, "../../references/render.md"), "utf8");
const css = guide.match(/```css\n([\s\S]*?)```/);
assert.ok(css, "references/render.md has no css block");
const theme = css[1];
const cache = path.join(
  process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
  "statechart",
);
const install = (name: string, ...packages: string[]) => {
  const dir = path.join(cache, name);
  execFileSync(
    "npm",
    ["install", "--prefix", dir, "--no-audit", "--no-fund", "--save-exact", ...packages],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return createRequire(path.join(dir, "package.json"));
};

type Rejects<T> = (text: string) => Promise<T>;
type BrowserMermaid = {
  parse: Rejects<unknown>;
  mermaidAPI: { getDiagramFromText: Rejects<Awaited<ReturnType<Mermaid["mermaidAPI"]["getDiagramFromText"]>>> };
};

// Mermaid runs inside the jsdom window, so its errors are that window's Error.
// Rethrow them as this realm's Error so the oracle's `instanceof Error` sees them.
const inHostRealm = (browser: BrowserMermaid, BrowserError: ErrorConstructor): Mermaid => {
  const hosted =
    <T>(call: Rejects<T>): Rejects<T> =>
    async (text) => {
      try {
        return await call(text);
      } catch (error) {
        throw error instanceof BrowserError ? new Error(error.message) : error;
      }
    };
  return {
    parse: hosted((text) => browser.parse(text)),
    mermaidAPI: {
      getDiagramFromText: hosted((text) => browser.mermaidAPI.getDiagramFromText(text)),
    },
  };
};

let render: Render;
let mermaid: Mermaid;
let html: Html;
before(async () => {
  const pele = install("test-pele-1.9.0", "pele@1.9.0");
  ({ render } = await import(pathToFileURL(pele.resolve("pele")).href));

  const parser = install("test-mermaid-11.16.0", "mermaid@11.16.0", "jsdom@26.1.0");
  const { JSDOM } = parser("jsdom");
  const dom = new JSDOM("", { runScripts: "outside-only" });
  const bundle = fs.readFileSync(parser.resolve("mermaid/dist/mermaid.min.js"), "utf8");
  new vm.Script(bundle).runInContext(dom.getInternalVMContext());
  mermaid = inHostRealm(dom.window.mermaid, dom.window.Error);
  html = (markup) => JSDOM.fragment(markup).textContent ?? "";
});

const loaded = charts.map((chart) => {
  const text = fs.readFileSync(chart, "utf8");
  return {
    name: path.relative(here, chart),
    text,
    marks: [...text.matchAll(/^ {2}class (\w+) (\w+)$/gm)],
  };
});
const classes = new Set(loaded.flatMap(({ marks }) => marks.map(([, , mark]) => mark)));
for (const { name, text, marks } of loaded) {
  test(`${name} renders in Pele 1.9.0 with each class on its node`, () => {
    const { svg } = render(text);
    assert.match(svg, /^<svg /);
    for (const [, id, mark] of marks)
      assert.match(svg, new RegExp(`class="pele-node[^"]* ${mark}\\b[^"]*" data-id="${id}"`), id);
  });

  test(`${name} parses in mermaid.js, which chat views use`, async () => {
    await mermaid.parse(text);
  });
}

test("random labels and colors keep their text and the chart's shape in Mermaid and Pele", async () => {
  const { drawn, refused, failure } = await fuzz({ seed: 1, charts: 500, render, mermaid, html });
  if (failure) assert.fail(failure);
  assert.ok(drawn > MIN_DRAWN && refused > MIN_REFUSED, `${drawn} charts drawn, ${refused} refused`);
});

const MIN_DRAWN = 400;
const MIN_REFUSED = 20;
const CUBIC = 3;

type Point = readonly [number, number];
const SAMPLES = 64;

const bezier = (from: Point, n: readonly number[], t: number): Point => {
  const [ax, ay] = from;
  const u = 1 - t;
  const blend = (a: number, c1: number, c2: number, end: number) =>
    u ** CUBIC * a + CUBIC * u * u * t * c1 + CUBIC * u * t * t * c2 + t ** CUBIC * end;
  return [blend(ax, n[0], n[2], n[4]), blend(ay, n[1], n[3], n[5])];
};

const segmentPoints = (cmd: string, from: Point, n: readonly number[]): Point[] => {
  const [ax, ay] = from;
  const [x, y] = n.slice(-2);
  const ts = Array.from({ length: SAMPLES + 1 }, (_, i) => i / SAMPLES);
  if (cmd === "L") return ts.map((t) => [ax + (x - ax) * t, ay + (y - ay) * t]);
  return ts.map((t) => bezier(from, n, t));
};

const pathPoints = (d: string): Point[] => {
  const segments = [...d.matchAll(/([MLC])([^MLC]*)/g)].map(([, cmd, args]) => ({
    cmd,
    n: args.split(/[ ,]/).filter(Boolean).map(Number),
  }));
  return segments.reduce(
    (acc, { cmd, n }) => {
      const [x, y] = n.slice(-2);
      const points = cmd === "M" ? [] : segmentPoints(cmd, acc.at, n);
      return { at: [x, y] as Point, points: [...acc.points, ...points] };
    },
    { at: [0, 0] as Point, points: [] as Point[] },
  ).points;
};

const titleBars = (svg: string) =>
  [
    ...svg.matchAll(
      /<g class="pele-cluster [^"]*" data-id="([^"]*)"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"[^>]*\/><path d="M[\d.]+,([\d.]+)H/g,
    ),
  ].map(([, id, x, y, w, rule]) => ({ id, left: +x, right: +x + +w, top: +y, bottom: +rule }));

type Bar = ReturnType<typeof titleBars>[number];
const crosses = (d: string, bar: Bar) =>
  pathPoints(d).some(([x, y]) => x > bar.left && x < bar.right && y > bar.top && y < bar.bottom);

const barCrossings = (svg: string, bars: Bar[]) =>
  [
    ...svg.matchAll(
      /<g class="pele-edge pele-transition" data-id="([^"]*)"><path d="([^"]*)"/g,
    ),
  ].flatMap(([, id, d]) =>
    bars.filter((bar) => crosses(d, bar)).map((bar) => `${id} crosses the title bar of ${bar.id}`),
  );

const parentGraph = (): Graph => {
  const states = [
    ["ask", "Asking your view for labels"],
    ["flat", "Laying out the chart/Flat"],
    ["parents", "Laying out the chart/Parent states"],
    ["regions", "Laying out the chart/Regions"],
  ];
  const steps = [
    ["flat", "String"],
    ["parents", "Array"],
    ["regions", "Object"],
  ];
  return {
    states: new Map(
      states.map(([id, at]) => [id, { vars: { at }, start: id === "ask", breaks: [] }]),
    ),
    steps: steps.map(([to, action]) => ({ from: "ask", to, action })),
  };
};

test("an arrow into a parent from its only way in stays out of the parent's title bar in Pele 1.9.0", () => {
  const graph = parentGraph();
  const { chart } = project(graph, walk(graph), { state: (v) => String(v.at).split("/") }, []);
  const { svg } = render(chartText(chart));
  const bars = titleBars(svg);
  assert.equal(bars.length, 1);
  assert.deepEqual(barCrossings(svg, bars), []);
});

test("the theme in references/render.md colors each class that the charts use", () => {
  assert.ok(classes.size > 0);
  for (const name of classes) assert.match(theme, new RegExp(`\\.pele \\.${name} rect \\{`), name);
});
