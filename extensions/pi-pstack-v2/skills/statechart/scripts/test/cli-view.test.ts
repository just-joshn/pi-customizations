import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assertGone, sleepyJava } from "./cli-process-support.ts";
import { corpus, read, run, writeView } from "./cli-support.ts";


test("a step hidden by the view is not drawn, and the report counts it", () => {
  const dir = path.join(corpus, "MediaPlayer");
  const hidden = new Set(read(path.join(dir, "graph.dot")).match(/^.* -> .*label="ACallComesIn"/gm))
    .size;
  const view = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "statechart-view-")), "view.mjs");
  fs.writeFileSync(
    view,
    `export * from ${JSON.stringify(path.join(dir, "view.mjs"))};\n` +
      `import { step as words } from ${JSON.stringify(path.join(dir, "view.mjs"))};\n` +
      `export const step = (action, from, to) => action === "ACallComesIn" ? null : words(action, from, to);\n`,
  );
  const r = run(dir, { view });
  assert.equal(r.status, 1);
  assert.match(
    r.report,
    new RegExp(`^The view hides ${hidden} steps, so the chart does not draw them\\.$`, "m"),
  );
  assert.doesNotMatch(read(path.join(r.out, "chart.mmd")), /a call comes in/);
  assert.match(r.report, /^1\. you turn it up: Playback Stopped, Volume Loud$/m);
});

test("a view that hides a step of a bug path stops the command with exit 2", () => {
  const dir = path.join(corpus, "MediaPlayer");
  const view = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "statechart-view-")), "view.mjs");
  fs.writeFileSync(
    view,
    `export * from ${JSON.stringify(path.join(dir, "view.mjs"))};\n` +
      `export const step = (action) => (action === "YouTurnItUp" ? null : action);\n`,
  );
  const r = run(dir, { view });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /LoudWhenStopped/);
  assert.deepEqual(r.files, []);
});

for (const [what, body, words] of [
  ["state() returns a number", "export const state = (v) => 7;", /state\(\) returned 7/],
  ["state() reads a missing variable", "export const state = (v) => `${v.nope}`;", /undefined/],
  ["step() returns an empty label", 'export const step = () => "";', /step\(\) returned ""/],
  [
    "group() names no color",
    'export const group = () => "Busy";\nexport const colors = {};',
    /group\(\) returned "Busy"/,
  ],
] satisfies [string, string, RegExp][]) {
  test(`a view whose ${what} stops the command with exit 2`, () => {
    const view = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "statechart-view-")), "view.mjs");
    fs.writeFileSync(view, body);
    const r = run(path.join(corpus, "Login"), { view });
    assert.equal(r.status, 2);
    assert.match(r.stderr, words);
  });
}


for (const [what, body, words] of [
  [
    "gives a group a mark class as its color",
    'export const group = () => "Working";\nexport const colors = { Working: "breaks" };',
    /\bWorking\b[\s\S]*"breaks"[\s\S]*\bblue\b[\s\S]*\bpink\b/,
  ],
  [
    "gives a group a color outside the theme",
    'export const group = () => "Lost";\nexport const colors = { Lost: "red" };',
    /^The view's colors give "Lost" the color "red"\. Give each group blue, orange, purple, yellow, teal, tan or pink\.\n$/,
  ],
  [
    "exports colors as a Map",
    'export const colors = new Map([["Busy", "blue"]]);',
    /^The view's colors must be a plain object\.\n$/,
  ],
  [
    "exports group() but no colors",
    'export const group = () => "Working";',
    /\bgroup\b[\s\S]*\bcolors\b/,
  ],
  [
    "misspells an export",
    "export const state = (v) => v.main;\nexport const steps = (a) => a;",
    /\bsteps\b[\s\S]*\bstep\b/,
  ],
  ["has a default export", "export default { state: (v) => v.main };", /\bdefault\b/],
  ["exports colors as a string", 'export const colors = "blue";', /\bcolors\b[\s\S]*\bobject\b/],
  ["exports a number as its title", "export const title = 7;", /\btitle\b[\s\S]*\bstring\b/],
] satisfies [string, string, RegExp][]) {
  test(`a view that ${what} stops the command with exit 2 before TLC runs`, () => {
    const r = run(path.join(corpus, "Login"), { view: writeView(body) });
    assert.equal(r.status, 2);
    assert.match(r.stderr, words);
    assert.deepEqual(r.files, []);
    assert.deepEqual(r.configs, {});
  });
}

