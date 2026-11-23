/** Patch parsing and application. Two formats are accepted: a multi-file patch with `***` directives, and a unified diff. */

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
      if (current.lastMarker === '+') {
        current.noNewlineAtEnd = true;
      }
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
        current.lastMarker = '+';
        continue;
      }
      throw new PatchError(`added file ${current.path} contains a line that does not start with +`);
    }
    if (line === '') {
      hunk ??= { oldLines: [], newLines: [] };
      hunk.oldLines.push('');
      hunk.newLines.push('');
      current.lastMarker = ' ';
      continue;
    }
    const marker = line[0];
    const body = line.slice(1);
    if (marker === ' ') {
      hunk ??= { oldLines: [], newLines: [] };
      hunk.oldLines.push(body);
      hunk.newLines.push(body);
      current.lastMarker = ' ';
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
      current.lastMarker = '+';
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
          current.lastMarker = ' ';
        }
      }
      index++;
      continue;
    }
    if (line.startsWith('\\')) {
      if (current !== undefined && current.lastMarker === '+') {
        current.noNewlineAtEnd = true;
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
      current.lastMarker = ' ';
    } else if (marker === '-') {
      hunk.oldLines.push(body);
      current.lastMarker = '-';
    } else if (marker === '+') {
      hunk.newLines.push(body);
      current.lastMarker = '+';
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

export function splitLines(text: string): string[] {
  if (text === '') {
    return [];
  }
  const normalized = text.replaceAll('\r\n', '\n');
  const lines = normalized.split('\n');
  if (normalized.endsWith('\n')) {
    lines.pop();
  }
  return lines;
}
