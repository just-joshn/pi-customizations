export type Token = { image: string; line: number };
export type Cannot = (line: number, words: string) => Error;

const CONFIG_HOLDS =
  "A config can hold only names, numbers, strings, comments, and the symbols { } ( ) [ ] , = ! <-.";
const MAX_INT = 2147483647;
const DOUBLE_SYMBOLS = ["[]", "]_", "==", "=<", "!!"];
const SINGLE_SYMBOLS = "{}()[],=!";
const STRING_ESCAPES = '"\\ntrf';
const COMMENT_MARKS = /\(\*|\*\)/g;
const LINE_BREAK = /\n|\r(?!\n)/g;

const shown = (c: string) => {
  const code = c.codePointAt(0) ?? 0;
  const hex = `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
  if (code < 0x20 || code === 0x7f) return hex;
  return code < 0x7f ? `"${c}"` : `"${c}" (${hex})`;
};

/** Maps a text offset to its 1-based line number; a lone \r also ends a line. */
const lineIndex = (text: string) => {
  const breaks = Array.from(text.matchAll(LINE_BREAK), (m) => m.index);
  return (pos: number) => {
    let lo = 0;
    let hi = breaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (breaks[mid] < pos) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
};

type Scanned = { next: number; image?: string };

/** Returns the offset just past the comment that starts at `i`. */
const commentEnd = (text: string, i: number, line: number, cannot: Cannot) => {
  let depth = 0;
  for (const m of text.slice(i).matchAll(COMMENT_MARKS)) {
    depth += m[0] === "(*" ? 1 : -1;
    if (!depth) return i + m.index + 2;
  }
  throw cannot(line, "A comment starts here and does not end.");
};

const stringError = (ch: string | undefined, next: string | undefined) => {
  if (ch === undefined) return "A string starts here and does not end.";
  if (ch === "\n" || ch === "\r")
    return "A string starts here and does not end on its line. Write \\n for a line break in a string.";
  if (ch === "\0") return "A string has the character U+0000.";
  if (ch === "\\" && next !== undefined && !STRING_ESCAPES.includes(next))
    return `A string has a backslash before ${shown(next)}. A string can use only the escapes \\" \\\\ \\n \\t \\r \\f.`;
  return undefined;
};

/** Returns the offset of the closing quote of the string that starts at `i`. */
const stringEnd = (text: string, i: number, line: number, cannot: Cannot) => {
  let j = i + 1;
  while (text[j] !== '"') {
    const problem = stringError(text[j], text[j + 1]);
    if (problem) throw cannot(line, problem);
    j += text[j] === "\\" ? 2 : 1;
  }
  return j;
};

const checkWord = (word: string, line: number, cannot: Cannot) => {
  if (/^[WS]F_/.test(word))
    throw cannot(
      line,
      `TLC reads ${word.slice(0, 3)} at the start of a word as a TLA+ keyword, so it cannot read ${word} as a name.`,
    );
  if (/[A-Za-z]/.test(word) || word === "_") return;
  if (/\D/.test(word))
    throw cannot(
      line,
      `TLC splits ${word} into ${word.match(/\d+|_/g)?.join(" ")}, because a name needs a letter.`,
    );
  if (Number(word) > MAX_INT)
    throw cannot(line, `TLC cannot read a number above ${MAX_INT}, such as ${word}.`);
};

const scanWord = (text: string, i: number, line: number, cannot: Cannot): Scanned => {
  const word = /^\w+/.exec(text.slice(i))?.[0] ?? text[i];
  checkWord(word, line, cannot);
  return { next: i + word.length, image: word };
};

const scanSymbol = (text: string, i: number, line: number, cannot: Cannot): Scanned => {
  const c = text[i];
  const two = text.slice(i, i + 2);
  if (two === "<-") return { next: i + 2, image: two };
  if (DOUBLE_SYMBOLS.includes(two))
    throw cannot(line, `TLC reads ${two} as one TLA+ symbol, and a config cannot hold it.`);
  if (SINGLE_SYMBOLS.includes(c)) return { next: i + 1, image: c };
  const ch = String.fromCodePoint(text.codePointAt(i) ?? 0);
  const where = ch > "\x7f" ? " outside a string" : "";
  throw cannot(line, `It cannot read the character ${shown(ch)}${where}. ${CONFIG_HOLDS}`);
};

const scanOne = (text: string, i: number, line: number, cannot: Cannot): Scanned => {
  const two = text.slice(i, i + 2);
  if (two === "\\*") {
    const end = text.slice(i).search(/[\n\r]/);
    return { next: end < 0 ? text.length : i + end };
  }
  if (two === "(*") return { next: commentEnd(text, i, line, cannot) };
  if (text[i] === '"') {
    const j = stringEnd(text, i, line, cannot);
    return { next: j + 1, image: text.slice(i, j + 1) };
  }
  return /\w/.test(text[i]) ? scanWord(text, i, line, cannot) : scanSymbol(text, i, line, cannot);
};

const isBlank = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r";

function* scanTokens(text: string, lineAt: (i: number) => number, cannot: Cannot) {
  for (let i = 0; i < text.length;) {
    if (isBlank(text[i])) {
      i++;
      continue;
    }
    const line = lineAt(i);
    const scanned = scanOne(text, i, line, cannot);
    if (scanned.image !== undefined) yield { image: scanned.image, line };
    i = scanned.next;
  }
}

export function tokenizeConfig(text: string, cannot: Cannot) {
  if (text.startsWith("\uFEFF"))
    throw cannot(1, "The file starts with a byte order mark. Save it as UTF-8 without one.");
  const lineAt = lineIndex(text);
  const tokens = Array.from(scanTokens(text, lineAt, cannot));
  return { tokens, end: text.length ? lineAt(text.length - 1) : 1 };
}