test("a view module that throws null stops the command with exit 2 and no stack trace", () => {
  const r = run(path.join(corpus, "Login"), { view: writeView("throw null;\n") });
  assert.equal(r.status, 2);
  assert.equal(r.stderr, "null\n");
  assert.deepEqual(r.files, []);
  assert.deepEqual(r.configs, {});
});

test("a view module that throws an object with no prototype stops the command with exit 2", () => {
  const r = run(path.join(corpus, "Login"), {
    view: writeView("throw Object.create(null);\n"),
  });
  assert.equal(r.status, 2);
  assert.equal(r.stderr, "[Object: null prototype] {}\n");
  assert.deepEqual(r.files, []);
  assert.deepEqual(r.configs, {});
});

test("a view module that throws a plain object with a message prints the message", () => {
  const r = run(path.join(corpus, "Login"), {
    view: writeView('throw { message: "The view has no states." };\n'),
  });
  assert.equal(r.status, 2);
  assert.equal(r.stderr, "The view has no states.\n");
  assert.deepEqual(r.files, []);
  assert.deepEqual(r.configs, {});
});

test("a view that ends the check while TLC runs stops TLC, and the command exits 2 and writes nothing", async () => {
  const { java, pidFile } = sleepyJava(fs.mkdtempSync(path.join(os.tmpdir(), "statechart-fakes-")));
  const r = run(path.join(corpus, "Login"), {
    java,
    view: writeView(
      'import fs from "node:fs";\n' +
        `setInterval(() => fs.existsSync(${JSON.stringify(pidFile)}) && process.exit(1), 20);\n` +
        "export const state = (v) => JSON.stringify(v);\n",
    ),
  });
  assert.equal(r.status, 2);
  assert.deepEqual(r.files, []);
  await assertGone(Number(read(pidFile)));
});

test("a group that only a mixed chart state gets still needs a color", () => {
  const view = writeView(
    'export const state = (v) => v.main.split(".")[0];\n' +
      'export const group = (v) => v.main.includes("Checking") ? "Checking" : v.main.includes("Wrong") ? "Waiting" : undefined;\n' +
      'export const colors = { Waiting: "blue" };\n',
  );
  const r = run(path.join(corpus, "Login"), { view });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /group\(\) returned "Checking"/);
  assert.deepEqual(r.files, []);
});

test("a view with a group in a theme color draws that color and names the group in the Legend", () => {
  const view = writeView(
    'export const state = (v) => v.main.split(".");\n' +
      'export const group = (v) => (v.main === "Signed in" ? "Done" : undefined);\n' +
      'export const colors = { Done: "teal" };\n' +
      'export const title = "Login";\n',
  );
  const r = run(path.join(corpus, "Login"), { view });
  assert.equal(r.stderr, "");
  assert.equal(r.status, 0);
  const chart = read(path.join(r.out, "chart.mmd"));
  assert.match(chart, /^title: "Login"$/m);
  const id = chart.match(/^ {2}(s\d+): Signed in$/m)?.[1];
  assert.match(chart, new RegExp(`^ {2}class ${id} teal$`, "m"));
  const legend = chart.match(/^ {4}(lg\d+): Done$/m)?.[1];
  assert.match(chart, new RegExp(`^ {2}class ${legend} teal$`, "m"));
});


