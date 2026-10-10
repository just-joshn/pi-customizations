/**
 * The SEARCH matching half of `aider/coders/editblock_coder.py`: exact line windows, uniform
 * indentation repair, the leading-blank-line retry, and `...` elision. Aider's content
 * edit-distance fallback (`replace_closest_edit_distance`) follows an unconditional `return`,
 * so it is unreachable and not ported.
 */
import { SequenceMatcher } from '../support/difflib.ts';
import { pyIndex } from '../support/pybuiltins.ts';
import { PY_LINE_START, PY_SPACE } from '../support/pyre.ts';
import { count, lstrip, pyLength, splitlines, strip } from '../support/pystr.ts';
import { ValueError } from './errors.ts';

export function prep(content: string): [content: string, lines: string[]] {
  const text = content && !content.endsWith('\n') ? `${content}\n` : content;
  return [text, splitlines(text, true)];
}

export function perfectOrWhitespace(wholeLines: readonly string[], partLines: readonly string[], replaceLines: readonly string[]): string | null {
  const perfect = perfectReplace(wholeLines, partLines, replaceLines);
  if (perfect) return perfect;
  const whitespace = replacePartWithMissingLeadingWhitespace(wholeLines, partLines, replaceLines);
  if (whitespace) return whitespace;
  return null;
}

export function perfectReplace(wholeLines: readonly string[], partLines: readonly string[], replaceLines: readonly string[]): string | null {
  for (let i = 0; i < wholeLines.length - partLines.length + 1; i += 1) {
    if (partLines.every((line, offset) => wholeLines[i + offset] === line)) {
      return [...wholeLines.slice(0, i), ...replaceLines, ...wholeLines.slice(i + partLines.length)].join('');
    }
  }
  return null;
}

/** Best efforts to find the `part` lines in `whole` and replace them with `replace`. */
export function replaceMostSimilarChunk(whole: string, part: string, replace: string): string | null {
  const [wholeText, wholeLines] = prep(whole);
  const [partText, partLines] = prep(part);
  const [replaceText, replaceLines] = prep(replace);
  const res = perfectOrWhitespace(wholeLines, partLines, replaceLines);
  if (res) return res;
  if (partLines.length > 2 && !strip(pyIndex(partLines, 0))) {
    const skipBlankLine = perfectOrWhitespace(wholeLines, partLines.slice(1), replaceLines);
    if (skipBlankLine) return skipBlankLine;
  }
  try {
    return tryDotdotdots(wholeText, partText, replaceText) || null;
  } catch (error) {
    if (error instanceof ValueError) return null;
    throw error;
  }
}

const DOTS = new RegExp(`(${PY_LINE_START}${PY_SPACE}*\\.\\.\\.\\n)`);

const evenPieces = (pieces: readonly string[]): string[] => pieces.filter((_, index) => index % 2 === 0);

function replacePiece(whole: string, part: string, replace: string): string {
  if (!part && !replace) return whole;
  if (!part) return `${whole.endsWith('\n') ? whole : `${whole}\n`}${replace}`;
  const occurrences = count(whole, part);
  if (occurrences === 0) throw new ValueError();
  if (occurrences > 1) throw new ValueError();
  const at = whole.indexOf(part);
  return whole.slice(0, at) + replace + whole.slice(at + part.length);
}

/**
 * Applies a block whose SEARCH and REPLACE elide matching stretches with `...` lines, piece by
 * piece. Returns null when there are no `...` lines, and throws `ValueError` for any mismatch.
 */
export function tryDotdotdots(whole: string, part: string, replace: string): string | null {
  const partPieces = part.split(DOTS);
  const replacePieces = replace.split(DOTS);
  if (partPieces.length !== replacePieces.length) throw new ValueError('Unpaired ... in SEARCH/REPLACE block');
  if (partPieces.length === 1) return null;
  const allDotsMatch = partPieces.every((piece, index) => index % 2 === 0 || piece === replacePieces[index]);
  if (!allDotsMatch) throw new ValueError('Unmatched ... in SEARCH/REPLACE block');
  const replacements = evenPieces(replacePieces);
  return evenPieces(partPieces).reduce((current, piece, index) => replacePiece(current, piece, replacements[index] ?? ''), whole);
}

const leadingWidth = (line: string): number => line.length - lstrip(line).length;

export function replacePartWithMissingLeadingWhitespace(wholeLines: readonly string[], partLines: readonly string[], replaceLines: readonly string[]): string | null {
  const leading = [...partLines, ...replaceLines].filter((line) => strip(line)).map(leadingWidth);
  const numLeading = leading.length > 0 ? leading.reduce((least, width) => Math.min(least, width)) : 0;
  const outdent = (line: string): string => (strip(line) ? line.slice(numLeading) : line);
  const part = partLines.map(outdent);
  const replace = replaceLines.map(outdent);
  for (let i = 0; i < wholeLines.length - part.length + 1; i += 1) {
    const addLeading = matchButForLeadingWhitespace(wholeLines.slice(i, i + part.length), part);
    if (addLeading === null) continue;
    const reindented = replace.map((line) => (strip(line) ? addLeading + line : line));
    return [...wholeLines.slice(0, i), ...reindented, ...wholeLines.slice(i + part.length)].join('');
  }
  return null;
}

/** Aider slices by `len(whole) - len(part)` code points, which is negative when `part` is deeper. */
function extraLeading(wholeLine: string, partLine: string): string {
  const codePoints = [...wholeLine];
  return codePoints.slice(0, codePoints.length - pyLength(partLine)).join('');
}

export function matchButForLeadingWhitespace(wholeLines: readonly string[], partLines: readonly string[]): string | null {
  if (!wholeLines.every((line, i) => lstrip(line) === lstrip(pyIndex(partLines, i)))) return null;
  const add = new Set(wholeLines.flatMap((line, i) => (strip(line) ? [extraLeading(line, pyIndex(partLines, i))] : [])));
  if (add.size !== 1) return null;
  const [only = null] = add;
  return only;
}

/** The chat-file lines most like a failed SEARCH, with five lines of context unless both ends match. */
export function findSimilarLines(searchLines: string, contentLines: string, threshold = 0.6): string {
  const search = splitlines(searchLines);
  const content = splitlines(contentLines);
  let bestRatio = 0;
  let best: { readonly match: string[]; readonly i: number } | null = null;
  for (let i = 0; i < content.length - search.length + 1; i += 1) {
    const chunk = content.slice(i, i + search.length);
    const ratio = new SequenceMatcher({ a: search, b: chunk }).ratio();
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = { match: chunk, i };
    }
  }
  if (bestRatio < threshold) return '';
  if (best === null) throw new TypeError("'NoneType' object is not subscriptable");
  if (pyIndex(best.match, 0) === pyIndex(search, 0) && pyIndex(best.match, -1) === pyIndex(search, -1)) return best.match.join('\n');
  const N = 5;
  const bestMatchEnd = Math.min(content.length, best.i + search.length + N);
  return content.slice(Math.max(0, best.i - N), bestMatchEnd).join('\n');
}
