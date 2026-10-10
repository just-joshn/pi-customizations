/**
 * Aider's unified-diff edit format (`udiff`, and `udiff-simple`, which differs only in its
 * prompts), ported from `aider/coders/udiff_coder.py` with its function boundaries.
 */
import { unifiedDiff } from '../support/difflib.ts';
import { IndexError } from '../support/pybuiltins.ts';
import { count, pyLength, splitlines, strip } from '../support/pystr.ts';
import type { ChatFiles } from './coder-paths.ts';
import { SearchTextNotUnique, ValueError } from './errors.ts';
import { allPreprocs, diffLines, flexibleSearchAndReplace, searchAndReplace } from './search-replace.ts';
import type { WorkingTree } from './working-tree.ts';

/** One parsed hunk: relative path (or null before inheritance) and unified-diff body lines. */
export type UdiffEdit = readonly [path: string | null, hunk: readonly string[]];

/** The `UnifiedDiffCoder` attributes that its methods read. */
export interface UdiffContext extends ChatFiles {
  readonly absRootPath: (path: string) => string;
  readonly tree: Pick<WorkingTree, 'read' | 'write' | 'exists' | 'touch'>;
}

const noMatchError = `UnifiedDiffNoMatch: hunk failed to apply!

{path} does not contain lines that match the diff you provided!
Try again.
DO NOT skip blank lines, comments, docstrings, etc!
The diff needs to apply cleanly to the lines in {path}!

{path} does not contain these {num_lines} exact lines in a row:
\`\`\`
{original}\`\`\`
`;

const notUniqueError = `UnifiedDiffNotUnique: hunk failed to apply!

{path} contains multiple sets of lines that match the diff you provided!
Try again.
Use additional \` \` lines to provide context that uniquely indicates which code needs to be changed.
The diff needs to apply to a unique set of lines in {path}!

{path} contains multiple copies of these {num_lines} lines:
\`\`\`
{original}\`\`\`
`;

const otherHunksApplied = 'Note: some hunks did apply successfully. See the updated source code shown above.\n\n';

function formatError(template: string, path: string, original: string): string {
  return template
    .replaceAll('{path}', path)
    .replaceAll('{original}', original)
    .replaceAll('{num_lines}', String(splitlines(original).length));
}

/** Split a hunk into before/after texts, or line arrays when `lines` is true. */
export function hunkToBeforeAfter(hunk: readonly string[], lines: true): readonly [before: string[], after: string[]];
export function hunkToBeforeAfter(hunk: readonly string[], lines?: false): readonly [before: string, after: string];
export function hunkToBeforeAfter(hunk: readonly string[], lines = false): readonly [string[] | string, string[] | string] {
  const before: string[] = [];
  const after: string[] = [];
  for (const raw of hunk) {
    let op = ' ';
    let line = raw;
    if (raw.length >= 2) {
      op = raw[0] ?? ' ';
      line = raw.slice(1);
    }
    if (op === ' ') {
      before.push(line);
      after.push(line);
    } else if (op === '-') before.push(line);
    else if (op === '+') after.push(line);
  }
  return lines ? [before, after] : [before.join(''), after.join('')];
}

/** Whitespace-only lines keep only their line ending, then the hunk is rebuilt via unified_diff. */
export function cleanupPureWhitespaceLines(lines: readonly string[]): string[] {
  return lines.map((line) => {
    if (strip(line)) return line;
    // Aider indexes with `line[-n]`; for an empty line n is 0, and Python's `line[0]` raises.
    const endingWidth = line.length - rstripNewlines(line).length;
    if (endingWidth === 0) {
      if (line.length === 0) throw new IndexError('string index out of range');
      return '';
    }
    return line.slice(-endingWidth);
  });
}

function rstripNewlines(line: string): string {
  let end = line.length;
  while (end > 0 && (line[end - 1] === '\n' || line[end - 1] === '\r')) end -= 1;
  return line.slice(0, end);
}

export function normalizeHunk(hunk: readonly string[]): string[] {
  let [before, after] = hunkToBeforeAfter(hunk, true);
  before = cleanupPureWhitespaceLines(before);
  after = cleanupPureWhitespaceLines(after);
  return unifiedDiff(before, after, { n: Math.max(before.length, after.length) }).slice(3);
}

