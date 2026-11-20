import { isUtf8 } from 'node:buffer';
import { readFileSync, statSync } from 'node:fs';

/** Finds class bodies in JavaScript source so profile frames can be attributed to a class. */
export interface ClassIndex {
  readonly lineStarts: readonly number[];
  readonly names: readonly string[];
  readonly starts: readonly number[];
  readonly ends: readonly number[];
}

interface Cons<T> {
  readonly head: T;
  readonly tail: Cons<T> | null;
  readonly size: number;
}

interface Scan {
  readonly i: number;
  readonly last: string;
  readonly word: string;
  readonly stack: Cons<number> | null;
  readonly templates: Cons<number> | null;
  readonly pairs: Cons<readonly [number, number]> | null;
}

const CLASS_START = /\bclass(?:\s+([A-Za-z_$][\p{L}\p{N}_$]*))?(?:\s+extends\s+[\p{L}\p{N}_$.]+)?(?:\s+implements\s+[\p{L}\p{N}_$.,\s<>]+)?\s*(?:<[^{]*>)?\s*\{/gu;
const CLASS_NAME_BEFORE = /([A-Za-z_$][\p{L}\p{N}_$]*)\s*=\s*$/u;
const WORD_CHAR = /[\p{L}\p{N}_$]/u;
const NEWLINES = /\r\n?/g;
const REGEX_PREFIX = new Set([...'(,=:[!&|?{};+-*%<>~^']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);
const SLASH = '/';
const LINE_COMMENT = '//';
const BLOCK_COMMENT = '/*';
const WHITESPACE = new Set([' ', '\t', '\r', '\n']);
const ANONYMOUS_CLASS = '(anonymous class)';
const LOOKBEHIND_CHARS = 80;
const HALF = 2;
const UNTERMINATED = -1;
const EMPTY_INDEX: ClassIndex = { lineStarts: [0], names: [], starts: [], ends: [] };
const START_SCAN: Scan = { i: 0, last: '', word: '', stack: null, templates: null, pairs: null };

const cons = <T>(head: T, tail: Cons<T> | null): Cons<T> => ({ head, tail, size: (tail?.size ?? 0) + 1 });

function* walk<T>(list: Cons<T> | null): Generator<T> {
  for (let node = list; node !== null; node = node.tail) yield node.head;
}

function skipRegex(text: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < text.length && (text[i] !== SLASH || inClass)) {
    const c = text[i];
    if (c === '\\') i += 1;
    else if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '\n') break;
    i += 1;
  }
  return i + 1;
}

function skipQuoted(text: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < text.length && text[i] !== quote && text[i] !== '\n') i += text[i] === '\\' ? HALF : 1;
  return i + 1;
}

/** Scans a template literal chunk after its opening backtick or closing brace; `interpolation` is true when it stops at a `${`. */
function skipTemplate(text: string, start: number): { readonly end: number; readonly interpolation: boolean } {
  let i = start + 1;
  while (i < text.length && text[i] !== '`') {
    if (text[i] === '\\') i += HALF;
    else if (text.startsWith('${', i)) return { end: i + HALF, interpolation: true };
    else i += 1;
  }
  return { end: i + 1, interpolation: false };
}

const regexAllowed = (scan: Scan): boolean => scan.last === '' || REGEX_PREFIX.has(scan.last) || REGEX_KEYWORDS.has(scan.word);

function templateStep(text: string, scan: Scan, closing: boolean): Scan {
  const outer = closing ? (scan.templates?.tail ?? null) : scan.templates;
  const { end, interpolation } = skipTemplate(text, scan.i);
  return { ...scan, i: end, last: '`', word: '', templates: interpolation ? cons(scan.stack?.size ?? 0, outer) : outer };
}

