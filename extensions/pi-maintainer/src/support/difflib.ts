/**
 * The parts of CPython 3.13 `difflib` that Aider calls, with CPython's function boundaries in
 * camelCase. Generators return arrays. Strings compare by code point, as Python's do.
 */
import { ValueError } from '../edit/errors.ts';
import { isSpaceChar, rstrip, strip } from './pystr.ts';
import { type JunkPredicate, type OpcodeGroup, type OpcodeTag, SequenceMatcher } from './sequence-matcher.ts';

export { type Hashable, type JunkPredicate, type Match, type Opcode, type OpcodeGroup, type OpcodeTag, SequenceMatcher, type SequenceMatcherOptions } from './sequence-matcher.ts';

export interface CloseMatchOptions {
  /** The most matches to return; must be above 0. */
  readonly n?: number;
  /** The least similarity a match needs, in [0, 1]. */
  readonly cutoff?: number;
}

export interface DifferOptions {
  /** Lines the line matcher must not synchronize on. */
  readonly linejunk?: JunkPredicate<string> | null;
  /** Characters the intraline matcher must not synchronize on. */
  readonly charjunk?: JunkPredicate<string> | null;
}

export interface UnifiedDiffOptions {
  readonly fromfile?: string;
  readonly tofile?: string;
  readonly fromfiledate?: string;
  readonly tofiledate?: string;
  /** Lines of context around each change. */
  readonly n?: number;
  /** Ends the `---`, `+++`, and `@@` lines; content lines keep their own endings. */
  readonly lineterm?: string;
}

const codePoints = (text: string): number[] => Array.from(text, (char) => char.codePointAt(0) ?? 0);

