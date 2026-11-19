import assert from "node:assert/strict";
import { test } from "node:test";
import { tailText } from "../run-tlc.ts";

const lastTwo = 2;
const smallLimit = 10;

test("the tail is the last lines of the output", () => {
  assert.equal(tailText(["a\nb\n", "c\nd\n"], smallLimit * smallLimit, lastTwo), "c\nd");
});

test("the tail keeps whole chunks until newer ones fill the limit, so a long output loses its start", () => {
  const chunks = ["first\n", "aaaa\n", "bbbb\n", "cccc\n", "dddd\n"];
  assert.equal(tailText(chunks, smallLimit, lastTwo), "cccc\ndddd");
  assert.equal(tailText(chunks, smallLimit, smallLimit), "cccc\ndddd");
  assert.equal(tailText(chunks, smallLimit + 1, smallLimit), "bbbb\ncccc\ndddd");
  assert.equal(tailText(chunks, smallLimit * smallLimit, smallLimit), "first\naaaa\nbbbb\ncccc\ndddd");
});
