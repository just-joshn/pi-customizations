import { pyLen, pyListRepr, pyRepr, pySetRepr, pySorted, pyStrip, replaceFirst, S } from './py.ts';

export interface Findings {
  readonly errors: string[];
  readonly warnings: string[];
}

export interface ValidationResult extends Findings {
  readonly isValid: boolean;
}

const URL_REGEX = new RegExp(`https?://[^${S.slice(1, -1)})]+`, 'gu');
const FENCE_OPEN_REGEX = new RegExp(`^(${S}{0,3})(\`{3,}|~{3,})([^\\n]*)$`, 'u');

// Matches a fence marker line at ANY indent. Used only to scrub leaked markers
// before inline-code pairing; widening FENCE_OPEN_REGEX instead lets a lone
// indented ``` open a block that swallows real code (a false PASS).
const FENCE_MARKER_LINE_REGEX = new RegExp(`^${S}*(?:\`{3,}|~{3,})[^\`~]*$`, 'u');

const MAX_REPORTED_SPAN = 60;
// Python's MULTILINE `^` only matches after \n, unlike JS's `m` flag.
const LINE_START = '(?:^|(?<=\\n))';
const HEADING_REGEX = new RegExp(`${LINE_START}(#{1,6})${S}+([^\\n]*)`, 'gu');
const BULLET_REGEX = new RegExp(`${LINE_START}${S}*[-*+]${S}+`, 'gu');
// Four spaces inside a list item is content indentation, never code.
const LIST_ITEM_REGEX = new RegExp(`^${S}*(?:[-*+]|\\p{Nd}+[.)])${S}`, 'u');

const PATH_CHARS = `[\\p{L}\\p{N}_\\-/\\\\.]`;
const PATH_REGEX = new RegExp(`(?:\\./|\\.\\./|/|[A-Za-z]:\\\\)${PATH_CHARS}+|[\\p{L}\\p{N}_\\-.]+[/\\\\]${PATH_CHARS}+`, 'gu');
// PATH_REGEX also matches prose pairs like "pros/cons"; only an unambiguous
// path (leading ./ ../ / or drive, or a dotted last component) is a hard loss.
const DEFINITE_PATH_REGEX = /^(?:\.\/|\.\.\/|\/|[A-Za-z]:\\)|[^/\\]*\.[A-Za-z0-9]{1,8}$/;

