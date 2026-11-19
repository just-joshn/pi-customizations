import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";
import { checkView } from "../frontends/view.ts";
import { type Vars, type View } from "../ir.ts";
import { graphOf, draw, type StateRow, type StepRow } from "./chart-support.ts";

const msPerSecond = 1000;
const drawBudgetSeconds = 5;

test("a region named __proto__ is a region like any other", () => {
  const graph = graphOf(
    [
      ["s0", { x: 0, y: 0 }, true],
      ["s1", { x: 1, y: 0 }],
      ["s2", { x: 0, y: 1 }],
    ],
    [
      ["s0", "s1", "GoX"],
      ["s0", "s2", "GoY"],
    ],
  );
  const { chart } = draw(graph, {
    state: (v): unknown =>
      Object.fromEntries([
        ["__proto__", `X${v.x}`],
        ["Other", `Y${v.y}`],
      ]),
  });
  assert.match(chart, /^ {4}state "#95;#95;proto#95;#95;" as r0 \{$/m);
  assert.match(chart, /^ {6}s0 --> s1: GoX \[when Y0\]$/m);
  assert.match(chart, /^ {4}state "Other" as r1 \{$/m);
});

test("checkView takes a full view and refuses each wrong kind and every bad color", () => {
  checkView({}, inspect);
  checkView(
    {
      state: (v: Vars) => v.x,
      step: (a: string) => a,
      group: () => "Busy",
      colors: { Busy: "blue" },
      title: "T",
    },
    inspect,
  );
  assert.throws(() => checkView({ colors: null }, inspect), /\bcolors\b[\s\S]*\bobject\b/);
  assert.throws(() => checkView({ colors: ["blue"] }, inspect), /\bcolors\b[\s\S]*\bobject\b/);
  assert.throws(() => checkView({ state: "Busy" }, inspect), /\bstate\b[\s\S]*\bfunction\b/);
  assert.throws(
    () => checkView({ colors: { Busy: "red", Idle: "repeats", Done: "tan" } }, inspect),
    (error: unknown) =>
      error instanceof Error &&
      /\bBusy\b[\s\S]*"red"/.test(error.message) &&
      /\bIdle\b[\s\S]*"repeats"/.test(error.message) &&
      !/\bDone\b/.test(error.message),
  );
});

test("a group named like an Object method still needs its own color", () => {
  const graph = graphOf([["s0", { x: 0 }, true]], []);
  assert.throws(
    () => draw(graph, checkView({ group: () => "toString", colors: {} }, inspect)),
    /group\(\) returned "toString"/,
  );
});

test("a message writes each value the way JavaScript shows it", () => {
  const loop = new (class {
    self = this;
  })();
  assert.throws(
    () =>
      checkView(
        { colors: { Lost: NaN, Far: Infinity, Big: 7n, Boxed: new String("blue"), Loop: loop } },
        inspect,
      ),
    /"Lost" the color NaN, "Far" the color Infinity, "Big" the color 7n, "Boxed" the color \[String: 'blue'\] and "Loop" the color <ref \*1> \{ self: \[Circular \*1\] \}\./,
  );
  const graph = graphOf([["s0", { x: 0 }, true]], []);
  assert.throws(
    () => draw(graph, checkView({ group: () => NaN, colors: {} }, inspect)),
    /group\(\) returned NaN,/,
  );
});

test("group() is asked state by state as they draw, so a parent-state conflict after a bad group() never gets reported first", () => {
  const graph = graphOf([["s0", { x: 0 }, true], ["s1", { x: 1 }]], [["s0", "s1", "Go"]]);
  let asked: number[] = [];
  const view = checkView(
    {
      state: (v: Vars) => (v.x === 0 ? ["Door", "Open"] : ["Door"]),
      group: (v: Vars) => {
        asked = [...asked, Number(v.x)];
        return v.x === 0 ? "Busy" : "Bad";
      },
      colors: { Busy: "blue" },
    },
    inspect,
  );
  assert.throws(() => draw(graph, view), /state\(\) returned Door both as a state and as a parent state/);
  assert.deepEqual(asked, [0]);
});

test("checkView takes colors only as a plain object", () => {
  const bare: object = Object.create(null, {
    Busy: { value: "blue", enumerable: true, writable: true, configurable: true },
  });
  checkView({ colors: bare }, inspect);
  const inherited: object = Object.create({ Busy: "blue" });
  for (const colors of [new Map([["Busy", "blue"]]), inherited, new String("blue")])
    assert.throws(() => checkView({ colors }, inspect), {
      message: "The view's colors must be a plain object.",
    });
});

test("the chart uses the colors that checkView read once from the view's own keys", () => {
  const graph = graphOf([["s0", { x: 0 }, true]], []);
  let reads = 0;
  const flips = {
    get Busy() {
      reads += 1;
      return reads === 1 ? "blue" : "breaks";
    },
  };
  let current = "blue";
  const changed = {
    get Busy() {
      return current;
    },
  };
  const changes = () => {
    current = "breaks";
    return "Busy";
  };
  for (const view of [
    { group: () => "Busy", colors: flips },
    { group: changes, colors: changed },
  ]) {
    const { chart } = draw(graph, checkView(view, inspect));
    assert.match(chart, /^ {2}class s\d+ blue$/m);
    assert.doesNotMatch(chart, /\bbreaks\b/);
  }
  const hidden = Object.create(Object.prototype, { Busy: { value: "breaks" } });
  assert.throws(
    () => draw(graph, checkView({ group: () => "Busy", colors: hidden }, inspect)),
    /group\(\) returned "Busy", which colors does not name/,
  );
  const key = Symbol("Busy");
  assert.throws(
    () => draw(graph, checkView({ group: () => key, colors: { [key]: "breaks" } }, inspect)),
    /group\(\) returned Symbol\(Busy\), which colors does not name/,
  );
});

test("a chart state with mixed groups gets no color, even when colors names undefined", () => {
  const graph = graphOf(
    [
      ["s0", { x: 0 }, true],
      ["s1", { x: 1 }],
    ],
    [["s0", "s1", "Go"]],
  );
  const view: View = {
    state: () => "Same",
    group: (v) => (v.x ? "B" : "A"),
    colors: { A: "blue", B: "teal", undefined: "pink" },
  };
  assert.doesNotMatch(draw(graph, view).chart, /^ {2}class /m);
});

test("a graph of 10,000 states draws in seconds with no view", () => {
  const n = 100;
  const cells = Array.from({ length: n }, (_, x) => Array.from({ length: n }, (_, y) => ({ x, y }))).flat();
  const states: StateRow[] = cells.map(({ x, y }) => [
    `${x},${y}`,
    { x, y },
    x + y === 0,
    x === n - 1 && y === n - 1 ? ["Safe"] : [],
  ]);
  const steps: StepRow[] = cells.flatMap(({ x, y }): StepRow[] => [
    ...(x + 1 < n ? [[`${x},${y}`, `${x + 1},${y}`, "Right"] as StepRow] : []),
    ...(y + 1 < n ? [[`${x},${y}`, `${x},${y + 1}`, "Down"] as StepRow] : []),
  ]);
  const start = performance.now();
  const { chart, report: text } = draw(graphOf(states, steps), {});
  const seconds = (performance.now() - start) / msPerSecond;
  assert.match(text, /^The shortest path has 198 steps:$/m);
  assert.equal(chart.match(/^ {2}s\d+: /gm)?.length, n * n);
  assert.ok(seconds < drawBudgetSeconds, `drawing took ${seconds.toFixed(1)} s`);
});
