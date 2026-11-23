/** Patch parsing and application. Two formats are accepted: a multi-file patch with `***` directives, and a unified diff. */

import { detectEol } from './text.ts';

export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchError';
  }
}

export type PatchKind = 'add' | 'update' | 'delete';

export interface PatchHunk {
  /** 1-based first line in the original file, when the format carries it. */
  readonly oldStart?: number;
  readonly oldLines: readonly string[];
  readonly newLines: readonly string[];
}

export interface PatchFile {
  readonly path: string;
  readonly kind: PatchKind;
  readonly hunks: readonly PatchHunk[];
  /** Target of a move directive, relative to the same base as `path`. */
  readonly moveTo?: string;
  /** Complete contents for an added file. */
  readonly addedLines?: readonly string[];
  /** The patch states that the new content has no trailing newline. */
  readonly noNewlineAtEnd?: boolean;
}

export interface ParsedPatch {
  readonly format: 'directives' | 'unified';
  readonly files: readonly PatchFile[];
}

/** Unified-diff metadata lines that carry no hunks. */
const UNIFIED_METADATA = /^(?:diff --git |index |new file mode |deleted file mode |old mode |new mode |similarity index |dissimilarity index |rename from |rename to )/;

function stripPrefix(value: string): string {
  const withoutTimestamp = value.split('\t')[0] ?? value;
  const trimmed = withoutTimestamp.trim();
  if (trimmed.startsWith('a/') || trimmed.startsWith('b/')) {
    return trimmed.slice(2);
  }
  return trimmed;
}

interface DraftHunk {
  oldStart?: number;
  oldLines: string[];
  newLines: string[];
}

interface DraftFile {
  path: string;
  kind: PatchKind;
  hunks: DraftHunk[];
  moveTo?: string;
  addedLines?: string[];
  noNewlineAtEnd?: boolean;
  lastMarker?: '+' | '-' | ' ';
}

/** A line that lands in the new file clears an earlier no-newline marker. The marker only sticks at the end. */
function markNewFileLine(file: DraftFile, marker: '+' | ' '): void {
  file.noNewlineAtEnd = false;
  file.lastMarker = marker;
}

/** The marker describes the new file when it follows a context or added line, not a deletion. */
function markNoNewline(file: DraftFile): void {
  if (file.lastMarker === '+' || file.lastMarker === ' ') {
    file.noNewlineAtEnd = true;
  }
}

function finishHunk(file: DraftFile, hunk: DraftHunk | undefined): void {
  if (hunk === undefined) {
    return;
  }
  if (hunk.oldLines.length === 0 && hunk.newLines.length === 0) {
    return;
  }
  file.hunks.push(hunk);
}

function parseDirectives(text: string): ParsedPatch {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  let index = 0;
  while (index < lines.length && (lines[index] ?? '').trim() === '') {
    index++;
  }
  if ((lines[index] ?? '').trim() !== '*** Begin Patch') {
    throw new PatchError('patch must start with *** Begin Patch');
  }
  index++;
  const files: DraftFile[] = [];
  let current: DraftFile | undefined;
  let hunk: DraftHunk | undefined;

  for (; index < lines.length; index++) {
    const line = lines[index] ?? '';
    if (line.trim() === '*** End Patch') {
      if (current !== undefined) {
        finishHunk(current, hunk);
      }
      return { format: 'directives', files: files.map((file) => ({ ...file, hunks: file.hunks })) };
    }
    if (line.startsWith('*** Update File:')) {
      if (current !== undefined) {
        finishHunk(current, hunk);
      }
      hunk = undefined;
      current = { path: line.slice('*** Update File:'.length).trim(), kind: 'update', hunks: [] };
      files.push(current);
      continue;
    }
    if (line.startsWith('*** Add File:')) {
      if (current !== undefined) {
        finishHunk(current, hunk);
      }
      hunk = undefined;
      current = { path: line.slice('*** Add File:'.length).trim(), kind: 'add', hunks: [], addedLines: [] };
      files.push(current);
      continue;
    }
    if (line.startsWith('*** Delete File:')) {
      if (current !== undefined) {
        finishHunk(current, hunk);
      }
      hunk = undefined;
      current = { path: line.slice('*** Delete File:'.length).trim(), kind: 'delete', hunks: [] };
      files.push(current);
      continue;
    }
    if (line.startsWith('*** Move to:')) {
      if (current === undefined) {
        throw new PatchError('*** Move to appears before any file directive');
      }
      current.moveTo = line.slice('*** Move to:'.length).trim();
      continue;
    }
    if (line.startsWith('*** ')) {
      throw new PatchError(`unknown patch directive: ${line.trim()}`);
    }
    if (current === undefined) {
      if (line.trim() === '') {
        continue;
      }
      throw new PatchError('patch content appears before any file directive');
    }
    if (line === '\\ No newline at end of file') {
      markNoNewline(current);
      continue;
    }
    if (line.startsWith('@@')) {
      finishHunk(current, hunk);
      const match = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
      hunk = { ...(match?.[1] === undefined ? {} : { oldStart: Number(match[1]) }), oldLines: [], newLines: [] };
      continue;
    }
    if (current.kind === 'add') {
      if (line === '' || line.startsWith('+')) {
        current.addedLines?.push(line.startsWith('+') ? line.slice(1) : line);
        markNewFileLine(current, '+');
        continue;
      }
      throw new PatchError(`added file ${current.path} contains a line that does not start with +`);
    }
    if (line === '') {
      hunk ??= { oldLines: [], newLines: [] };
      hunk.oldLines.push('');
      hunk.newLines.push('');
      markNewFileLine(current, ' ');
      continue;
    }
    const marker = line[0];
    const body = line.slice(1);
    if (marker === ' ') {
      hunk ??= { oldLines: [], newLines: [] };
      hunk.oldLines.push(body);
      hunk.newLines.push(body);
      markNewFileLine(current, ' ');
      continue;
    }
    if (marker === '-') {
      hunk ??= { oldLines: [], newLines: [] };
      hunk.oldLines.push(body);
      current.lastMarker = '-';
      continue;
    }
    if (marker === '+') {
      hunk ??= { oldLines: [], newLines: [] };
      hunk.newLines.push(body);
      markNewFileLine(current, '+');
      continue;
    }
    throw new PatchError(`unexpected line in patch: ${line.slice(0, 80)}`);
  }
  throw new PatchError('patch is missing *** End Patch');
}