export function processFencedBlock(lines: readonly string[], startLineNum: number): readonly [nextLine: number, edits: UdiffEdit[]] {
  let lineNum = startLineNum;
  for (; lineNum < lines.length; lineNum += 1) {
    if ((lines[lineNum] ?? '').startsWith('```')) break;
  }
  const block = [...lines.slice(startLineNum, lineNum), '@@ @@'];
  let fname: string | null = null;
  let body = block;
  if ((block[0] ?? '').startsWith('--- ') && (block[1] ?? '').startsWith('+++ ')) {
    const aFname = strip((block[0] ?? '').slice(4));
    const bFname = strip((block[1] ?? '').slice(4));
    fname = (aFname.startsWith('a/') || aFname === '/dev/null') && bFname.startsWith('b/') ? bFname.slice(2) : bFname;
    body = block.slice(2);
  }
  const edits: UdiffEdit[] = [];
  let keeper = false;
  let hunk: string[] = [];
  for (const line of body) {
    hunk = [...hunk, line];
    if (line.length < 2) continue;
    if (line.startsWith('+++ ') && (hunk.at(-2) ?? '').startsWith('--- ')) {
      hunk = (hunk.at(-3) ?? '') === '\n' ? hunk.slice(0, -3) : hunk.slice(0, -2);
      edits.push([fname, hunk]);
      hunk = [];
      keeper = false;
      fname = strip(line.slice(4));
      continue;
    }
    const op = line[0] ?? ' ';
    if (op === '-' || op === '+') {
      keeper = true;
      continue;
    }
    if (op !== '@') continue;
    if (!keeper) {
      hunk = [];
      continue;
    }
    hunk = hunk.slice(0, -1);
    edits.push([fname, hunk]);
    hunk = [];
    keeper = false;
  }
  return [lineNum + 1, edits];
}

/** Parse ```diff fenced blocks from a model reply into path/hunk pairs. */
export function findDiffs(content: string): UdiffEdit[] {
  const text = content.endsWith('\n') ? content : `${content}\n`;
  const lines = splitlines(text, true);
  const edits: UdiffEdit[] = [];
  let lineNum = 0;
  while (lineNum < lines.length) {
    while (lineNum < lines.length) {
      if ((lines[lineNum] ?? '').startsWith('```diff')) {
        const [next, these] = processFencedBlock(lines, lineNum + 1);
        edits.push(...these);
        lineNum = next;
        break;
      }
      lineNum += 1;
    }
  }
  return edits;
}

/** `UnifiedDiffCoder.get_edits`: parse fences and inherit the last seen path. */
export function getEdits(content: string): UdiffEdit[] {
  const edits: UdiffEdit[] = [];
  let lastPath: string | null = null;
  for (const [path, hunk] of findDiffs(content)) {
    const resolved = path || lastPath;
    if (path) lastPath = path;
    edits.push([resolved, hunk]);
  }
  return edits;
}

function flexiJustSearchAndReplace(texts: readonly [string, string, string]): string | undefined {
  return flexibleSearchAndReplace(texts, [[searchAndReplace, allPreprocs]]);
}

export function directlyApplyHunk(content: string, hunk: readonly string[]): string | undefined {
  const [before] = hunkToBeforeAfter(hunk);
  if (!before) return undefined;
  const [beforeLines] = hunkToBeforeAfter(hunk, true);
  const beforeStripped = beforeLines.map((line) => strip(line)).join('');
  if (pyLength(beforeStripped) < 10 && count(content, before) > 1) return undefined;
  try {
    return flexiJustSearchAndReplace([before, hunkToBeforeAfter(hunk)[1], content]);
  } catch (error) {
    if (error instanceof SearchTextNotUnique) return undefined;
    throw error;
  }
}

export function makeNewLinesExplicit(content: string, hunk: readonly string[]): readonly string[] {
  const [before, after] = hunkToBeforeAfter(hunk);
  const backDiff = diffLines(before, content).filter((line) => line[0] !== '+');
  const newBefore = directlyApplyHunk(before, backDiff);
  if (!newBefore) return hunk;
  if (pyLength(strip(newBefore)) < 10) return hunk;
  const beforeLines = splitlines(before, true);
  const newBeforeLines = splitlines(newBefore, true);
  const afterLines = splitlines(after, true);
  if (newBeforeLines.length < beforeLines.length * 0.66) return hunk;
  return unifiedDiff(newBeforeLines, afterLines, { n: Math.max(newBeforeLines.length, afterLines.length) }).slice(3);
}

