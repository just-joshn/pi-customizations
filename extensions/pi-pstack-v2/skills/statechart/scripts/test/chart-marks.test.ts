import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import v8 from "node:v8";
import vm from "node:vm";
import { type Rule, stateRules, type Value } from "../ir.ts";
import { mark } from "../passes/annotate.ts";
import { parseDot } from "../frontends/dot.ts";
import { parseValue } from "../frontends/value.ts";
import { readMarks } from "../frontends/marks.ts";
import { readMessages } from "../frontends/messages.ts";
import { corpus, corpusSpec, graphOf, field } from "./chart-support.ts";

const idWidth = 18;
const commentLines = 1022;
const commentWidth = 1020;
const keptBudgetMiB = 4;
const markedValue = 3;

test("the graph that parseDot returns keeps none of the text it read", () => {
  v8.setFlagsFromString("--expose-gc");
  const gc: () => void = vm.runInNewContext("gc");
  const heapUsed = () => {
    gc();
    gc();
    return process.memoryUsage().heapUsed;
  };
  const MiB = 1 << 20;
  const pieces = 16;
  function* dot() {
    for (let i = 0; i < pieces; i++) {
      const id = `-${String(i).padStart(idWidth, "7")}`;
      const lines = [
        `${id} [label="n = ${i}"];`,
        `${id} -> ${id} [label="StayAtStateNumber${i}"];`,
        ...Array.from({ length: commentLines }, () => `// ${"x".repeat(commentWidth)}`),
      ];
      yield* `${lines.join("\n")}\n`.split("\n");
    }
  }
  const before = heapUsed();
  const graph = parseDot(dot());
  const kept = heapUsed() - before;
  assert.equal(graph.states.size, pieces);
  assert.ok(kept < keptBudgetMiB * MiB, `the graph keeps ${(kept / MiB).toFixed(1)} MiB of ${pieces} MiB read`);
});

test("TLC's marks place on their states even when TLC wraps them over lines", () => {
  const spec = corpusSpec("TwoPhase");
  const out = fs.readFileSync(corpus("TwoPhase", "ChartRun.out"), "utf8");
  const graph = parseDot(fs.readFileSync(corpus("TwoPhase", "graph.dot"), "utf8"));
  const marked = mark(graph, readMarks(readMessages(out), "chart"), spec.variables, stateRules(spec));
  assert.equal(marked.past.size, 0);
  const bad: Value[][] = [...marked.graph.states.values()]
    .filter((s) => s.breaks.length)
    .map((s) => [field(s.vars.rmState, "r1"), field(s.vars.rmState, "r2")].toSorted());
  assert.deepEqual(bad, [
    ["aborted", "committed"],
    ["aborted", "committed"],
  ]);
  const cut = out.slice(0, out.indexOf("{r1},"));
  assert.throws(
    () =>
      mark(
        parseDot(fs.readFileSync(corpus("TwoPhase", "graph.dot"), "utf8")),
        readMarks(readMessages(cut), "chart"),
        spec.variables,
        stateRules(spec),
      ),
    {
      message: `TLC's output ends inside a marked state, so the command cannot tell which rules it breaks:\n${cut.slice(cut.lastIndexOf('<< "chart",'))}\n`,
    },
  );
});

test("a chart tuple that TLC prints inside one of its messages is not a mark", () => {
  const chart = '<<"chart", <<2>>, {"Bad"}>>';
  const out = [
    chart,
    "@!@!@STARTMSG 2132:1 @!@!@",
    "The first argument of Assert evaluated to FALSE; the second argument was:",
    chart,
    "@!@!@ENDMSG 2132 @!@!@",
    "",
  ].join("\n");
  const marks = [...readMarks(readMessages(out), "chart")];
  assert.equal(marks.length, 1);
  assert.deepEqual(marks, [...readMarks(readMessages(`${chart}\n`), "chart")]);
});

test("a line that the spec prints in the shape of a mark is spec output, not a mark", () => {
  const out = [
    '<<"chart", <<2>>, {"Bad"}>>',
    '<< "chart-01234",',
    '   <<2>>, {"Bad"}>>',
    '<<"chart-012", 1>>',
    'x <<"chart-0123", <<2>>, {"Bad"}>>',
    '<< "chart-0123",',
    "   <<3>>,",
    '   {"Bad"} >>',
    "",
  ].join("\n");
  assert.deepEqual(
    [...readMarks(readMessages(out), "chart-0123")],
    [{ values: [markedValue], broken: ["Bad"] }],
  );
});

const inv: Rule = { kind: "invariant", name: "Inv" };

test("a wrapped mark with a model value named constructor places on its state", () => {
  const graph = graphOf([["s0", { x: parseValue("constructor") }, true]], []);
  const marked = mark(
    graph,
    readMarks(readMessages('<<"chart",\n<<constructor>>,\n{"Inv"}>>\n'), "chart"),
    ["x"],
    [inv],
  );
  assert.equal(marked.past.size, 0);
  assert.deepEqual(marked.graph.states.get("s0")?.breaks, [inv]);
});

test("a tagged line in the wrong shape is an error, not spec output", () => {
  for (const line of [
    '<<"chart", [x |-> 1, y |-> 2], {"Inv"}>>',
    '<<"chart", 1>>',
    '<<"chart", <<1>>, <<"Inv">>>>',
    '<<"chart", <<1>>, {1}>>',
    '<<"chart", <<1>>, {"Inv"}, 2>>',
  ])
    assert.throws(
      () => [...readMarks(readMessages(`${line}\n`), "chart")],
      /TLC printed a mark that the command cannot read/,
      line,
    );
});
