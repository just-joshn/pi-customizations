import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { drawn } from "./drawn.ts";
import { copyCase, corpus, read, run, writeView } from "./cli-support.ts";


const byX = (labels: unknown[]) => `export const state = (v) => ${JSON.stringify(labels)}[v.x];\n`;

const fanOut = (n: number) => {
  const leaves = Array.from({ length: n }, (_, k) => [
    `${k + 1} [label="x = ${k + 1}"];`,
    `0 -> ${k + 1} [label="Inc",color="black",fontcolor="black"];`,
  ]).flat();
  return [
    "strict digraph DiskGraph {",
    '0 [label="x = 0",style = filled]',
    ...leaves,
    "}",
  ].join("\n");
};

const inventedMoveLabels = byX([
  { R: "f", S: "p" },
  { R: "a", S: "r" },
  { R: "b", S: "q" },
  { R: "X\u0003a", S: "q" },
  { R: "X\u0003b", S: "r" },
]);

test("a flat view names a label with U+0000 as written when a loop cannot take a step out of it", () => {
  const view = writeView(
    `export const state = (v) => (v.playback === "Stopped" || v.volume === "Muted" ? ${JSON.stringify("a\0b")} : v.playback);\n`,
  );
  const r = run(path.join(corpus, "MediaPlayerProps"), { view });
  assert.equal(r.status, 2);
  assert.equal(
    r.stderr,
    "The chart draws the step TheCallEnds out of a\0b, but the EventuallyPlays loop cannot take it there. Show in a label what stops it.\n",
  );
  assert.deepEqual(r.files, []);
});

