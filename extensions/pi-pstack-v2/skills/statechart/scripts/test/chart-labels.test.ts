import assert from "node:assert/strict";
import { test } from "node:test";
import { type Vars } from "../ir.ts";
import { graphOf, draw } from "./chart-support.ts";

test("a label codes only the characters that Mermaid reads as syntax, so TLA+ values stay as TLC prints them", () => {
  const graph = graphOf(
    [
      ["s0", { n: 0 }, true],
      ["s1", { n: 1 }],
    ],
    [["s0", "s1", "Go"]],
  );
  const { chart } = draw(graph, {
    state: (v) => (v.n ? 'x: "1";\nnext' : "a <b> #2"),
    step: () => 'say: <<1, "a">> :> [k |-> {}] @@ 2..3',
  });
  assert.match(chart, /^ {2}s\d+: a #60;b> #35;2$/m);
  assert.match(chart, /^ {2}s\d+: x: "1"#59; next$/m);
  assert.match(chart, /^ {2}s\d+ --> s\d+: say: <<1, "a">> :> \[k \|-> \{\}\] @@ 2\.\.3$/m);
});

test("a label with %% stays text and cannot open a Mermaid directive", () => {
  const graph = graphOf(
    [
      ["s0", { n: 0 }, true],
      ["s1", { n: 1 }],
    ],
    [["s0", "s1", "Go"]],
  );
  const { chart } = draw(graph, {
    state: (v) => (v.n ? "%%{init: {}}%%" : "a %%{ b"),
    step: () => "%% go",
  });
  assert.doesNotMatch(chart, /%%/);
  assert.match(chart, /^ {2}s\d+: a #37;%\{ b$/m);
  assert.match(chart, /^ {2}s\d+: #37;%\{init: \{\}\}#37;%$/m);
  assert.match(chart, /^ {2}s\d+ --> s\d+: #37;% go$/m);
});

test("each line break in a label or a colors key is a space, so it cannot start a chart line", () => {
  const graph = graphOf(
    [
      ["s0", { n: 0 }, true],
      ["s1", { n: 1 }],
    ],
    [["s0", "s1", "Go"]],
  );
  const { chart } = draw(graph, {
    state: (v) => (v.n ? "b\r\n\r\v\f\u0085\u2028\u2029\tc" : "a"),
    step: () => "go\r  s9: Ghost",
    group: (v) => (v.n ? "Shut\r  s99: Ghost state" : "Open"),
    colors: { Open: "blue", "Shut\r  s99: Ghost state": "pink" },
  });
  assert.doesNotMatch(chart, /[\r\v\f\u0085\u2028\u2029\t]/);
  assert.match(chart, /^ {2}s\d+: b {9}c$/m);
  assert.match(chart, /^ {2}s\d+ --> s\d+: go {3}s9: Ghost$/m);
  assert.match(chart, /^ {4}lg1: Shut {3}s99: Ghost state$/m);
  assert.doesNotMatch(chart, /^\s*s9{1,2}:/m);
});

test("a label of only white space or with a lone surrogate still has text in the chart", () => {
  const graph = graphOf(
    [
      ["s0", { n: 0 }, true],
      ["s1", { n: 1 }],
    ],
    [["s0", "s1", "Go"]],
  );
  const { chart } = draw(graph, {
    state: (v) => (v.n ? "a\ud800b" : "\t"),
    step: () => " ",
  });
  assert.match(chart, /^ {2}s\d+: #32;$/m);
  assert.match(chart, /^ {2}s\d+: a#65533;b$/m);
  assert.match(chart, /^ {2}s\d+ --> s\d+: #32;$/m);
});

test("NUL and C1 controls in a label are left out, since a browser draws their character references as other characters", () => {
  const graph = graphOf(
    [
      ["s0", { n: 0 }, true],
      ["s1", { n: 1 }],
    ],
    [["s0", "s1", "Go"]],
  );
  const { chart } = draw(graph, {
    state: (v) => (v.n ? ["P\0\x80", "C\u00004Dynamic"] : "\0\x9f"),
    step: () => "a\0\x80b\x85c\x9fd",
  });
  assert.doesNotMatch(chart, /[\0\x80-\x9f]|#0;|#1[2-5]\d;/);
  assert.match(chart, /^ {2}s\d+: #32;$/m);
  assert.match(chart, /^ {2}state "P" as s\d+ \{$/m);
  assert.match(chart, /^ {4}s\d+: C#52;Dynamic$/m);
  assert.match(chart, /^ {2}s\d+ --> s\d+: ab cd$/m);
});

test("a label puts a word joiner inside ﬂ° and ¶ß, since Mermaid decodes a label's text a second time", () => {
  const graph = graphOf(
    [
      ["s0", { n: 0 }, true],
      ["s1", { n: 1 }],
    ],
    [["s0", "s1", "Go"]],
  );
  const { chart } = draw(graph, {
    state: (v) => (v.n ? ["ﬂ\0°lt¶ß", "x"] : "ﬂ°°65¶ßstateß"),
    step: () => "ﬂ ° ¶ ß",
  });
  assert.match(chart, /^ {2}s\d+: ﬂ#8288;#176;#176;65#182;#8288;ßstateß$/m);
  assert.match(chart, /^ {2}state "ﬂ#8288;#176;lt#182;#8288;ß" as s\d+ \{$/m);
  assert.match(chart, /^ {2}s\d+ --> s\d+: ﬂ #176; #182; ß$/m);
});

test('a label puts a word joiner inside marker-end=", since Mermaid rewrites marker-end="url(…# in the drawn SVG', () => {
  const graph = graphOf(
    [
      ["s0", { n: 0 }, true],
      ["s1", { n: 1 }],
    ],
    [["s0", "s1", "Go"]],
  );
  const { chart } = draw(graph, {
    title: 'marker-end="url(a#b',
    state: (v) => (v.n ? ['marker-end="url(p#q', "x"] : 'marker-end="url(a#b'),
    step: () => 'a="b" = "c"',
  });
  assert.match(chart, /^title: "marker-end=ﬂ°°8288¶ß\\"url\(aﬂ°°35¶ßb"$/m);
  assert.match(chart, /^ {2}s\d+: marker-end=#8288;"url\(a#35;b$/m);
  assert.match(chart, /^ {2}state "marker-end=#8288;#34;url\(p#35;q" as s\d+ \{$/m);
  assert.match(chart, /^ {2}s\d+ --> s\d+: a="b" = "c"$/m);
});

test("a parent or region name with [[fork]], [[join]], or [[choice]] stays text", () => {
  const nested = graphOf(
    [
      ["x", { n: 0 }, true],
      ["y", { n: 1 }],
    ],
    [["x", "y", "Go"]],
  );
  const parents = draw(nested, {
    state: (v) => [["a [[fork]]", "[[JOIN]]"][Number(v.n)], "In"],
  }).chart;
  assert.match(parents, /^ {2}state "a #91;\[fork\]\]" as s\d+ \{$/m);
  assert.match(parents, /^ {2}state "#91;\[JOIN\]\]" as s\d+ \{$/m);
  const parallel = graphOf(
    [
      ["s0", { x: 0, y: 0 }, true],
      ["s1", { x: 1, y: 0 }],
    ],
    [["s0", "s1", "GoX"]],
  );
  const regions = draw(parallel, {
    state: (v) => ({ "[[choice]]": `X${v.x}`, Other: `Y${v.y}` }),
  }).chart;
  assert.match(regions, /^ {4}state "#91;\[choice\]\]" as r0 \{$/m);
  assert.doesNotMatch(parents + regions, /\[\[/);
});

test("a label with C4Container, C4Component, C4Dynamic, or C4Deployment keeps the chart a state diagram", () => {
  const graph = graphOf(
    [
      ["s0", { n: 0 }, true],
      ["s1", { n: 1 }],
    ],
    [["s0", "s1", "Go"]],
  );
  const { chart } = draw(graph, {
    state: (v) => (v.n ? ["C4Component", "C4Deployment"] : "aC4Dynamic"),
    step: () => "C4Container C4Context",
  });
  assert.doesNotMatch(chart, /C4(?:Container|Component|Dynamic|Deployment)/);
  assert.match(chart, /^ {2}s\d+: aC#52;Dynamic$/m);
  assert.match(chart, /^ {2}state "C#52;Component" as s\d+ \{$/m);
  assert.match(chart, /^ {4}s\d+: C#52;Deployment$/m);
  assert.match(chart, /^ {2}s\d+ --> s\d+: C#52;Container C4Context$/m);
});

test("a title with < cannot open an HTML tag that rewrites the chart's quotes", () => {
  const graph = graphOf(
    [
      ["s0", { n: 0 }, true],
      ["s1", { n: 1 }],
    ],
    [["s0", "s1", "Go"]],
  );
  const { chart } = draw(graph, { title: "<a=", state: (v) => ["P", `S${v.n}`] });
  assert.doesNotMatch(chart, /</);
  assert.match(chart, /^title: "ﬂ°°60¶ßa="$/m);
  assert.match(chart, /^ {2}state "P" as s\d+ \{$/m);
});

test("the title writes each character outside the allow list in the form Mermaid decodes in a title", () => {
  const graph = graphOf(
    [
      ["s0", { n: 0 }, true],
      ["s1", { n: 1 }],
    ],
    [["s0", "s1", "Go"]],
  );
  const state = (v: Vars) => `S${v.n}`;
  const title = (t: string) =>
    draw(graph, { title: t, state }).chart.match(/^---\ntitle: (.*)\n---\n/)?.[1];
  assert.equal(title("Queue<T> for AT&T"), '"Queueﬂ°°60¶ßT> for ATﬂ°°38¶ßT"');
  assert.equal(title("ﬂ°°65¶ß"), '"ﬂﬂ°°8288¶ßﬂ°°176¶ßﬂ°°176¶ß65ﬂ°°182¶ßﬂ°°8288¶ßß"');
  assert.equal(title('a\0b\x80\n"c"'), '"ab \\"c\\""');
  const blank = draw(graph, { title: "\0\0", state }).chart;
  assert.doesNotMatch(blank, /\0|^---$|^title:/m);
  assert.match(blank, /^stateDiagram-v2$/m);
});

test("labels write the space between direction and LR, RL, TB, or BT as #32;", () => {
  const graph = graphOf(
    [
      ["s0", { n: 0 }, true],
      ["s1", { n: 1 }],
      ["s2", { n: 2 }],
      ["s3", { n: 3 }],
    ],
    [
      ["s0", "s1", "Turn"],
      ["s1", "s2", "Back"],
      ["s2", "s3", "Go"],
    ],
  );
  const steps: { [action: string]: string } = {
    Turn: "turn direction LR",
    Back: "back direction rl",
    Go: "go",
  };
  const { chart } = draw(graph, {
    state: (v) =>
      ["Idle", "Facing direction TB", "Redirection\tlrx", "Up DIRECTION  BT"][Number(v.n)],
    step: (a) => steps[a],
  });
  assert.doesNotMatch(chart, /direction\s+(?:LR|RL|TB|BT)/i);
  assert.match(chart, /^ {2}s\d+: Facing direction#32;TB$/m);
  assert.match(chart, /^ {2}s\d+: Redirection#32;lrx$/m);
  assert.match(chart, /^ {2}s\d+: Up DIRECTION#32;BT$/m);
  assert.match(chart, /^ {2}s\d+ --> s\d+: turn direction#32;LR$/m);
  assert.match(chart, /^ {2}s\d+ --> s\d+: back direction#32;rl$/m);
});

test("a view that cannot give a chart says what to change", () => {
  const graph = graphOf(
    [
      ["p", { x: "A" }, true],
      ["q", { x: "A.B" }],
    ],
    [["p", "q", "Go"]],
  );
  assert.throws(
    () => draw(graph, { state: (v) => String(v.x).split(".") }),
    /both as a state and as a parent state/,
  );
  assert.throws(
    () => draw(graph, { state: (v) => (v.x === "A" ? { R: "x" } : { S: "y" }) }),
    /Return the same regions for every state/,
  );
  assert.throws(() => draw(graph, { state: () => [] }), /Return a string, an array of strings/);
});