function parseUnified(text: string, basePath: string): ParsedPatch {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const files: DraftFile[] = [];
  let index = 0;
  let current: DraftFile | undefined;
  let hunk: DraftHunk | undefined;

  const flushHunk = (): void => {
    if (current !== undefined) {
      finishHunk(current, hunk);
    }
    hunk = undefined;
  };

  const startsFileSection = (candidate: string): boolean => candidate.startsWith('--- ') || candidate.startsWith('diff --git ');

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (UNIFIED_METADATA.test(line)) {
      index++;
      continue;
    }
    if (line.startsWith('--- ')) {
      flushHunk();
      const oldPath = stripPrefix(line.slice(4));
      const next = lines[index + 1] ?? '';
      if (!next.startsWith('+++ ')) {
        throw new PatchError('unified diff header is missing the +++ line');
      }
      const newPath = stripPrefix(next.slice(4));
      const kind: PatchKind = oldPath === '/dev/null' ? 'add' : newPath === '/dev/null' ? 'delete' : 'update';
      current = { path: kind === 'delete' ? oldPath : newPath, kind, hunks: [] };
      files.push(current);
      index += 2;
      continue;
    }
    if (line.startsWith('@@')) {
      if (current === undefined) {
        throw new PatchError('hunk appears before a file header');
      }
      flushHunk();
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (!match) {
        throw new PatchError(`malformed hunk header: ${line.slice(0, 80)}`);
      }
      hunk = { oldStart: Number(match[1]), oldLines: [], newLines: [] };
      index++;
      continue;
    }
    if (line === '') {
      // A blank line either separates file sections or stands for an empty context line.
      let ahead = index + 1;
      while (ahead < lines.length && (lines[ahead] ?? '') === '') {
        ahead++;
      }
      const next = lines[ahead] ?? '';
      if (next === '' || startsFileSection(next)) {
        flushHunk();
        index = ahead;
        continue;
      }
      if (hunk !== undefined) {
        hunk.oldLines.push('');
        hunk.newLines.push('');
        if (current !== undefined) {
          markNewFileLine(current, ' ');
        }
      }
      index++;
      continue;
    }
    if (line.startsWith('\\')) {
      if (current !== undefined) {
        markNoNewline(current);
      }
      index++;
      continue;
    }
    if (current === undefined || hunk === undefined) {
      index++;
      continue;
    }
    const marker = line[0];
    const body = line.slice(1);
    if (marker === ' ') {
      hunk.oldLines.push(body);
      hunk.newLines.push(body);
      markNewFileLine(current, ' ');
    } else if (marker === '-') {
      hunk.oldLines.push(body);
      current.lastMarker = '-';
    } else if (marker === '+') {
      hunk.newLines.push(body);
      markNewFileLine(current, '+');
    } else {
      throw new PatchError(`unexpected line in hunk: ${line.slice(0, 80)}`);
    }
    index++;
  }
  flushHunk();
  if (files.length === 0) {
    throw new PatchError(`no file headers found in patch for ${basePath}`);
  }
  return {
    format: 'unified',
    files: files.map((file) => ({
      ...file,
      hunks: file.hunks,
      ...(file.kind === 'add' ? { addedLines: file.hunks.flatMap((hunk) => hunk.newLines) } : {}),
    })),
  };
}

