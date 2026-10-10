/**
 * The active subset of `aider/coders/search_replace.py` that unified-diff application calls.
 * Diff-match-patch apply, git cherry-pick, and reverse-line strategies stay unported: udiff never
 * selects them (`edit.udiff.single-strategy`).
 */
import DiffMatchPatch from 'diff-match-patch';
import { count, lstrip, replaceAll, rstrip, splitlines, strip } from '../support/pystr.ts';
import { SearchTextNotUnique, ValueError } from './errors.ts';

export { SearchTextNotUnique };

/** `(strip_blank_lines, relative_indent, reverse_lines)` as Aider's `all_preprocs`. */
export type Preproc = readonly [stripBlank: boolean, relativeIndent: boolean, reverse: boolean];

export const allPreprocs: readonly Preproc[] = [
  [false, false, false],
  [true, false, false],
  [false, true, false],
  [true, true, false],
];

type Texts = readonly [search: string, replace: string, original: string];
type Strategy = (texts: Texts) => string | undefined;

/** Rewrites leading whitespace so paired blocks can match across absolute indent levels. */
export class RelativeIndenter {
  readonly marker: string;

  constructor(texts: readonly string[]) {
    const chars = new Set([...texts.join('')]);
    this.marker = chars.has('←') ? RelativeIndenter.selectUniqueMarker(chars) : '←';
  }

  static selectUniqueMarker(chars: ReadonlySet<string>): string {
    for (let codepoint = 0x10ffff; codepoint >= 0x10000; codepoint -= 1) {
      const marker = String.fromCodePoint(codepoint);
      if (!chars.has(marker)) return marker;
    }
    throw new ValueError('Could not find a unique marker');
  }

  makeRelative(text: string): string {
    if (text.includes(this.marker)) throw new ValueError(`Text already contains the outdent marker: ${this.marker}`);
    const output: string[] = [];
    let prevIndent = '';
    for (const line of splitlines(text, true)) {
      const lineWithoutEnd = rstrip(line, '\n\r');
      const lenIndent = lineWithoutEnd.length - lstrip(lineWithoutEnd).length;
      const indent = line.slice(0, lenIndent);
      const change = lenIndent - prevIndent.length;
      const curIndent = change > 0 ? indent.slice(-change) : change < 0 ? this.marker.repeat(-change) : '';
      output.push(`${curIndent}\n${line.slice(lenIndent)}`);
      prevIndent = indent;
    }
    return output.join('');
  }

  makeAbsolute(text: string): string {
    const lines = splitlines(text, true);
    const output: string[] = [];
    let prevIndent = '';
    for (let i = 0; i < lines.length; i += 2) {
      const dent = rstrip(lines[i] ?? '', '\r\n');
      const nonIndent = lines[i + 1] ?? '';
      const curIndent = dent.startsWith(this.marker) ? prevIndent.slice(0, prevIndent.length - dent.length) : prevIndent + dent;
      output.push(rstrip(nonIndent, '\r\n') === '' ? nonIndent : curIndent + nonIndent);
      prevIndent = curIndent;
    }
    const res = output.join('');
    if (res.includes(this.marker)) throw new ValueError('Error transforming text back to absolute indents');
    return res;
  }
}

export function relativeIndent(texts: Texts): readonly [RelativeIndenter, Texts] {
  const ri = new RelativeIndenter(texts);
  return [ri, [ri.makeRelative(texts[0]), ri.makeRelative(texts[1]), ri.makeRelative(texts[2])]];
}

/** Strip leading and trailing newlines, then ensure a trailing newline. */
export function stripBlankLines(texts: Texts): Texts {
  return [`${strip(texts[0], '\n')}\n`, `${strip(texts[1], '\n')}\n`, `${strip(texts[2], '\n')}\n`];
}

export function reverseLines(text: string): string {
  return splitlines(text, true).toReversed().join('');
}

/** Literal replacement of every `search` occurrence, or undefined when none match. */
export function searchAndReplace(texts: Texts): string | undefined {
  const [searchText, replaceText, originalText] = texts;
  if (count(originalText, searchText) === 0) return undefined;
  return replaceAll(originalText, searchText, replaceText);
}

/**
 * Line-oriented diff of `searchText` into `replaceText` as unified-diff body lines (`+/-/ `),
 * via diff-match-patch, matching Aider's `diff_lines`.
 */
export function diffLines(searchText: string, replaceText: string): string[] {
  const dmp = new DiffMatchPatch();
  dmp.Diff_Timeout = 5;
  const { chars1: searchLines, chars2: replaceLines, lineArray: mapping } = dmp.diff_linesToChars_(searchText, replaceText);
  const diffs = dmp.diff_main(searchLines, replaceLines, false);
  dmp.diff_cleanupSemantic(diffs);
  dmp.diff_cleanupEfficiency(diffs);
  dmp.diff_charsToLines_(diffs, mapping);
  const udiff: string[] = [];
  for (const [d, lines] of diffs) {
    const op = d < 0 ? '-' : d > 0 ? '+' : ' ';
    for (const line of splitlines(lines, true)) udiff.push(op + line);
  }
  return udiff;
}

export function tryStrategy(texts: Texts, strategy: Strategy, preproc: Preproc): string | undefined {
  const [preprocStripBlankLines, preprocRelativeIndent, preprocReverse] = preproc;
  let current: Texts = texts;
  let ri: RelativeIndenter | null = null;
  if (preprocStripBlankLines) current = stripBlankLines(current);
  if (preprocRelativeIndent) {
    const indented = relativeIndent(current);
    ri = indented[0];
    current = indented[1];
  }
  if (preprocReverse) current = [reverseLines(current[0]), reverseLines(current[1]), reverseLines(current[2])];
  let res = strategy(current);
  if (res && preprocReverse) res = reverseLines(res);
  if (res && preprocRelativeIndent && ri) {
    try {
      res = ri.makeAbsolute(res);
    } catch (error) {
      if (error instanceof ValueError) return undefined;
      throw error;
    }
  }
  return res;
}

/** Tries each strategy/preproc pair until one returns a non-empty success string. */
export function flexibleSearchAndReplace(texts: Texts, strategies: readonly (readonly [Strategy, readonly Preproc[]])[]): string | undefined {
  for (const [strategy, preprocs] of strategies) {
    for (const preproc of preprocs) {
      const res = tryStrategy(texts, strategy, preproc);
      if (res) return res;
    }
  }
  return undefined;
}
