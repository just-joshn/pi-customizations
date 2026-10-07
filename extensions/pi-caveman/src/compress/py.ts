// Python str/regex semantics the upstream engine relies on. JS differs in ways
// that change results: trim() strips U+FEFF, \s and \w are not Unicode-aware the
// same way, `.` stops at \r, and length counts UTF-16 units.

const WS_CHARS = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';

/** Python `\s` for str patterns. */
export const S = `[${WS_CHARS}]`;
/** Python `\w` for str patterns (requires the `u` flag). */
// biome-ignore lint/security/noSecrets: regex character class, not a credential
export const W = '[\\p{L}\\p{N}_]';

const LEADING_WS = new RegExp(`^${S}+`, 'u');
const TRAILING_WS = new RegExp(`${S}+$`, 'u');

export function pyStrip(text: string): string {
  return text.replace(LEADING_WS, '').replace(TRAILING_WS, '');
}

export function pyLen(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: Python str.splitlines treats these separators as line breaks
const LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/g;

/** str.splitlines(keepends=True). */
export function pySplitlinesKeepends(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const m of text.matchAll(LINE_BREAK)) {
    const end = m.index + m[0].length;
    out.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/** str.splitlines(). */
export function pySplitlines(text: string): string[] {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Python str.splitlines treats these separators as line breaks
  return pySplitlinesKeepends(text).map((line) => line.replace(/(?:\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029])$/, ''));
}

/** Python sorts strings by code point; JS default sort uses UTF-16 units. */
export function pyCompare(a: string, b: string): number {
  const ai = a[Symbol.iterator]();
  const bi = b[Symbol.iterator]();
  for (;;) {
    const x = ai.next();
    const y = bi.next();
    if (x.done === true) return y.done === true ? 0 : -1;
    if (y.done === true) return 1;
    const dx = x.value.codePointAt(0) ?? 0;
    const dy = y.value.codePointAt(0) ?? 0;
    if (dx !== dy) return dx - dy;
  }
}

export function pySorted(values: Iterable<string>): string[] {
  return [...values].sort(pyCompare);
}

const NON_PRINTABLE = /[\p{C}\p{Z}]/u;

/** repr() of a str. */
export function pyRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += `\\${quote}`;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch !== ' ' && NON_PRINTABLE.test(ch)) {
      if (cp < 0x100) out += `\\x${cp.toString(16).padStart(2, '0')}`;
      else if (cp < 0x10000) out += `\\u${cp.toString(16).padStart(4, '0')}`;
      else out += `\\U${cp.toString(16).padStart(8, '0')}`;
    } else out += ch;
  }
  return out + quote;
}

export function pyListRepr(values: readonly string[]): string {
  return `[${values.map(pyRepr).join(', ')}]`;
}

/** repr() of a set of str, in sorted order (Python's order is hash-dependent). */
export function pySetRepr(values: Iterable<string>): string {
  const sorted = pySorted(values);
  return sorted.length === 0 ? 'set()' : `{${sorted.map(pyRepr).join(', ')}}`;
}

/** Python Path.suffix: a leading dot or a trailing dot yields no suffix. */
export function pySuffix(name: string): string {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return '';
  return name.slice(i);
}

/** Python Path.stem. */
export function pyStem(name: string): string {
  const suffix = pySuffix(name);
  return suffix === '' ? name : name.slice(0, name.length - suffix.length);
}

export function replaceFirst(text: string, find: string, replacement: string): string {
  const i = text.indexOf(find);
  return i === -1 ? text : text.slice(0, i) + replacement + text.slice(i + find.length);
}

/** Non-overlapping occurrence count, like str.count. */
export function countOccurrences(text: string, find: string): number {
  if (find === '') return text.length + 1;
  let count = 0;
  let i = text.indexOf(find);
  while (i !== -1) {
    count++;
    i = text.indexOf(find, i + find.length);
  }
  return count;
}
