/**
 * Python `str` semantics that the ported Aider algorithms depend on. JavaScript's own
 * `trim`, `split`, and `\s` disagree with Python on which characters are whitespace and
 * which end a line, and those differences change matching results.
 */

/** Characters for which Python's `str.isspace()` is true. */
const PY_WHITESPACE = '\t\n\v\f\r\x1c\x1d\x1e\x1f \x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000';

/** Line boundaries recognised by Python's `str.splitlines()`. `\r\n` counts as one boundary. */
const LINE_BOUNDARIES: ReadonlySet<string> = new Set(['\n', '\r', '\v', '\f', '\x1c', '\x1d', '\x1e', '\x85', '\u2028', '\u2029']);

export const isSpaceChar = (char: string): boolean => PY_WHITESPACE.includes(char);

/** Python's `str.isspace()`: true for a non-empty string made only of whitespace. */
export const isSpace = (text: string): boolean => text.length > 0 && [...text].every(isSpaceChar);

function stripSet(chars: string | undefined): (char: string) => boolean {
  return chars === undefined ? isSpaceChar : (char) => chars.includes(char);
}

/** Python's `str.lstrip(chars)`. */
export function lstrip(text: string, chars?: string): string {
  const strippable = stripSet(chars);
  const codePoints = [...text];
  let start = 0;
  while (start < codePoints.length && strippable(codePoints[start] ?? '')) start += 1;
  return codePoints.slice(start).join('');
}

/** Python's `str.rstrip(chars)`. */
export function rstrip(text: string, chars?: string): string {
  const strippable = stripSet(chars);
  const codePoints = [...text];
  let end = codePoints.length;
  while (end > 0 && strippable(codePoints[end - 1] ?? '')) end -= 1;
  return codePoints.slice(0, end).join('');
}

/** Python's `str.strip(chars)`. */
export const strip = (text: string, chars?: string): string => lstrip(rstrip(text, chars), chars);

/** Python's `str.splitlines(keepends)`. */
export function splitlines(text: string, keepends = false): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (!LINE_BOUNDARIES.has(char)) continue;
    const end = char === '\r' && text[index + 1] === '\n' ? index + 2 : index + 1;
    lines.push(text.slice(start, keepends ? end : index));
    start = end;
    index = end - 1;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

/** Python's `str.split()` with no separator: runs of whitespace separate, empty strings dropped. */
export function splitWhitespace(text: string): string[] {
  const words: string[] = [];
  let current = '';
  for (const char of text) {
    if (isSpaceChar(char)) {
      if (current) words.push(current);
      current = '';
    } else current += char;
  }
  if (current) words.push(current);
  return words;
}

/** Python's `str.count(sub)`: non-overlapping occurrences, and `len(text) + 1` for an empty `sub`. */
export function count(text: string, sub: string): number {
  if (sub === '') return [...text].length + 1;
  let found = 0;
  for (let index = text.indexOf(sub); index !== -1; index = text.indexOf(sub, index + sub.length)) found += 1;
  return found;
}

/** Python's `str.replace(old, new)` replacing every occurrence, including the empty-`old` case. */
export function replaceAll(text: string, old: string, replacement: string): string {
  if (old === '') return replacement + [...text].map((char) => char + replacement).join('');
  return text.split(old).join(replacement);
}

/** Python's `str.expandtabs(tabsize)`. */
export function expandtabs(text: string, tabsize = 8): string {
  let column = 0;
  let result = '';
  for (const char of text) {
    if (char === '\t') {
      const spaces = tabsize > 0 ? tabsize - (column % tabsize) : 0;
      result += ' '.repeat(spaces);
      column += spaces;
    } else {
      result += char;
      column = char === '\n' || char === '\r' ? 0 : column + 1;
    }
  }
  return result;
}

/** Python's `len(text)`: code points, not UTF-16 units. */
export const pyLength = (text: string): number => [...text].length;
