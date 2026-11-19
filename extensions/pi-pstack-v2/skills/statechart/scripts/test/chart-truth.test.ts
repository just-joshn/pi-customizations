import assert from "node:assert/strict";
import { test } from "node:test";
import { type Graph, type Vars, type View } from "../ir.ts";
import { drawn } from "./drawn.ts";
import { graphOf, draw, marked, type StateRow, type StepRow } from "./chart-support.ts";


const ab: View = { state: (v) => ({ A: `a${v.a}`, B: `b${v.b}` }) };
const bit = (v: Vars) => `${v.a}${v.b}${v.c}`;
const xorVars = [0, 1].flatMap((a) => [0, 1].flatMap((b) => [0, 1].map((c) => ({ a, b, c }))));
const xorStates: StateRow[] = xorVars.map((v) => [bit(v), v, v.a === 0]);
const xorSteps: StepRow[] = xorVars.flatMap((v): StepRow[] => [
  ...(v.a === 0 && v.b !== v.c ? [[bit(v), bit({ ...v, a: 1 }), "Go"] as StepRow] : []),
  ...(v.b === 0 ? [[bit(v), bit({ ...v, b: 1 }), "FlipB"] as StepRow] : []),
  ...(v.c === 0 ? [[bit(v), bit({ ...v, c: 1 }), "FlipC"] as StepRow] : []),
]);
const truthGraphs: { [name: string]: [Graph, View] } = {
  starts: [
    graphOf(
      [
        ["x0y0", { x: 0, y: 0 }, true],
        ["x1y1", { x: 1, y: 1 }, true],
        ["x1y0", { x: 1, y: 0 }],
      ],
      [["x0y0", "x1y0", "Step"]],
    ),
    { state: (v) => ({ X: `x${v.x}`, Y: `y${v.y}` }) },
  ],
  xor: [
    graphOf(xorStates, xorSteps),
    { state: (v) => ({ A: `a${v.a}`, B: `b${v.b}`, C: `c${v.c}` }) },
  ],
  fork: [
    graphOf(
      [
        ["a0b0", { a: 0, b: 0 }, true],
        ["a1b1", { a: 1, b: 1 }],
        ["a2b2", { a: 2, b: 2 }],
      ],
      [
        ["a0b0", "a1b1", "Sync"],
        ["a0b0", "a2b2", "Sync"],
      ],
    ),
    ab,
  ],
  partial: [
    graphOf(
      [
        ["a0b0", { a: 0, b: 0 }, true],
        ["a1b1", { a: 1, b: 1 }],
        ["a1b0", { a: 1, b: 0 }],
      ],
      [
        ["a0b0", "a1b1", "Act"],
        ["a0b0", "a1b0", "Act"],
      ],
    ),
    ab,
  ],
  lockstep: [
    graphOf(
      [
        ["a0b0", { a: 0, b: 0 }, true],
        ["a1b1", { a: 1, b: 1 }],
      ],
      [["a0b0", "a1b1", "Act"]],
    ),
    ab,
  ],
  interleaved: [
    graphOf(
      [
        ["a0b0", { a: 0, b: 0 }, true],
        ["a1b0", { a: 1, b: 0 }],
        ["a0b1", { a: 0, b: 1 }],
        ["a1b1", { a: 1, b: 1 }],
      ],
      [
        ["a0b0", "a1b0", "Act"],
        ["a0b0", "a0b1", "Act"],
        ["a1b0", "a1b1", "Act"],
        ["a0b1", "a1b1", "Act"],
      ],
    ),
    ab,
  ],
};

for (const [name, regions] of [
  ["starts", false],
  ["xor", false],
  ["fork", false],
  ["partial", false],
  ["lockstep", true],
  ["interleaved", true],
] satisfies [string, boolean][]) {
  test(`${name}: the chart uses regions only when they show the model's moves exactly`, () => {
    const { chart, report: text } = draw(...truthGraphs[name]);
    assert.equal(chart.includes('state "At the same time"'), regions);
    assert.equal(/So the chart draws parent states in place of regions\.$/m.test(text), !regions);
  });
}

test("the report says why regions cannot show a shared step that forks", () => {
  assert.match(
    draw(...truthGraphs.fork).report,
    /^The regions chart lets A a0, B b0 go to A a1, B b2 by Sync, which the model never does\./m,
  );
});

const forkToBug = graphOf(
  [
    ["a0b0", { a: 0, b: 0 }, true],
    ["a1b1", { a: 1, b: 1 }],
    ["a2b2", { a: 2, b: 2 }, false, ["Safe"]],
  ],
  [
    ["a0b0", "a1b1", "Sync"],
    ["a0b0", "a2b2", "Sync"],
  ],
);