export function applyPartialHunk(content: string, precedingContext: readonly string[], changes: readonly string[], followingContext: readonly string[]): string | undefined {
  const lenPrec = precedingContext.length;
  const lenFoll = followingContext.length;
  const useAll = lenPrec + lenFoll;
  for (let drop = 0; drop <= useAll; drop += 1) {
    const use = useAll - drop;
    for (let usePrec = lenPrec; usePrec >= 0; usePrec -= 1) {
      if (usePrec > use) continue;
      const useFoll = use - usePrec;
      if (useFoll > lenFoll) continue;
      const thisPrec = usePrec ? precedingContext.slice(-usePrec) : [];
      const thisFoll = followingContext.slice(0, useFoll);
      const res = directlyApplyHunk(content, [...thisPrec, ...changes, ...thisFoll]);
      if (res) return res;
    }
  }
  return undefined;
}

export function applyHunk(content: string, hunk: readonly string[]): string | undefined {
  const direct = directlyApplyHunk(content, hunk);
  if (direct) return direct;
  const explicit = makeNewLinesExplicit(content, hunk);
  let ops = explicit.map((line) => line[0] ?? ' ').join('');
  ops = ops.replaceAll('-', 'x').replaceAll('+', 'x').replaceAll('\n', ' ');
  let curOp = ' ';
  let section: string[] = [];
  const sections: string[][] = [];
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i] ?? ' ';
    if (op !== curOp) {
      sections.push(section);
      section = [];
      curOp = op;
    }
    section.push(explicit[i] ?? '');
  }
  sections.push(section);
  if (curOp !== ' ') sections.push([]);
  let current = content;
  for (let i = 2; i < sections.length; i += 2) {
    const precedingContext = sections[i - 2] ?? [];
    const changes = sections[i - 1] ?? [];
    const followingContext = sections[i] ?? [];
    const res = applyPartialHunk(current, precedingContext, changes, followingContext);
    if (!res) return undefined;
    current = res;
  }
  return current;
}

/** Apply one hunk to `content`, creating `fname` when before-text is blank and the file is missing. */
export async function doReplace(fname: string, content: string | null, hunk: readonly string[], tree: Pick<WorkingTree, 'exists' | 'touch'>): Promise<string | undefined> {
  const [beforeText, afterText] = hunkToBeforeAfter(hunk);
  let current = content;
  if (!(await tree.exists(fname)) && !strip(beforeText)) {
    await tree.touch(fname);
    current = '';
  }
  if (current === null) return undefined;
  if (!strip(beforeText)) return current + afterText;
  return applyHunk(current, hunk);
}

function uniqueEdits(edits: readonly UdiffEdit[]): UdiffEdit[] {
  const seen = new Set<string>();
  const uniq: UdiffEdit[] = [];
  for (const [path, rawHunk] of edits) {
    const hunk = normalizeHunk(rawHunk);
    if (hunk.length === 0) continue;
    const key = [`${path}\n`, ...hunk].join('');
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push([path, hunk]);
  }
  return uniq;
}

/** Normalize and dedupe without writing, as `withPlan` preflight expects. */
export async function applyEditsDryRun(edits: readonly UdiffEdit[]): Promise<UdiffEdit[]> {
  return uniqueEdits(edits);
}

async function writeHunk(path: string, hunk: readonly string[], ctx: UdiffContext): Promise<string | null> {
  const fullPath = ctx.absRootPath(path);
  const [original] = hunkToBeforeAfter(hunk);
  try {
    const next = await doReplace(fullPath, await ctx.tree.read(fullPath), hunk, ctx.tree);
    if (!next) return formatError(noMatchError, path, original);
    await ctx.tree.write(fullPath, next);
    return null;
  } catch (error) {
    if (error instanceof SearchTextNotUnique) return formatError(notUniqueError, path, original);
    throw error;
  }
}

/**
 * `UnifiedDiffCoder.apply_edits`: writes each matching hunk in order, then throws `ValueError`
 * with Aider's failure report when any hunk failed. Successful writes stay.
 */
export async function applyEdits(edits: readonly UdiffEdit[], ctx: UdiffContext): Promise<void> {
  const uniq = uniqueEdits(edits);
  const errors: string[] = [];
  for (const [path, hunk] of uniq) {
    if (path === null) continue;
    const error = await writeHunk(path, hunk, ctx);
    if (error) errors.push(error);
  }
  if (errors.length === 0) return;
  let message = errors.join('\n\n');
  // Aider compares the joined error string's character length to the hunk count
  // (`len(errors) < len(uniq)` after `errors = "\n\n".join(errors)`), so the note almost never appears.
  if (message.length < uniq.length) message += otherHunksApplied;
  throw new ValueError(message);
}