function codeStep(text: string, scan: Scan, c: string): Scan {
  const closed = c === '}' && scan.stack !== null ? { stack: scan.stack.tail, pairs: cons([scan.stack.head, scan.i] as const, scan.pairs) } : { stack: scan.stack, pairs: scan.pairs };
  const opened = c === '{' ? { stack: cons(scan.i, scan.stack), pairs: scan.pairs } : closed;
  if (!WORD_CHAR.test(c)) return { ...scan, ...opened, i: scan.i + 1, last: c, word: '' };
  let stop = scan.i;
  while (stop < text.length && WORD_CHAR.test(text[stop] ?? '')) stop += 1;
  return { ...scan, ...opened, i: stop, last: 'w', word: text.slice(scan.i, stop) };
}

function step(text: string, scan: Scan): Scan {
  const c = text[scan.i] ?? '';
  if (WHITESPACE.has(c)) return { ...scan, i: scan.i + 1 };
  if (text.startsWith(LINE_COMMENT, scan.i)) {
    const lineEnd = text.indexOf('\n', scan.i);
    return { ...scan, i: lineEnd === UNTERMINATED ? text.length : lineEnd };
  }
  if (text.startsWith(BLOCK_COMMENT, scan.i)) {
    const end = text.indexOf('*/', scan.i + HALF);
    return { ...scan, i: end === UNTERMINATED ? text.length : end + HALF };
  }
  if (c === SLASH && regexAllowed(scan)) return { ...scan, i: skipRegex(text, scan.i), last: SLASH, word: '' };
  if (c === "'" || c === '"') return { ...scan, i: skipQuoted(text, scan.i, c), last: c, word: '' };
  const closesTemplate = c === '}' && scan.templates !== null && scan.templates.head === (scan.stack?.size ?? 0);
  if (c === '`' || closesTemplate) return templateStep(text, scan, closesTemplate);
  return codeStep(text, scan, c);
}

/** Map each code `{` offset to its matching `}`, skipping strings, templates, comments, and regex literals. */
export function bracePairs(text: string): Map<number, number> {
  let scan = START_SCAN;
  while (scan.i < text.length) scan = step(text, scan);
  return new Map(walk(scan.pairs));
}

function* lineStartOffsets(text: string): Generator<number> {
  yield 0;
  for (let at = text.indexOf('\n'); at !== UNTERMINATED; at = text.indexOf('\n', at + 1)) yield at + 1;
}

function readSource(path: string): string | undefined {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile()) return undefined;
  const bytes = readFileSync(path);
  return isUtf8(bytes) ? bytes.toString('utf8').replace(NEWLINES, '\n') : undefined;
}

function classNameBefore(text: string, start: number): string {
  const before = text.slice(Math.max(0, start - LOOKBEHIND_CHARS), start).match(CLASS_NAME_BEFORE);
  return before?.[1] ?? ANONYMOUS_CLASS;
}

/** Class spans of one source file, or an empty index when it cannot be read as UTF-8 text. */
export function classIndex(path: string): ClassIndex {
  const text = readSource(path);
  if (text === undefined) return EMPTY_INDEX;
  const pairs = bracePairs(text);
  const spans = [...text.matchAll(CLASS_START)]
    .flatMap((match) => {
      const open = (match.index ?? 0) + match[0].length - 1;
      const close = pairs.get(open);
      return close === undefined ? [] : [{ open, close, name: match[1] || classNameBefore(text, match.index ?? 0) }];
    })
    .toSorted((a, b) => a.open - b.open);
  return { lineStarts: [...lineStartOffsets(text)], names: spans.map((span) => span.name), starts: spans.map((span) => span.open), ends: spans.map((span) => span.close) };
}

function upperBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.trunc((low + high) / HALF);
    if ((values[middle] ?? 0) <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Name of the innermost class that contains the 0-based line and column, if any. */
export function ownerClass(index: ClassIndex, line: number, column: number): string | undefined {
  const lineStart = index.lineStarts[line];
  if (lineStart === undefined) return undefined;
  const offset = lineStart + column;
  for (let k = upperBound(index.starts, offset) - 1; k >= 0; k -= 1) {
    if ((index.ends[k] ?? UNTERMINATED) >= offset) return index.names[k];
  }
  return undefined;
}
