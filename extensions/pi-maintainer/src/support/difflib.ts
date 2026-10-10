/**
 * The parts of CPython 3.13 `difflib` that Aider calls, with CPython's function boundaries in
 * camelCase. Generators return arrays. Strings compare by code point, as Python's do.
 */
import { ValueError } from '../edit/errors.ts';
import { type OpcodeGroup, type OpcodeTag, SequenceMatcher } from './sequence-matcher.ts';

export { type Hashable, type JunkPredicate, type Match, type Opcode, type OpcodeGroup, type OpcodeTag, SequenceMatcher, type SequenceMatcherOptions } from './sequence-matcher.ts';

export interface CloseMatchOptions {
  /** The most matches to return; must be above 0. */
  readonly n?: number;
  /** The least similarity a match needs, in [0, 1]. */
  readonly cutoff?: number;
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

/** CPython's `_format_range_unified`: `start,length`, with `length` omitted when it is 1. */
function formatRangeUnified(start: number, stop: number): string {
  const beginning = start + 1;
  const length = stop - start;
  if (length === 1) return `${beginning}`;
  return `${length ? beginning : beginning - 1},${length}`;
}

/** The prefix each opcode puts on its lines from `a` and from `b`; `null` prints none of that side. */
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
