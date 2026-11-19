import assert from "node:assert/strict";
import { test } from "node:test";
import { type Bug, EC, LEVEL, type PathStep, type Step, type Vars } from "../ir.ts";
import { lasso } from "../passes/annotate.ts";
import { parseValue } from "../frontends/value.ts";
import { readTrace } from "../frontends/trace.ts";
import { graphOf, field, draw } from "./chart-support.ts";

const keyGraph = () =>
  graphOf(
    [
      ["idle", { pos: "idle", key: parseValue("[on |-> FALSE, at |-> 0]") }, true],
      ["waitKeyOff", { pos: "wait", key: parseValue("[on |-> FALSE, at |-> 0]") }],
      ["waitKeyOn", { pos: "wait", key: parseValue("[on |-> TRUE, at |-> 0]") }],
      ["done", { pos: "done", key: parseValue("[on |-> TRUE, at |-> 0]") }],
    ],
    [
      ["idle", "waitKeyOff", "Go"],
      ["idle", "waitKeyOn", "GoKey"],
      ["waitKeyOff", "waitKeyOff", "Tick"],
      ["waitKeyOff", "idle", "Back"],
      ["waitKeyOn", "done", "Open"],
    ],
  );
const keyState = (header: string, pos: string) => ({
  code: EC.TLC_STATE_PRINT2,
  level: LEVEL.STATE,
  body: [header, `/\\ pos = "${pos}"`, "/\\ key = [at |-> 0, on |-> FALSE]", ""],
});
const keyTrace = () =>
  readTrace([
    keyState("1: <Initial predicate>", "idle"),
    keyState("2: <Go line 9, col 3 to line 9, col 20 of module Key>", "wait"),
    { code: EC.TLC_STATE_PRINT3, level: LEVEL.STATE, body: ["3: Stuttering"] },
  ]);

test("a loop's trace finds its states when TLC prints record fields in another order", () => {
  const graph = keyGraph();
  const bug = lasso(graph, keyTrace(), ["pos", "key"]);
  assert.ok(bug);
  assert.equal(bug.start, "idle");
  const moves = bug.path.map((p) => [p.action, p.state]);
  assert.deepEqual(moves, [["Go", "waitKeyOff"]]);
  assert.equal(bug.loop, 1);
  assert.equal(bug.stutters, true);
});

test("a view may hide a step inside a loop, but not a step out of it", () => {
  const graph = keyGraph();
  const found = lasso(graph, keyTrace(), ["pos", "key"]);
  assert.ok(found);
  const loop: Bug = { rule: { kind: "property", name: "Opens" }, ...found };
  const state = (v: Vars) => `${v.pos}, key ${field(v.key, "on") ? "on" : "off"}`;
  const { report } = draw(graph, { state, step: (a) => (a === "Tick" ? null : a) }, [loop]);
  assert.match(report, /^The run stops in "wait, key off" forever\.$/m);
  assert.throws(
    () => draw(graph, { state, step: (a) => (a === "Back" ? null : a) }, [loop]),
    /the step Back that changes pos\. It is on the path to the Opens bug or leaves its loop/,
  );
});

test("a loop that passes one state twice names it once", () => {
  const graph = graphOf(
    [
      ["a", { pos: "a" }, true],
      ["b", { pos: "b" }],
      ["c", { pos: "c" }],
    ],
    [
      ["a", "b", "Up"],
      ["b", "a", "Down"],
      ["a", "c", "Side"],
      ["c", "a", "Back"],
    ],
  );
  const path: PathStep[] = ["ab", "ba", "ac", "ca"].map(([from, to]) => {
    const step: Step | undefined = graph.steps.find((t) => t.from === from && t.to === to);
    assert.ok(step);
    return { action: step.action, state: to, step };
  });
  const loop: Bug = {
    rule: { kind: "property", name: "Settles" },
    start: "a",
    path,
    loop: 0,
    stutters: false,
  };
  const { report } = draw(graph, { state: (v) => v.pos }, [loop]);
  assert.match(report, /^The run loops through "a", "b" and "c" forever\.$/m);
});

test("a chart that draws a way out of a loop that the loop cannot take stops the command", () => {
  const graph = keyGraph();
  const found = lasso(graph, keyTrace(), ["pos", "key"]);
  assert.ok(found);
  const loop: Bug = { rule: { kind: "property", name: "Opens" }, ...found };
  assert.throws(
    () => draw(graph, { state: (v) => v.pos }, [loop]),
    /draws the step Open out of wait, but the Opens loop cannot take it there/,
  );
  const { chart } = draw(
    graph,
    { state: (v) => `${v.pos}, key ${field(v.key, "on") ? "on" : "off"}` },
    [loop],
  );
  const wait = chart.match(/^ {2}(s\d+): wait, key off$/m)?.[1];
  assert.match(chart, new RegExp(`^ {2}class ${wait} repeats$`, "m"));
});