/** Python's `str` ordering, by code point; JavaScript's `<` compares UTF-16 units instead. */
function compareCodePoints(left: string, right: string): number {
  const [a, b] = [codePoints(left), codePoints(right)];
  for (let i = 0; i < a.length && i < b.length; i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

/** Python's `repr(float)`: shortest round-trip digits, in exponent form outside [1e-4, 1e16). */
function reprFloat(value: number): string {
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
  const [digits = '', exponentText = '0'] = value.toExponential().split('e');
  const exponent = Number(exponentText);
  if (exponent < -4 || exponent >= 16) return `${digits}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`;
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

/** The best `n` possibilities scoring at least `cutoff` against `word`, most similar first. */
export function getCloseMatches(word: string, possibilities: Iterable<string>, { n = 3, cutoff = 0.6 }: CloseMatchOptions = {}): string[] {
  if (!(n > 0)) throw new ValueError(`n must be > 0: ${n}`);
  if (!(cutoff >= 0 && cutoff <= 1)) throw new ValueError(`cutoff must be in [0.0, 1.0]: ${reprFloat(cutoff)}`);
  const result: { readonly score: number; readonly x: string }[] = [];
  const s = new SequenceMatcher<string>();
  s.setSeq2(word);
  for (const x of possibilities) {
    s.setSeq1(x);
    if (s.realQuickRatio() >= cutoff && s.quickRatio() >= cutoff && s.ratio() >= cutoff) result.push({ score: s.ratio(), x });
  }
  return result
    .toSorted((left, right) => right.score - left.score || compareCodePoints(right.x, left.x))
    .slice(0, n)
    .map(({ x }) => x);
}

function formatRangeUnified(start: number, stop: number): string {
  const beginning = start + 1;
  const length = stop - start;
  if (length === 1) return `${beginning}`;
  return `${length ? beginning : beginning - 1},${length}`;
}

const UNIFIED_PREFIXES: Readonly<Record<OpcodeTag, readonly [a: string | null, b: string | null]>> = {
  equal: [' ', null],
  replace: ['-', '+'],
  delete: ['-', null],
  insert: [null, '+'],
};

const prefixed = (prefix: string | null, lines: readonly string[]): string[] => (prefix === null ? [] : lines.map((line) => prefix + line));

function unifiedHunk(a: readonly string[], b: readonly string[], group: OpcodeGroup, lineterm: string): string[] {
  const [first] = group;
  const last = group.at(-1) ?? first;
  const header = `@@ -${formatRangeUnified(first[1], last[2])} +${formatRangeUnified(first[3], last[4])} @@${lineterm}`;
  const body = group.flatMap(([tag, i1, i2, j1, j2]) => {
    const [aPrefix, bPrefix] = UNIFIED_PREFIXES[tag];
    return [...prefixed(aPrefix, a.slice(i1, i2)), ...prefixed(bPrefix, b.slice(j1, j2))];
  });
  return [header, ...body];
}

/** The unified diff that turns lines `a` into lines `b`, or no lines when they are equal. */
export function unifiedDiff(a: readonly string[], b: readonly string[], options: UnifiedDiffOptions = {}): string[] {
  const { fromfile = '', tofile = '', fromfiledate = '', tofiledate = '', n = 3, lineterm = '\n' } = options;
  const groups = new SequenceMatcher({ a, b }).getGroupedOpcodes(n);
  if (groups.length === 0) return [];
  const fromdate = fromfiledate ? `\t${fromfiledate}` : '';
  const todate = tofiledate ? `\t${tofiledate}` : '';
  return [`--- ${fromfile}${fromdate}${lineterm}`, `+++ ${tofile}${todate}${lineterm}`, ...groups.flatMap((group) => unifiedHunk(a, b, group, lineterm))];
}

/** CPython's `IS_LINE_JUNK`: a blank line, or one holding a single `#` among Python whitespace. */
export function isLineJunk(line: string): boolean {
  const content = strip(line);
  return content === '' || content === '#';
}

/** CPython's `IS_CHARACTER_JUNK`, `ch in ws`, a substring test, so the empty string is junk too. */
export const isCharacterJunk = (ch: string, ws = ' \t'): boolean => ws.includes(ch);

function dump(tag: string, x: readonly string[], lo: number, hi: number): string[] {
  return x.slice(lo, hi).map((line) => `${tag} ${line}`);
}

/** Writes the shorter block first, as CPython does to ease reading very uneven blocks. */
function plainReplace(a: readonly string[], alo: number, ahi: number, b: readonly string[], blo: number, bhi: number): string[] {
  if (bhi - blo < ahi - alo) return [...dump('+', b, blo, bhi), ...dump('-', a, alo, ahi)];
  return [...dump('-', a, alo, ahi), ...dump('+', b, blo, bhi)];
}

interface SynchPair {
  readonly kind: 'similar' | 'identical';
  readonly i: number;
  readonly j: number;
  readonly aelt: string;
  readonly belt: string;
}

/**
 * CPython's choice of the line pair to synchronize a replaced block on: the most similar
 * non-identical pair, scanning `b` before `a`. Scores start at 0.74 but must reach the 0.75
 * cutoff; below it, the first identical pair is used, and without one there is no pair.
 */
function findSynchPair(cruncher: SequenceMatcher<string>, a: readonly string[], alo: number, ahi: number, b: readonly string[], blo: number, bhi: number): SynchPair | null {
  const cutoff = 0.75;
  let bestRatio = 0.74;
  let best: SynchPair | null = null;
  let identical: SynchPair | null = null;
  const aRange = a.slice(alo, ahi);
  for (const [jOffset, bj] of b.slice(blo, bhi).entries()) {
    cruncher.setSeq2(bj);
    for (const [iOffset, ai] of aRange.entries()) {
      const pair = { i: alo + iOffset, j: blo + jOffset, aelt: ai, belt: bj };
      if (ai === bj) {
        identical ??= { kind: 'identical', ...pair };
        continue;
      }
      cruncher.setSeq1(ai);
      if (cruncher.realQuickRatio() > bestRatio && cruncher.quickRatio() > bestRatio && cruncher.ratio() > bestRatio) {
        bestRatio = cruncher.ratio();
        best = { kind: 'similar', ...pair };
      }
    }
  }
  return bestRatio < cutoff ? identical : best;
}

const HINTS: Readonly<Record<OpcodeTag, readonly [a: string, b: string]>> = {
  replace: ['^', '^'],
  delete: ['-', ''],
  insert: ['', '+'],
  equal: [' ', ' '],
};

function intralineTags(cruncher: SequenceMatcher<string>, aelt: string, belt: string): [atags: string, btags: string] {
  cruncher.setSeqs(aelt, belt);
  const opcodes = cruncher.getOpcodes();
  const atags = opcodes.map(([tag, ai1, ai2]) => HINTS[tag][0].repeat(ai2 - ai1)).join('');
  const btags = opcodes.map(([tag, , , bj1, bj2]) => HINTS[tag][1].repeat(bj2 - bj1)).join('');
  return [atags, btags];
}

/** CPython's `_keep_original_ws`: under an unchanged whitespace character, reuse it so tabs line up. */
function keepOriginalWs(s: string, tagS: string): string {
  const tags = Array.from(tagS);
  let kept = '';
  for (const [index, c] of Array.from(s).entries()) {
    const tagC = tags[index];
    if (tagC === undefined) break;
    kept += tagC === ' ' && isSpaceChar(c) ? c : tagC;
  }
  return kept;
}

function qformat(aline: string, bline: string, atags: string, btags: string): string[] {
  const aHint = rstrip(keepOriginalWs(aline, atags));
  const bHint = rstrip(keepOriginalWs(bline, btags));
  return [`- ${aline}`, ...(aHint ? [`? ${aHint}\n`] : []), `+ ${bline}`, ...(bHint ? [`? ${bHint}\n`] : [])];
}

/** CPython's `Differ`: a line-by-line delta with `?` hints under similar replaced lines. */
export class Differ {
  readonly #linejunk: JunkPredicate<string> | null;
  readonly #charjunk: JunkPredicate<string> | null;

  constructor({ linejunk = null, charjunk = null }: DifferOptions = {}) {
    this.#linejunk = linejunk;
    this.#charjunk = charjunk;
  }

  compare(a: readonly string[], b: readonly string[]): string[] {
    const cruncher = new SequenceMatcher({ isjunk: this.#linejunk, a, b });
    return cruncher.getOpcodes().flatMap(([tag, alo, ahi, blo, bhi]) => {
      switch (tag) {
        case 'replace':
          return this.#fancyReplace(a, alo, ahi, b, blo, bhi);
        case 'delete':
          return dump('-', a, alo, ahi);
        case 'insert':
          return dump('+', b, blo, bhi);
        case 'equal':
          return dump(' ', a, alo, ahi);
        default: {
          const _exhaustive: never = tag;
          return _exhaustive;
        }
      }
    });
  }

  #fancyReplace(a: readonly string[], alo: number, ahi: number, b: readonly string[], blo: number, bhi: number): string[] {
    const cruncher = new SequenceMatcher<string>({ isjunk: this.#charjunk });
    const synch = findSynchPair(cruncher, a, alo, ahi, b, blo, bhi);
    if (synch === null) return plainReplace(a, alo, ahi, b, blo, bhi);
    const { i, j, aelt, belt } = synch;
    const marked = synch.kind === 'identical' ? [`  ${aelt}`] : qformat(aelt, belt, ...intralineTags(cruncher, aelt, belt));
    return [...this.#fancyHelper(a, alo, i, b, blo, j), ...marked, ...this.#fancyHelper(a, i + 1, ahi, b, j + 1, bhi)];
  }

  #fancyHelper(a: readonly string[], alo: number, ahi: number, b: readonly string[], blo: number, bhi: number): string[] {
    if (alo < ahi) return blo < bhi ? this.#fancyReplace(a, alo, ahi, b, blo, bhi) : dump('-', a, alo, ahi);
    return blo < bhi ? dump('+', b, blo, bhi) : [];
  }
}

/** CPython's `ndiff`: a `Differ` delta with no line junk, and blanks and tabs as character junk. */
export function ndiff(a: readonly string[], b: readonly string[], { linejunk = null, charjunk = isCharacterJunk }: DifferOptions = {}): string[] {
  return new Differ({ linejunk, charjunk }).compare(a, b);
}
