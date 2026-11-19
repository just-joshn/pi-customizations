import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { copyCase, corpus, here, read, run } from "./cli-support.ts";


for (const [what, config, words] of [
  [
    "a misspelled first keyword",
    "\\* The rules\nINVARIENT NeverLocked\nSPECIFICATION Spec\n",
    /^TLC refuses .*Login\.cfg at line 2\. It was expecting a keyword, but did not find it\.$/m,
  ],
  [
    "a CHECK_DEADLOCK value in lower case",
    "SPECIFICATION Spec\nINVARIANT TypeOK\nCHECK_DEADLOCK false\n",
    /Login\.cfg at line 3\. It was expecting TRUE or FALSE, but did not find it\./,
  ],
  [
    "an ALIAS line",
    "SPECIFICATION Spec\nINVARIANT TypeOK\nVIEW vars\nALIAS Pretty\n",
    /Login\.cfg at line 4\. It was expecting a keyword, but did not find it\./,
  ],
  [
    "a comma between invariants",
    "SPECIFICATION Spec\nINVARIANT TypeOK, NeverLocked\n",
    /Login\.cfg at line 2\. The invariant , specified in the configuration file is not defined in the specification\./,
  ],
  [
    "a keyword two times",
    "SPECIFICATION Spec\nINVARIANT TypeOK\nSPECIFICATION Spec\n",
    /Login\.cfg at line 3\. The keyword SPECIFICATION appeared twice\./,
  ],
  [
    "a constant value that TLC cannot read",
    "CONSTANT N = -1\nSPECIFICATION Spec\n",
    /Login\.cfg at line 1\..*"-"/,
  ],
  [
    "both SPECIFICATION and NEXT",
    "SPECIFICATION Spec\nNEXT Next\nINVARIANT TypeOK\n",
    /^TLC refuses the config .*Login\.cfg\. The configuration file cannot specify both INIT\/NEXT and SPECIFICATION fields\.$/m,
  ],
  [
    "no SPECIFICATION and no INIT",
    "\\* The rules\nINVARIANT TypeOK\n",
    /^TLC refuses the config .*Login\.cfg\. The configuration file did not specify the initial state predicate\.$/m,
  ],
  [
    "an operator constant with no arguments",
    "CONSTANT f() = 1\nSPECIFICATION Spec\n",
    /^TLC refuses .*Login\.cfg at line 1\. TLC gives no reason here\. An operator's arguments are one or more values in \( \), with commas between them\.$/m,
  ],
  [
    "operator arguments with no closing parenthesis",
    "SPECIFICATION Spec\n\nCONSTANT f(1, 2 = 3\n",
    /^TLC refuses .*Login\.cfg at line 3\. TLC gives no reason here\. An operator's arguments are one or more values in \( \), with commas between them\.$/m,
  ],
  [
    "a CONSTANT keyword on its own line before operator arguments with no closing parenthesis",
    "SPECIFICATION Spec\nCONSTANT\nf(1, 2\n= 3\n",
    /^TLC refuses .*Login\.cfg at line 2\. TLC gives no reason here\. An operator's arguments are one or more values in \( \), with commas between them\.$/m,
  ],
  [
    "a comma invariant before a CHECK_DEADLOCK value in lower case",
    "SPECIFICATION Spec\nINVARIANT ,\nCHECK_DEADLOCK false\n",
    /Login\.cfg at line 3\. It was expecting TRUE or FALSE, but did not find it\./,
  ],
  [
    "a comment that does not end",
    "SPECIFICATION Spec\nINVARIANT TypeOK\n(* The view\nVIEW vars\n",
    /Login\.cfg at line 3\..*\bcomment\b/,
  ],
  [
    "CHECK_DEADLOCK FALSE in a comment that does not end",
    "INVARIANT TypeOK\nSPECIFICATION Spec\n(* CHECK_DEADLOCK FALSE\n",
    /Login\.cfg at line 3\. A comment starts here and does not end\./,
  ],
  [
    "a no-break space before CHECK_DEADLOCK FALSE",
    "SPECIFICATION Spec\nINVARIANT TypeOK\n\u00a0CHECK_DEADLOCK FALSE\n",
    /Login\.cfg at line 3\. It cannot read the character "\u00a0" \(U\+00A0\) outside a string\./,
  ],
  [
    "a line separator before CHECK_DEADLOCK FALSE",
    "SPECIFICATION Spec\nINVARIANT TypeOK\u2028CHECK_DEADLOCK FALSE\n",
    /Login\.cfg at line 2\. It cannot read the character "\u2028" \(U\+2028\) outside a string\./,
  ],
  [
    "a byte order mark",
    "\uFEFFSPECIFICATION Spec\nINVARIANT TypeOK\n",
    /Login\.cfg at line 1\. The file starts with a byte order mark\. Save it as UTF-8 without one\.$/m,
  ],
] satisfies [string, string, RegExp][]) {
  test(`a config with ${what} stops the command with exit 2 before TLC runs`, () => {
    const dir = copyCase("Login", (d) => fs.writeFileSync(path.join(d, "Login.cfg"), config));
    const r = run(dir);
    assert.equal(r.status, 2);
    assert.match(r.stderr, words);
    assert.deepEqual(r.configs, {});
    assert.deepEqual(r.files, []);
  });
}

test("a nested comment hides all of its text, as in TLC", () => {
  const dir = copyCase("Login", (d) => {
    const file = path.join(d, "Login.cfg");
    fs.writeFileSync(file, `(* Off: (* old *) CHECK_DEADLOCK FALSE *)\n${read(file)}`);
  });
  const r = run(dir);
  assert.equal(r.status, 0);
  assert.equal(r.report, read(path.join(corpus, "Login", "report.md")));
});

test("a string constant keeps the keywords and comment markers in it", () => {
  const dir = copyCase("TwoPhase", (d) =>
    fs.writeFileSync(
      path.join(d, "TwoPhase.cfg"),
      'CONSTANT RM = {"INVARIANT (*", "\\\\* r2"}\nSPECIFICATION TPSpec\nINVARIANT TPTypeOK TCConsistent\n',
    ),
  );
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.equal(r.report, read(path.join(corpus, "TwoPhase", "report.md")));
  assert.match(r.configs.ChartRun, /^CONSTANT RM = .*"INVARIANT \(\*".*"\\\\\* r2"/m);
  assert.deepEqual(r.configs.ChartRun.match(/^INVARIANT.*$/gm), ["INVARIANT ChartMark"]);
});

test("TYPE and TYPE_CONSTRAINT are config keywords, as in TLC", () => {
  const dir = copyCase("Login", (d) =>
    fs.writeFileSync(
      path.join(d, "Login.cfg"),
      "SPECIFICATION Spec\nINVARIANT TypeOK\nTYPE TypeOK\nTYPE_CONSTRAINT TypeOK\nVIEW vars\n",
    ),
  );
  const r = run(dir);
  assert.equal(r.status, 0);
  assert.equal(r.report, read(path.join(corpus, "Login", "report.md")));
  assert.match(r.configs.ChartRun, /^TYPE TypeOK$/m);
  assert.match(r.configs.ChartRun, /^TYPE_CONSTRAINT TypeOK$/m);
});

