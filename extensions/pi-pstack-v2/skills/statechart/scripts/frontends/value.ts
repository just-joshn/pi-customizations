import type { Value } from "../ir.ts";

export const BRACKET = new Int8Array(128);
for (const c of "<{[(") BRACKET[c.charCodeAt(0)] = 1;
for (const c of ">}])") BRACKET[c.charCodeAt(0)] = -1;
const PUNCT = new Map([
  [60, "<<"],
  [62, ">>"],
  [124, "|->"],
  [58, ":>"],
  [64, "@@"],
  [46, ".."],
]);
const SPACE = /\s/;
export const isSpace = (c: number) =>
  c === 32 || (c >= 9 && c <= 13) || (c > 127 && SPACE.test(String.fromCharCode(c)));
const isDigit = (c: number) => c >= 48 && c <= 57;
const isWord = (c: number) =>
  isDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isLineEnd = (c: number) => c === 10 || c === 13 || c === 0x2028 || c === 0x2029;

export const tokenEnd = (s: string, i: number) => {
  const c = s.charCodeAt(i);
  if (c === 34) {
    for (let j = i + 1; j < s.length; j++) {
      const d = s.charCodeAt(j);
      if (d === 34) return j + 1;
      if (d === 92 && (++j >= s.length || isLineEnd(s.charCodeAt(j)))) return -1;
    }
    return -1;
  }
  const punct = PUNCT.get(c);
  if (punct) return s.startsWith(punct, i) ? i + punct.length : -1;
  if (BRACKET[c] || c === 44) return i + 1;
  let j = i + 1;
  if (c === 45 || isDigit(c)) {
    while (isDigit(s.charCodeAt(j))) j++;
    return c === 45 && j === i + 1 ? -1 : j;
  }
  if (!isWord(c)) return -1;
  while (isWord(s.charCodeAt(j))) j++;
  return j;
};

export const unreadable = (text: string, pos: number) =>
  new Error(`cannot read TLA+ value at "${text.slice(pos, pos + 20)}"`);

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

const models = new Map<string, Value>();
const model = (name: string) => {
  let v = models.get(name);
  if (v === undefined) models.set(name, (v = { kind: "model", name }));
  return v;
};

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
  if (t.charCodeAt(0) === 34) return readString(c, t);
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
