import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { corpus, here, newPath, read, run } from "./cli-support.ts";


for (const [what, args, words] of [
  ["an unknown option", ["--bogus"], /Unknown option '--bogus'[\s\S]*Usage:/],
  ["a second spec", ["Other.tla"], /Give one SPEC\.tla\.[\s\S]*Usage:/],
  [
    "a config that does not exist",
    ["--config", "Missing.cfg"],
    /Cannot find the TLC config Missing\.cfg/,
  ],
] satisfies [string, string[], RegExp][]) {
  test(`${what} stops the command with exit 2 before TLC runs`, () => {
    const r = run(path.join(corpus, "Login"), { args });
    assert.equal(r.status, 2);
    assert.match(r.stderr, words);
    assert.deepEqual(r.configs, {});
  });
}

const contents = (p: string) => {
  const stat = fs.lstatSync(p);
  if (stat.isSymbolicLink()) return fs.readlinkSync(p);
  if (!stat.isDirectory()) return read(p);
  const files: { [name: string]: string } = {};
  for (const f of fs.readdirSync(p)) files[f] = read(path.join(p, f));
  return files;
};

for (const [what, make, words] of [
  [
    "a folder of the user's files",
    (out) => {
      fs.mkdirSync(out);
      fs.writeFileSync(path.join(out, ".bashrc"), "export PATH\n");
      fs.writeFileSync(path.join(out, "report.md"), "# My quarterly report\n");
      fs.writeFileSync(path.join(out, "tlc-Build.out"), "build log\n");
    },
    /is not empty\. It has \.bashrc\./,
  ],
  [
    "a folder that holds only a dotfile",
    (out) => {
      fs.mkdirSync(out);
      fs.writeFileSync(path.join(out, ".bashrc"), "export PATH\n");
    },
    /is not empty\. It has \.bashrc\./,
  ],
  [
    "the folder of an earlier run",
    (out) =>
      assert.equal(run(path.join(corpus, "MediaPlayerProps"), { args: ["--out", out] }).status, 1),
    /is not empty\. It has chart\.mmd\./,
  ],
  [
    "a file",
    (out) => fs.writeFileSync(out, "keep me\n"),
    /cannot be the output folder\. ENOTDIR: not a directory/,
  ],
  [
    "a broken link",
    (out) => fs.symlinkSync(path.join(path.dirname(out), "gone"), out),
    /cannot be the output folder\. It is a broken link\./,
  ],
] satisfies [string, (out: string) => void, RegExp][]) {
  test(`an --out that is ${what} stops the command with exit 2 before TLC runs, and keeps what is there`, () => {
    const out = newPath();
    make(out);
    const before = contents(out);
    const r = run(path.join(corpus, "Login"), { args: ["--out", out] });
    assert.equal(r.status, 2);
    assert.ok(r.stderr.includes(out), r.stderr);
    assert.match(r.stderr, words);
    assert.match(r.stderr, /Pass --out with a new folder\.\n$/);
    assert.deepEqual(r.configs, {});
    assert.deepEqual(contents(out), before);
  });
}

test("a file that appears in --out while TLC runs is kept, and the command stops with exit 2", () => {
  const out = newPath();
  const mine = path.join(out, "report.md");
  const java = path.join(path.dirname(out), "java.sh");
  fs.writeFileSync(
    java,
    `#!/bin/sh\nmkdir -p ${JSON.stringify(out)}\n` +
      `[ -e ${JSON.stringify(mine)} ] || echo mine > ${JSON.stringify(mine)}\n` +
      `exec ${JSON.stringify(path.join(here, "java.ts"))} "$@"\n`,
    { mode: 0o755 },
  );
  const r = run(path.join(corpus, "Login"), { args: ["--out", out], java });
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes(mine), r.stderr);
  assert.equal(read(mine), "mine\n");
});

test("an empty --out folder gets the chart and the report", () => {
  const out = newPath();
  fs.mkdirSync(out);
  const r = run(path.join(corpus, "Login"), { args: ["--out", out] });
  assert.equal(r.stderr, "");
  assert.equal(read(path.join(out, "report.md")), read(path.join(corpus, "Login", "report.md")));
  assert.deepEqual(fs.readdirSync(out).toSorted(), ["chart.mmd", "report.md", "tlc.out"]);
});