test("a chart that draws parent states in place of regions still names each region in a bug path", () => {
  const { chart, report: text } = draw(forkToBug, ab);
  assert.match(chart, /^ {2}state "A a2" as s\d+ \{$/m);
  assert.match(text, /^0\. A a0, B b0\n1\. Sync: A a2, B b2$/m);
});

test("the view answers once for each state and step, so a chart of parent states agrees with its report", () => {
  const asked: { [question: string]: number } = {};
  const answer = (question: string) => {
    asked[question] = (asked[question] ?? 0) + 1;
    return asked[question] === 1 ? "first" : "later";
  };
  const { chart, report: text } = draw(forkToBug, {
    state: (v) => {
      const word = answer(`state ${v.a}`);
      return { A: `a${v.a} ${word}`, B: `b${v.b}` };
    },
    step: (action, from, to) => `${action} ${answer(`step ${from.a} to ${to.a}`)}`,
    group: (v) => (answer(`group ${v.a}`) === "first" ? "Calm" : "Busy"),
    colors: { Calm: "blue", Busy: "orange" },
  });
  assert.match(chart, /^ {2}state "A a2 first" as s\d+ \{$/m);
  assert.doesNotMatch(chart, /later|orange/);
  assert.match(text, /^0\. A a0 first, B b0\n1\. Sync first: A a2 first, B b2$/m);
  assert.deepEqual(asked, {
    "state 0": 1,
    "state 1": 1,
    "state 2": 1,
    "step 0 to 1": 1,
    "step 0 to 2": 1,
    "group 0": 1,
    "group 1": 1,
    "group 2": 1,
  });
});

test("a region state is marked when every combination with it can break a rule", () => {
  const graph = graphOf(
    [
      ["a0b0", { a: 0, b: 0 }, true],
      ["a1b0", { a: 1, b: 0 }],
      ["a2b0", { a: 2, b: 0 }, false, ["Safe"]],
      ["a2b1", { a: 2, b: 1 }, false, ["Safe"]],
      ["a0b1", { a: 0, b: 1 }],
    ],
    [
      ["a0b0", "a1b0", "Go"],
      ["a1b0", "a2b0", "Go"],
      ["a2b0", "a2b1", "Flip"],
      ["a0b0", "a0b1", "Flip"],
    ],
  );
  assert.deepEqual(marked(draw(graph, ab).chart), { a2: "breaks" });
});

test("a combination that breaks a rule marks its states when no state of it has a mark", () => {
  const graph = graphOf(
    [
      ["a0b0", { a: 0, b: 0 }, true],
      ["a1b0", { a: 1, b: 0 }],
      ["a0b1", { a: 0, b: 1 }],
      ["a1b1", { a: 1, b: 1 }, false, ["Safe"]],
    ],
    [
      ["a0b0", "a1b0", "GoA"],
      ["a0b0", "a0b1", "GoB"],
      ["a1b0", "a1b1", "GoB"],
      ["a0b1", "a1b1", "GoA"],
    ],
  );
  assert.deepEqual(marked(draw(graph, ab).chart), { a1: "mayBreak", b1: "mayBreak" });
});

test("a bug-path step that stays in one state is a loop in a flat chart only", () => {
  const graph = graphOf(
    [
      ["s0", { x: 0, y: 0 }, true],
      ["s1", { x: 0, y: 1 }, false, ["Safe"]],
      ["s2", { x: 1, y: 0 }],
    ],
    [
      ["s0", "s1", "Tick"],
      ["s0", "s2", "Move"],
    ],
  );
  const flat = draw(graph, { state: (v) => `x${v.x}` });
  assert.match(flat.chart, /^ {2}(s\d+) --> \1: Tick$/m);
  assert.doesNotMatch(flat.report, /does not draw/);
  const regions = draw(graph, { state: (v) => ({ X: `x${v.x}`, Z: "z" }) });
  assert.doesNotMatch(regions.chart, /Tick/);
  assert.match(regions.report, /^The chart does not draw 1 steps that stay in one chart state\.$/m);
});

test("a step that leaves every child of a parent the same way is one arrow from the parent", () => {
  const graph = graphOf(
    [
      ["x", { at: "Open.x" }, true],
      ["y", { at: "Open.y" }],
      ["done", { at: "Closed" }],
    ],
    [
      ["x", "y", "Next"],
      ["x", "done", "Quit"],
      ["y", "done", "Quit"],
    ],
  );
  const { chart } = draw(graph, { state: (v) => String(v.at).split(".") });
  const open = chart.match(/^ {2}state "Open" as (s\d+) \{$/m)?.[1];
  const closed = chart.match(/^ {2}(s\d+): Closed$/m)?.[1];
  const quits = [...chart.matchAll(/^ {2}(s\d+) --> (s\d+): Quit$/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(quits, [[open, closed]]);
});

test("a parent's only way in ends at the parent, and its start marker goes on to each state with that step's label", () => {
  const graph = graphOf(
    [
      ["ask", { at: "Asking" }, true],
      ["flat", { at: "Layout.Flat" }],
      ["parents", { at: "Layout.Parents" }],
      ["drawn", { at: "Done.Drawn" }],
    ],
    [
      ["ask", "flat", "String"],
      ["ask", "parents", "Array"],
      ["flat", "drawn", "Draw"],
    ],
  );
  const { chart } = draw(graph, { state: (v) => String(v.at).split(".") });
  assert.deepEqual(drawn(chart).arrows.toSorted(), [
    "Asking --> Layout",
    "Done start --> Drawn",
    "Flat --> Done: Draw",
    "Layout start --> Flat: String",
    "Layout start --> Parents: Array",
  ]);
});

test("a parent that two states lead into keeps an arrow from each, since one start marker cannot say where each came from", () => {
  const graph = graphOf(
    [
      ["a", { at: "A" }, true],
      ["b", { at: "B" }],
      ["p", { at: "P.p" }],
      ["q", { at: "P.q" }],
    ],
    [
      ["a", "b", "Go"],
      ["a", "p", "Left"],
      ["b", "q", "Right"],
    ],
  );
  const { chart } = draw(graph, { state: (v) => String(v.at).split(".") });
  assert.deepEqual(drawn(chart).arrows.toSorted(), ["A --> B: Go", "A --> p: Left", "B --> q: Right"]);
});
