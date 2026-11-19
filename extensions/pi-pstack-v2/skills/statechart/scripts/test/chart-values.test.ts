import assert from "node:assert/strict";
import { test } from "node:test";
import { json } from "../frontends/view.ts";
import { key, show } from "../ir.ts";
import { parseValue } from "../frontends/value.ts";

test("TLA+ values reach the view as the skill says: sequences from 1, sets as arrays", () => {
  const seen = (text: string) => json(parseValue(text));
  assert.deepEqual(seen('<<1, "a", <<>>>>'), { 1: 1, 2: "a", 3: {} });
  assert.deepEqual(seen("{r1, -2}"), ["r1", -2]);
  assert.deepEqual(seen("{}"), []);
  assert.deepEqual(seen("-1..2"), [-1, 0, 1, 2]);
  assert.deepEqual(seen('[ok |-> TRUE, msg |-> "say \\"hi\\""]'), {
    ok: true,
    msg: 'say "hi"',
  });
  assert.deepEqual(seen("[]"), {});
  assert.deepEqual(seen('(r1 :> "working" @@ r2 :> "aborted")'), {
    r1: "working",
    r2: "aborted",
  });
});

test("a value outside the grammar TLC prints is an error, never a guess", () => {
  for (const text of [
    "<<1, 2",
    "<<1 2>>",
    "{1,}",
    "[1 |-> 2]",
    "[a |-> 1,]",
    "[,]",
    "(1 :> 2",
    "1..",
    "1..x",
    '"\\q"',
    "x y",
    "",
    "SUBSET {1}",
    "[S -> T]",
  ])
    assert.throws(() => parseValue(text), /cannot read TLA\+ value/, text);
});

test("a label prints each value in TLA+, so values that TLC tells apart look apart", () => {
  const shown = (text: string) => show(parseValue(text));
  for (const text of [
    '"A"',
    "A",
    "<<0>>",
    '("1" :> 0)',
    "[a |-> 1]",
    "[]",
    "1..3",
    "{1, 2, 3}",
    "<<>>",
    "{}",
    "TRUE",
    '"TRUE"',
    '"a\\nb\\tc\\"d\\\\e"',
    '(<<1, 2>> :> {A, "A"} @@ 0 :> -1)',
  ])
    assert.equal(shown(text), text);
});

test("equal TLA+ values share one key and unequal ones do not, as TLC compares them", () => {
  const same = [
    ["1..3", "{1, 2, 3}"],
    ["1..3", "{3, 1, 2, 2}"],
    ["{1..2, {1, 2}}", "{{1, 2}}"],
    ["{}", "1..0"],
    ["{5}", "5..5"],
    ["{0, 1, 2, 4, 5, 7}", "{7, 4, 5, 2, 1, 0}"],
    ["<<0>>", "(1 :> 0)"],
    ["<<4, 5>>", "(2 :> 5 @@ 1 :> 4)"],
    ["[a |-> 1, b |-> 2]", '("b" :> 2 @@ "a" :> 1)'],
    ["[]", "<< >>"],
    ["{A, B}", "{B, A}"],
    ['{"b", "a"}', '{"a", "b"}'],
  ];
  for (const [a, b] of same) assert.equal(key(parseValue(a)), key(parseValue(b)), `${a} = ${b}`);
  const apart = [
    ['"A"', "A"],
    ["<<0>>", '("1" :> 0)'],
    ["<<>>", "{}"],
    ["1..3", "{1, 2}"],
    ["1..3", "{1, 2, 3, 4}"],
    ["{1, 3}", "1..3"],
    ["TRUE", '"TRUE"'],
    ["1", '"1"'],
    ["<<1, 2>>", '"<<1, 2>>"'],
    ["(2 :> 0)", "<<0>>"],
    ["(0 :> 1 @@ 1 :> 2)", "<<1, 2>>"],
    ["[a |-> 1]", "[a |-> 2]"],
    ["{<<1>>}", "{<<2>>}"],
  ];
  for (const [a, b] of apart)
    assert.notEqual(key(parseValue(a)), key(parseValue(b)), `${a} # ${b}`);
});