export function parsePatch(text: string, basePath = '.'): ParsedPatch {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (trimmed === '') {
    throw new PatchError('patch is empty');
  }
  const parsed = trimmed.startsWith('*** Begin Patch') ? parseDirectives(text) : parseUnified(text, basePath);
  for (const file of parsed.files) {
    if (file.path === '' || file.path === '/dev/null') {
      throw new PatchError('patch names an empty file path');
    }
    if (file.kind === 'update' && file.hunks.length === 0) {
      throw new PatchError(`update for ${file.path} contains no hunks`);
    }
  }
  return parsed;
}

/**
 * Find a hunk at or after `from`. The position implied by the hunk header, adjusted for previously
 * applied hunks, wins; otherwise the match must be unique.
 */
function findHunk(lines: readonly string[], hunk: PatchHunk, from: number, expected: number | undefined, insertionAt: number): number {
  if (hunk.oldLines.length === 0) {
    // An insertion has no text to match. Its header position counts the lines before it, and every
    // earlier hunk has already moved the content, so the insertion point includes the accumulated offset.
    const at = Math.max(from, insertionAt);
    return at >= 0 && at <= lines.length ? at : -1;
  }
  const matches: number[] = [];
  const limit = lines.length - hunk.oldLines.length;
  for (let start = Math.max(0, from); start <= limit; start++) {
    let matched = true;
    for (let offset = 0; offset < hunk.oldLines.length; offset++) {
      if (lines[start + offset] !== hunk.oldLines[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      matches.push(start);
    }
  }
  if (matches.length === 0) {
    return -1;
  }
  if (expected !== undefined) {
    const exact = matches.find((start) => start === expected);
    if (exact !== undefined) {
      return exact;
    }
  }
  if (matches.length > 1) {
    throw new PatchError('hunk matches more than one place; add surrounding context');
  }
  return matches[0] ?? -1;
}

/**
 * Apply hunks in file order. Each hunk is searched from the end of the previous one, so a later hunk
 * cannot match an earlier copy of the same line.
 */
export function applyHunks(originalLines: readonly string[], hunks: readonly PatchHunk[], filePath: string): string[] {
  let lines = [...originalLines];
  let cursor = 0;
  let offset = 0;
  for (const [index, hunk] of hunks.entries()) {
    const expected = hunk.oldStart === undefined ? undefined : hunk.oldStart === 0 ? offset : hunk.oldStart - 1 + offset;
    // A zero-context insertion names the line it follows, which is its old start plus earlier offsets.
    const insertionAt = hunk.oldStart === undefined ? cursor : hunk.oldStart + offset;
    const start = findHunk(lines, hunk, cursor, expected, insertionAt);
    if (start === -1) {
      throw new PatchError(`hunk ${index + 1} for ${filePath} does not match the file contents`);
    }
    lines = [...lines.slice(0, start), ...hunk.newLines, ...lines.slice(start + hunk.oldLines.length)];
    cursor = start + hunk.newLines.length;
    offset += hunk.newLines.length - hunk.oldLines.length;
  }
  return lines;
}

/** Added and removed line counts for one file's hunks, computed as a longest-common-subsequence diff. */
export function countHunkChanges(hunks: readonly PatchHunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    const common = longestCommonSubsequence(hunk.oldLines, hunk.newLines);
    added += hunk.newLines.length - common;
    removed += hunk.oldLines.length - common;
  }
  return { added, removed };
}

function longestCommonSubsequence(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  let previous = new Array<number>(right.length + 1).fill(0);
  for (const leftLine of left) {
    const current = new Array<number>(right.length + 1).fill(0);
    for (let index = 1; index <= right.length; index++) {
      const match = leftLine === right[index - 1];
      current[index] = match ? (previous[index - 1] ?? 0) + 1 : Math.max(previous[index] ?? 0, current[index - 1] ?? 0);
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

interface SourcedLine {
  readonly text: string;
  readonly ending: '' | '\n' | '\r\n';
}

function splitLinesWithEndings(text: string): SourcedLine[] {
  if (text === '') {
    return [];
  }
  const lines: SourcedLine[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) !== 10) {
      continue;
    }
    const crlf = index > start && text.charCodeAt(index - 1) === 13;
    const end = crlf ? index - 1 : index;
    lines.push({ text: text.slice(start, end), ending: crlf ? '\r\n' : '\n' });
    start = index + 1;
  }
  if (start < text.length) {
    lines.push({ text: text.slice(start), ending: '' });
  }
  return lines;
}

export function splitLines(text: string): string[] {
  return splitLinesWithEndings(text).map((line) => line.text);
}

/** Pair patched lines with original lines by a longest common subsequence, after the shared ends. */
function alignEndings(original: readonly SourcedLine[], patched: readonly string[]): ('' | '\n' | '\r\n' | undefined)[] {
  const pairs = lcsPairs(
    original.map((line) => line.text),
    patched,
  );
  const endings: ('' | '\n' | '\r\n' | undefined)[] = new Array(patched.length).fill(undefined);
  for (const [left, right] of pairs) {
    endings[right] = original[left]?.ending;
  }
  return endings;
}

function lcsPairs(left: readonly string[], right: readonly string[]): Array<[number, number]> {
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) {
    suffix++;
  }
  const mid = lcsMiddle(left.slice(prefix, left.length - suffix), right.slice(prefix, right.length - suffix));
  const pairs: Array<[number, number]> = [];
  for (let index = 0; index < prefix; index++) {
    pairs.push([index, index]);
  }
  for (const [leftIndex, rightIndex] of mid) {
    pairs.push([leftIndex + prefix, rightIndex + prefix]);
  }
  for (let index = 0; index < suffix; index++) {
    pairs.push([left.length - suffix + index, right.length - suffix + index]);
  }
  return pairs;
}

function lcsMiddle(left: readonly string[], right: readonly string[]): Array<[number, number]> {
  const rows = left.length;
  const cols = right.length;
  if (rows === 0 || cols === 0) {
    return [];
  }
  if (rows * cols > 2_000_000) {
    return greedyPairs(left, right);
  }
  const width = cols + 1;
  const previous = new Uint32Array(width);
  const current = new Uint32Array(width);
  const direction = new Uint8Array((rows + 1) * width);
  for (let row = 1; row <= rows; row++) {
    current.fill(0);
    for (let col = 1; col <= cols; col++) {
      if (left[row - 1] === right[col - 1]) {
        current[col] = (previous[col - 1] ?? 0) + 1;
        direction[row * width + col] = 1;
      } else if ((previous[col] ?? 0) >= (current[col - 1] ?? 0)) {
        current[col] = previous[col] ?? 0;
        direction[row * width + col] = 2;
      } else {
        current[col] = current[col - 1] ?? 0;
        direction[row * width + col] = 3;
      }
    }
    previous.set(current);
  }
  const pairs: Array<[number, number]> = [];
  let row = rows;
  let col = cols;
  while (row > 0 && col > 0) {
    const step = direction[row * width + col];
    if (step === 1) {
      pairs.push([row - 1, col - 1]);
      row--;
      col--;
    } else if (step === 2) {
      row--;
    } else {
      col--;
    }
  }
  pairs.reverse();
  return pairs;
}

/** In-order fallback when the changed region is too large for the LCS table. */
function greedyPairs(left: readonly string[], right: readonly string[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  let leftIndex = 0;
  for (let rightIndex = 0; rightIndex < right.length; rightIndex++) {
    while (leftIndex < left.length && left[leftIndex] !== right[rightIndex]) {
      leftIndex++;
    }
    if (leftIndex < left.length) {
      pairs.push([leftIndex, rightIndex]);
      leftIndex++;
    }
  }
  return pairs;
}

function endingFor(matched: '' | '\n' | '\r\n' | undefined, isLast: boolean, noNewline: boolean, dominant: '\n' | '\r\n'): '' | '\n' | '\r\n' {
  if (isLast && noNewline) {
    return '';
  }
  if (matched === undefined) {
    return dominant;
  }
  if (matched === '' && !isLast) {
    return dominant;
  }
  return matched;
}

/**
 * Rebuild the file from patched line texts. A matched line keeps its original ending. An added line
 * uses the file's dominant ending. The no-newline marker drops the final ending. An unchanged last
 * line that had no ending keeps it, so a context-only patch stays a no-op.
 */
export function rebuildPatched(originalText: string, patchedLines: readonly string[], noNewline: boolean): string {
  if (patchedLines.length === 0) {
    return '';
  }
  const original = splitLinesWithEndings(originalText);
  const dominant = detectEol(originalText);
  const matched = alignEndings(original, patchedLines);
  const parts: string[] = [];
  for (let index = 0; index < patchedLines.length; index++) {
    const text = patchedLines[index] ?? '';
    const ending = endingFor(matched[index], index === patchedLines.length - 1, noNewline, dominant);
    parts.push(`${text}${ending}`);
  }
  return parts.join('');
}
