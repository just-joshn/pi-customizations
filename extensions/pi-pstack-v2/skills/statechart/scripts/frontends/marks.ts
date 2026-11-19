import { type Mark, type Part, type TraceState, type Value } from "../ir.ts";
import { stateOf } from "./trace.ts";
import { BRACKET, COMMA, isSpace, parseValue, tokenEnd, unreadable } from "./value.ts";

const markTexts = (chunk: string, top: number[], inner: number[]) => {
  if (top.length !== 2) return undefined;
  const [a, b] = top;
  const open = chunk.indexOf("<<", a);
  const close = chunk.lastIndexOf(">>", b);
  const end = chunk.trimEnd().length - 2;
  if (open < 0 || chunk.slice(a + 1, open).trim() || chunk.slice(close + 2, b).trim())
    return undefined;
  if (!chunk.startsWith(">>", end)) return undefined;
  const cuts = [open + 1, ...inner.filter((k) => k > open && k < close), close];
  const texts = cuts.slice(1).map((cut, k) => chunk.slice(cuts[k] + 1, cut));
  return { values: texts, rules: chunk.slice(b + 1, end) };
};

const ruleNames = (v: Value) => {
  if (typeof v !== "object" || v.kind !== "set") return undefined;
  const names = v.members.filter((m): m is string => typeof m === "string");
  return names.length === v.members.length ? names : undefined;
};

const PREVIEW_CHARS = 2000;

type Comma = { depth: 1 | 2; at: number };

function* scanCommas(line: string, base: number, startDepth: number) {
  let depth = startDepth;
  let i = 0;
  let last = 0;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (isSpace(c)) {
      i++;
      continue;
    }
    const j = tokenEnd(line, i);
    if (j === -1) throw unreadable(line + "\n", last);
    if (c === COMMA && (depth === 1 || depth === 2)) yield { depth, at: base + i } as Comma;
    depth += BRACKET[c];
    i = last = j;
  }
  return depth;
}

/** Tokenises one line of a mark; returns the new depth and the offsets of its commas at depth 1 and 2. */
const scanLine = (line: string, base: number, startDepth: number) => {
  let depth = startDepth;
  const commas = Array.from(
    (function* () {
      depth = yield* scanCommas(line, base, startDepth);
    })(),
  );
  const at = (level: number) => commas.filter((c) => c.depth === level).map((c) => c.at);
  return { depth, top: at(1), inner: at(2) };
};

const finishMark = (chunk: string, top: number[], inner: number[], read: (s: string) => Value) => {
  const texts = markTexts(chunk, top, inner);
  const values = texts ? texts.values.map(read) : [];
  const broken = texts && ruleNames(read(texts.rules));
  if (!texts || !broken)
    throw new Error(`TLC printed a mark that the command cannot read:\n${chunk.slice(0, PREVIEW_CHARS)}`);
  return { values, broken };
};

export function* readMarks(messages: Iterable<Part>, tag: string): Generator<Mark> {
  const start = `"${tag}",`;
  let chunk = "";
  let depth = 0;
  let top: number[] = [];
  let inner: number[] = [];
  for (const line of messages) {
    if (typeof line !== "string") continue;
    if (!chunk) {
      if (!line.startsWith("<<") || !line.slice(2).trimStart().startsWith(start)) continue;
      depth = 0;
      top = [];
      inner = [];
    }
    const scan = scanLine(line, chunk.length, depth);
    chunk += line + "\n";
    depth = scan.depth;
    top = [...top, ...scan.top];
    inner = [...inner, ...scan.inner];
    if (depth > 0) continue;
    const mark = finishMark(chunk, top, inner, parseValue);
    chunk = "";
    yield mark;
  }
  if (chunk)
    throw new Error(
      `TLC's output ends inside a marked state, so the command cannot tell which rules it breaks:\n${chunk.slice(0, PREVIEW_CHARS)}`,
    );
}

export const readCounterexample = (messages: Iterable<Part>): TraceState[] =>
  Array.from(messages).flatMap((m) => {
    if (typeof m === "string") return [];
    const state = stateOf(m);
    return state ? [state] : [];
  });