const INLINE_CODE_REGEX = /(?<!`)(`+)(?!`)([\s\S]+?)(?<!`)\1(?!`)/g;

interface Fence {
  char: string;
  length: number;
  info: string;
}

function matchFence(line: string): Fence | undefined {
  const m = FENCE_OPEN_REGEX.exec(line);
  const run = m?.[2];
  if (m === null || run === undefined) return undefined;
  return { char: run.charAt(0), length: run.length, info: m[3] ?? '' };
}

function isClosingFence(line: string, open: Fence): boolean {
  const close = matchFence(line);
  return close !== undefined && close.char === open.char && close.length >= open.length && pyStrip(close.info) === '';
}

function indentOf(line: string): number {
  return line.length - line.replace(/^[ \t]+/, '').length;
}

type Heading = { level: string; title: string };

export function extractHeadings(text: string): Heading[] {
  return [...text.matchAll(HEADING_REGEX)].map((m) => ({ level: m[1] ?? '', title: pyStrip(m[2] ?? '') }));
}

function extractFencedBlocks(lines: readonly string[]): Array<{ start: number; end: number; closed: boolean }> {
  const spans: Array<{ start: number; end: number; closed: boolean }> = [];
  let i = 0;
  while (i < lines.length) {
    const open = matchFence(lines[i] ?? '');
    if (open === undefined) {
      i++;
      continue;
    }
    const start = i;
    i++;
    let closed = false;
    while (i < lines.length) {
      const current = lines[i] ?? '';
      i++;
      if (isClosingFence(current, open)) {
        closed = true;
        break;
      }
    }
    spans.push({ start, end: i, closed });
  }
  return spans;
}

/**
 * Fenced and indented code blocks merged by document position, so a swap in
 * relative order between a fenced and an indented block is detected.
 * Unclosed fences are skipped as malformed markdown.
 */
export function extractCodeBlocks(text: string): string[] {
  const lines = text.split('\n');
  const fenced = extractFencedBlocks(lines)
    .filter((b) => b.closed)
    .map((b) => ({ start: b.start, text: lines.slice(b.start, b.end).join('\n') }));
  return [...fenced, ...extractIndentedCodeBlocks(text)].sort((a, b) => a.start - b.start).map((b) => b.text);
}

/**
 * CommonMark indented code blocks outside any fence. Conservative about lists:
 * a run counts only outside a list and after a blank line.
 */
function fencedLines(lines: readonly string[]): Set<number> {
  const fenced = new Set<number>();
  for (const span of extractFencedBlocks(lines)) {
    for (let k = span.start; k < span.end; k++) fenced.add(k);
  }
  return fenced;
}

/** Collects one indented run starting at `start`; returns the run and the index after it. */
function indentedRun(lines: readonly string[], start: number, fenced: ReadonlySet<number>): { run: string[]; next: number } {
  const lineAt = (k: number): string => lines[k] ?? '';
  const run: string[] = [];
  let i = start;
  while (i < lines.length && !fenced.has(i)) {
    const current = lineAt(i);
    if (pyStrip(current) !== '') {
      if (indentOf(current) < 4) break;
      run.push(current);
      i++;
      continue;
    }
    // A blank line continues the block only if indented content follows.
    let lookahead = i + 1;
    while (lookahead < lines.length && pyStrip(lineAt(lookahead)) === '') lookahead++;
    if (lookahead >= lines.length || fenced.has(lookahead) || indentOf(lineAt(lookahead)) < 4) break;
    run.push(...lines.slice(i, lookahead));
    i = lookahead;
  }
  return { run, next: i };
}

/**
 * CommonMark indented code blocks outside any fence. Conservative about lists:
 * a run counts only outside a list and after a blank line.
 */
export function extractIndentedCodeBlocks(text: string): Array<{ start: number; text: string }> {
  const blocks: Array<{ start: number; text: string }> = [];
  const lines = text.split('\n');
  const fenced = fencedLines(lines);
  let inList = false;
  let previousBlank = true;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const blank = !fenced.has(i) && pyStrip(line) === '';
    if (fenced.has(i) || blank) {
      previousBlank = blank;
      i++;
      continue;
    }
    const indent = indentOf(line);
    if (LIST_ITEM_REGEX.test(line)) inList = true;
    else if (indent === 0) inList = false;
    if (!inList && previousBlank && indent >= 4) {
      const { run, next } = indentedRun(lines, i, fenced);
      if (run.length > 0) blocks.push({ start: i, text: run.join('\n') });
      i = next;
    } else {
      i++;
    }
    previousBlank = false;
  }
  return blocks;
}

export function extractUrls(text: string): Set<string> {
  return new Set(text.match(URL_REGEX) ?? []);
}

export function extractPaths(text: string): Set<string> {
  return new Set(text.match(PATH_REGEX) ?? []);
}

export function countBullets(text: string): number {
  return (text.match(BULLET_REGEX) ?? []).length;
}

/**
 * Backtick spans with fenced blocks removed and stray fence-marker lines
 * blanked. Spans may cross newlines (CommonMark allows it); pairing is
 * run-aware so a mid-line ``` cannot shift every following pair.
 */
export function extractInlineCodes(text: string): string[] {
  let withoutFences = text;
  for (const block of extractCodeBlocks(text)) withoutFences = replaceFirst(withoutFences, block, '');
  withoutFences = withoutFences
    .split('\n')
    .map((line) => (FENCE_MARKER_LINE_REGEX.test(line) ? '' : line))
    .join('\n');
  return [...withoutFences.matchAll(INLINE_CODE_REGEX)].map((m) => m[2] ?? '');
}

function difference(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
  return new Set([...a].filter((x) => !b.has(x)));
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

export function validateHeadings(orig: string, comp: string, result: Findings): void {
  const h1 = extractHeadings(orig);
  const h2 = extractHeadings(comp);
  // Renamed heading text breaks anchor links, so it is an error; a level-only
  // change keeps slugs intact and is a warning.
  if (h1.length !== h2.length) {
    addError(result, `Heading count mismatch: ${h1.length} vs ${h2.length}`);
    return;
  }
  const t1 = h1.map((h) => h.title);
  const t2 = h2.map((h) => h.title);
  if (t1.some((t, k) => t !== t2[k])) {
    const lost = t1.filter((t) => !t2.includes(t));
    const added = t2.filter((t) => !t1.includes(t));
    addError(result, `Heading text/order changed: lost=${pyListRepr(lost)}, added=${pyListRepr(added)}`);
  } else if (h1.some((h, k) => h.level !== h2[k]?.level)) {
    result.warnings.push('Heading levels changed');
  }
}

export function validateCodeBlocks(orig: string, comp: string, result: Findings): void {
  const c1 = extractCodeBlocks(orig);
  const c2 = extractCodeBlocks(comp);
  if (c1.length !== c2.length || c1.some((c, k) => c !== c2[k])) addError(result, 'Code blocks not preserved exactly');
}

export function validateUrls(orig: string, comp: string, result: Findings): void {
  const u1 = extractUrls(orig);
  const u2 = extractUrls(comp);
  if (!sameSet(u1, u2)) {
    addError(result, `URL mismatch: lost=${pySetRepr(difference(u1, u2))}, added=${pySetRepr(difference(u2, u1))}`);
  }
}

export function validatePaths(orig: string, comp: string, result: Findings): void {
  const p1 = extractPaths(orig);
  const p2 = extractPaths(comp);
  const lost = difference(p1, p2);
  const added = difference(p2, p1);
  const definite = new Set([...lost].filter((p) => DEFINITE_PATH_REGEX.test(p)));
  if (definite.size > 0) addError(result, `File paths lost: ${pyListRepr(pySorted(definite))}`);
  if (difference(lost, definite).size > 0 || added.size > 0) {
    result.warnings.push(`Path mismatch: lost=${pyListRepr(pySorted(lost))}, added=${pyListRepr(pySorted(added))}`);
  }
}

export function validateBullets(orig: string, comp: string, result: Findings): void {
  const b1 = countBullets(orig);
  const b2 = countBullets(comp);
  if (b1 === 0) return;
  if (Math.abs(b1 - b2) / b1 > 0.15) result.warnings.push(`Bullet count changed too much: ${b1} -> ${b2}`);
}

function renderSpans(spans: Iterable<string>): string {
  const out = pySorted(spans).map((span) => {
    let flat = span.replaceAll('\n', '\\n');
    if (pyLen(flat) > MAX_REPORTED_SPAN) flat = `${Array.from(flat).slice(0, MAX_REPORTED_SPAN).join('')}…`;
    return pyRepr(flat);
  });
  return `{${out.join(', ')}}`;
}

function counter(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}

export function validateInlineCodes(orig: string, comp: string, result: Findings): void {
  const c1 = counter(extractInlineCodes(orig));
  const c2 = counter(extractInlineCodes(comp));
  const equal = c1.size === c2.size && [...c1].every(([k, v]) => c2.get(k) === v);
  if (equal) return;
  const lost = difference(new Set(c1.keys()), new Set(c2.keys()));
  const added = difference(new Set(c2.keys()), new Set(c1.keys()));
  for (const [code, count] of c1) {
    const other = c2.get(code);
    if (other !== undefined && other < count) lost.add(`${code} (lost ${count - other} of ${count} occurrences)`);
  }
  if (lost.size > 0) addError(result, `Inline code lost: ${renderSpans(lost)}`);
  if (added.size > 0) result.warnings.push(`Inline code added: ${renderSpans(added)}`);
}

function addError(result: Findings, message: string): void {
  result.errors.push(message);
}

/** Universal-newline normalisation, matching Python's read_text(). */
function normalizeNewlines(text: string): string {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

export function newFindings(): Findings {
  return { errors: [], warnings: [] };
}

export function toResult(findings: Findings): ValidationResult {
  return { isValid: findings.errors.length === 0, errors: findings.errors, warnings: findings.warnings };
}

export function validate(original: string, compressed: string): ValidationResult {
  const result = newFindings();
  const orig = normalizeNewlines(original);
  const comp = normalizeNewlines(compressed);
  validateHeadings(orig, comp, result);
  validateCodeBlocks(orig, comp, result);
  validateUrls(orig, comp, result);
  validatePaths(orig, comp, result);
  validateBullets(orig, comp, result);
  validateInlineCodes(orig, comp, result);
  return toResult(result);
}