for (const [what, c] of [
  [
    "a parent-state view keeps a label with U+0000 apart from the parent path it spells",
    {
      base: "Counter",
      view: byX([["a\0b"], ["a", "b"], ["c"], ["d"]]),
      status: 0,
      states: ["ab", "a", "b", "c", "d"],
      arrows: ["a start --> b", "ab --> a: Inc", "b --> c: Inc", "c --> d: Inc"],
      says: /^TLC reached 4 states and 3 steps\. The chart draws 4 states and 3 arrows\.$/m,
    },
  ],
  [
    "a regions view keeps a label with U+0000 apart from the parent path it spells, and the report names it as written",
    {
      base: "Counter",
      fanOut: 2,
      view: byX([
        { R: "f", S: "p" },
        { R: ["a\0b"], S: "q" },
        { R: ["a", "b"], S: "r" },
      ]),
      status: 0,
      states: ["R f", "S p", "R ab", "S q", "R a", "R b", "S r"],
      arrows: [
        "R f start --> S p",
        "R ab start --> S q",
        "R b start --> S r",
        "R a start --> R b",
        "S p --> R ab: Inc",
        "S p --> R a: Inc",
      ],
      says: /^The regions chart lets R f, S p go to R a\0b, S r by Inc, which the model never does\. So the chart draws parent states in place of regions\.$/m,
    },
  ],
  [
    "a flat view with U+0001 in a label draws each arrow between the states it joins",
    {
      base: "Counter",
      view: byX(["a\u0001b", "a", "b", "c"]),
      status: 0,
      states: ["a\u0001b", "a", "b", "c"],
      arrows: ["a\u0001b --> a: Inc", "a --> b: Inc", "b --> c: Inc"],
      says: /^TLC reached 4 states and 3 steps\. The chart draws 4 states and 3 arrows\.$/m,
    },
  ],
  [
    "a parent-state view with U+0001 in a label draws the chart",
    {
      base: "Counter",
      view: byX([["a\u0001b"], ["a", "b"], ["c"], ["d"]]),
      status: 0,
      states: ["a\u0001b", "a", "b", "c", "d"],
      arrows: ["a start --> b", "a\u0001b --> a: Inc", "b --> c: Inc", "c --> d: Inc"],
      says: /^TLC reached 4 states and 3 steps\. The chart draws 4 states and 3 arrows\.$/m,
    },
  ],
  [
    "a regions view with U+0001 in a label draws the chart",
    {
      base: "Counter",
      view: byX([
        { R: "a\u0001b", S: "p" },
        { R: "c", S: "p" },
        { R: "d", S: "p" },
        { R: "e", S: "p" },
      ]),
      status: 0,
      states: ["a\u0001b", "c", "d", "e", "p"],
      arrows: ["a\u0001b --> c: Inc", "c --> d: Inc", "d --> e: Inc"],
      says: /^TLC reached 4 states and 3 steps\. The chart draws 5 states and 3 arrows\.$/m,
    },
  ],
  [
    "a flat view reports a state with U+0002 in its label that breaks a rule",
    {
      base: "FirstRule",
      view: byX(["a", "b\u0002c", "d", "e"]),
      status: 1,
      states: ["a", "b\u0002c", "d", "e"],
      arrows: ["a --> b\u0002c: Next", "b\u0002c --> d: Next", "d --> e: Next"],
      says: /^## NotOne breaks\nThe shortest path has 1 step:\n0\. a\n1\. Next: b\cBc$/m,
    },
  ],
  [
    "a parent-state view reports a state with U+0002 in its label that breaks a rule",
    {
      base: "FirstRule",
      view: byX([["a"], ["P", "b\u0002c"], ["d"], ["e"]]),
      status: 1,
      states: ["a", "P", "b\u0002c", "d", "e"],
      arrows: ["P start --> b\u0002c", "a --> P: Next", "b\u0002c --> d: Next", "d --> e: Next"],
      says: /^## NotOne breaks\nThe shortest path has 1 step:\n0\. a\n1\. Next: P \/ b\cBc$/m,
    },
  ],
  [
    "a regions view reports a state with U+0002 in its label that breaks a rule",
    {
      base: "FirstRule",
      view: byX([
        { R: "a", S: "p" },
        { R: "b\u0002c", S: "p" },
        { R: "d", S: "p" },
        { R: "e", S: "p" },
      ]),
      status: 1,
      states: ["a", "b\u0002c", "d", "e", "p"],
      arrows: ["a --> b\u0002c: Next", "b\u0002c --> d: Next", "d --> e: Next"],
      says: /^## NotOne breaks\nThe shortest path has 1 step:\n0\. R a, S p\n1\. Next: R b\cBc, S p$/m,
    },
  ],
  [
    "a regions view with U+0003 in labels draws parent states when the regions chart would invent a move",
    {
      base: "Counter",
      fanOut: 4,
      view:
        inventedMoveLabels +
        `export const step = (action, from, to) => (to.x <= 2 ? ${JSON.stringify("Go\u0003X")} : "Go");\n`,
      status: 0,
      states: ["R f", "S p", "R a", "S r", "R b", "S q", "R X\u0003a", "S q", "R X\u0003b", "S r"],
      arrows: [
        "R f start --> S p",
        "R a start --> S r",
        "R b start --> S q",
        "R X\u0003a start --> S q",
        "R X\u0003b start --> S r",
        "S p --> R a: Go\u0003X",
        "S p --> R b: Go\u0003X",
        "S p --> R X\u0003a: Go",
        "S p --> R X\u0003b: Go",
      ],
      says: /^The regions chart lets R f, S p go to R a, S q by Go\cCX, which the model never does\. So the chart draws parent states in place of regions\.$/m,
    },
  ],
] satisfies [
  string,
  {
    base: string;
    fanOut?: number;
    view: string;
    status: number;
    states: string[];
    arrows: string[];
    says: RegExp;
  },
][]) {
  test(what, () => {
    const width = c.fanOut;
    const dir = width
      ? copyCase(c.base, (d) => fs.writeFileSync(path.join(d, "graph.dot"), fanOut(width)))
      : path.join(corpus, c.base);
    const r = run(dir, { view: writeView(c.view) });
    assert.equal(r.stderr, "");
    assert.equal(r.status, c.status);
    assert.deepEqual(drawn(read(path.join(r.out, "chart.mmd"))), {
      states: c.states,
      arrows: c.arrows,
    });
    assert.match(r.report, c.says);
  });
}


