import type { Value } from "../ir.ts";

const ASCII_END = 128;
const TAB = 9;
const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;
const SPACE_CODE = 32;
const QUOTE = 34;
export const COMMA = 44;
const MINUS = 45;
const DOT = 46;
const DIGIT_0 = 48;
const DIGIT_9 = 57;
const COLON = 58;
const LESS = 60;
const GREATER = 62;
const AT = 64;
const UPPER_A = 65;
const UPPER_Z = 90;
const BACKSLASH = 92;
const UNDERSCORE = 95;
const LOWER_A = 97;
const LOWER_Z = 122;
const PIPE = 124;
const LINE_SEPARATOR = 0x2028;
const PARAGRAPH_SEPARATOR = 0x2029;
const OPENERS = "<{[(";
const CLOSERS = ">}])";
const UNREADABLE_CONTEXT = 20;

export const BRACKET = Int8Array.from({ length: ASCII_END }, (_, c) => {
  const ch = String.fromCharCode(c);
  if (OPENERS.includes(ch)) return 1;
  return CLOSERS.includes(ch) ? -1 : 0;
});
const PUNCT = new Map([
  [LESS, "<<"],
  [GREATER, ">>"],
  [PIPE, "|->"],
  [COLON, ":>"],
  [AT, "@@"],
  [DOT, ".."],
]);
const SPACE = /\s/;
export const isSpace = (c: number) =>
  c === SPACE_CODE ||
  (c >= TAB && c <= CARRIAGE_RETURN) ||
  (c >= ASCII_END && SPACE.test(String.fromCharCode(c)));
const isDigit = (c: number) => c >= DIGIT_0 && c <= DIGIT_9;
const isWord = (c: number) =>
  isDigit(c) ||
  (c >= UPPER_A && c <= UPPER_Z) ||
  (c >= LOWER_A && c <= LOWER_Z) ||
  c === UNDERSCORE;
const isLineEnd = (c: number) =>
  c === LINE_FEED || c === CARRIAGE_RETURN || c === LINE_SEPARATOR || c === PARAGRAPH_SEPARATOR;

export const tokenEnd = (s: string, i: number) => {
  const c = s.charCodeAt(i);
  if (c === QUOTE) {
    for (let j = i + 1; j < s.length; j++) {
      const d = s.charCodeAt(j);
      if (d === QUOTE) return j + 1;
      if (d === BACKSLASH && (++j >= s.length || isLineEnd(s.charCodeAt(j)))) return -1;
    }
    return -1;
  }
  const punct = PUNCT.get(c);
  if (punct) return s.startsWith(punct, i) ? i + punct.length : -1;
  if (BRACKET[c] || c === COMMA) return i + 1;
  let j = i + 1;
  if (c === MINUS || isDigit(c)) {
    while (isDigit(s.charCodeAt(j))) j++;
    return c === MINUS && j === i + 1 ? -1 : j;
  }
  if (!isWord(c)) return -1;
  while (isWord(s.charCodeAt(j))) j++;
  return j;
};

export const unreadable = (text: string, pos: number) =>
  new Error(`cannot read TLA+ value at "${text.slice(pos, pos + UNREADABLE_CONTEXT)}"`);

const INT = /^-?\d+$/;
const NAME = /^\w*[A-Za-z]\w*$/;
const UNESCAPED: { [c: string]: string } = {
  '"': '"',
  "\\": "\\",
  n: "\n",
  t: "\t",
  r: "\r",
  f: "\f",
};

const model = (name: string): Value => ({ kind: "model", name });

function* scanTokens(text: string) {
  for (let pos = 0; ;) {
    while (pos < text.length && isSpace(text.charCodeAt(pos))) pos++;
    if (pos === text.length) return;
    const end = tokenEnd(text, pos);
    if (end === -1) throw unreadable(text, pos);
    yield { token: text.slice(pos, end), start: pos };
    pos = end;
  }
}

const tokenize = (text: string) => {
  const found = Array.from(scanTokens(text));
  return { tokens: found.map((f) => f.token), starts: found.map((f) => f.start) };
};

/** A read position over the tokens of one value; every failure reports the text near the position. */
const makeCursor = (text: string) => {
  const { tokens, starts } = tokenize(text);
  let i = 0;
  const fail = (): never => {
    throw unreadable(text, i < starts.length ? starts[Math.max(i - 1, 0)] : text.length);
  };
  const next = () => (i < tokens.length ? tokens[i++] : fail());
  const eat = (t: string) => {
    if (next() !== t) fail();
  };
  function* gather<T>(close: string, item: () => T) {
    for (;;) {
      yield item();
      const t = next();
      if (t === close) return;
      if (t !== ",") fail();
    }
  }
  const items = <T>(close: string, item: () => T) => {
    if (tokens[i] !== close) return Array.from(gather(close, item));
    i++;
    return [];
  };
  return {
    fail,
    next,
    eat,
    items,
    peek: () => tokens[i],
    skip: () => i++,
    previous: () => tokens[i - 1],
    atEnd: () => i >= tokens.length,
  };
};

type Cursor = ReturnType<typeof makeCursor>;

const readString = (c: Cursor, t: string) => {
  let s = "";
  for (let j = 1, from = 1; ;) {
    const k = t.indexOf("\\", j);
    if (k === -1 || k >= t.length - 1) return s + t.slice(from, -1);
    const unescaped = UNESCAPED[t[k + 1]];
    if (unescaped === undefined) c.fail();
    s += t.slice(from, k) + unescaped;
    j = from = k + 2;
  }
};

const readRecord = (c: Cursor): Value => {
  const fields = c.items("]", () => {
    const name = c.next();
    if (!NAME.test(name)) c.fail();
    c.eat("|->");
    return [name, readValue(c)] as const;
  });
  return {
    kind: "function",
    printedAs: "record",
    keys: fields.map(([name]) => name),
    values: fields.map(([, v]) => v),
  };
};

function* pairsOf(c: Cursor) {
  do {
    const key = readValue(c);
    c.eat(":>");
    yield [key, readValue(c)] as const;
  } while (c.next() === "@@");
}

const readPairs = (c: Cursor): Value => {
  const pairs = Array.from(pairsOf(c));
  if (c.previous() !== ")") c.fail();
  return {
    kind: "function",
    printedAs: "pairs",
    keys: pairs.map(([key]) => key),
    values: pairs.map(([, value]) => value),
  };
};

const readTuple = (c: Cursor): Value => {
  const values = c.items(">>", () => readValue(c));
  const keys = Array.from({ length: values.length }, (_, k) => k + 1);
  return { kind: "function", printedAs: "tuple", keys, values };
};

const readAtom = (c: Cursor, t: string): Value => {
  if (t.charCodeAt(0) === QUOTE) return readString(c, t);
  if (INT.test(t)) {
    if (c.peek() !== "..") return Number(t);
    c.skip();
    const hi = c.next();
    if (!INT.test(hi)) c.fail();
    return { kind: "interval", lo: Number(t), hi: Number(hi) };
  }
  return NAME.test(t) ? model(t) : c.fail();
};

function readValue(c: Cursor): Value {
  const t = c.next();
  switch (t) {
    case "TRUE":
      return true;
    case "FALSE":
      return false;
    case "{":
      return { kind: "set", members: c.items("}", () => readValue(c)) };
    case "<<":
      return readTuple(c);
    case "[":
      return readRecord(c);
    case "(":
      return readPairs(c);
    default:
      return readAtom(c, t);
  }
}

export function parseValue(text: string): Value {
  const c = makeCursor(text);
  const out = readValue(c);
  if (!c.atEnd()) {
    c.skip();
    c.fail();
  }
  return out;
}
