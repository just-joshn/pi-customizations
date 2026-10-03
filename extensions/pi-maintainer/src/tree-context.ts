/**
 * Renders the marked-line excerpt shown to the model: the lines of interest,
 * their enclosing scope headers, and context padding, in the exact format of
 * the reference TreeContext configuration (line numbers, margin 0, loi pad 3,
 * no child context, no last line, no top-of-file parent scope).
 */

import type { ParsedNode, ParsedTree } from './types.ts';

type HeaderSpan = readonly [size: number, start: number, end: number];

export interface ScopeIndex {
  readonly scopes: ReadonlyArray<ReadonlySet<number>>;
  readonly headers: ReadonlyArray<readonly HeaderSpan[]>;
}

function walkTree(root: ParsedNode, lineCount: number): ScopeIndex {
  const scopes: Array<Set<number>> = Array.from({ length: lineCount + 1 }, () => new Set<number>());
  const headers: Array<Array<HeaderSpan>> = Array.from({ length: lineCount + 1 }, () => []);
  const stack: ParsedNode[] = [root];
  for (;;) {
    const node = stack.pop();
    if (node === undefined) break;
    const startLine = node.startPosition.row;
    const endLine = node.endPosition.row;
    if (endLine > startLine) headers[startLine]?.push([endLine - startLine, startLine, endLine]);
    for (let line = startLine; line <= Math.min(endLine, lineCount); line += 1) {
      scopes[line]?.add(startLine);
    }
    for (const child of node.children) {
      if (child !== null) stack.push(child);
    }
  }
  return { scopes, headers };
}

function resolveHeaderSpans(scopeIndex: ScopeIndex, headerMax: number): ReadonlyArray<readonly [number, number]> {
  return scopeIndex.headers.map((spans, line) => {
    const smallest = [...spans].sort((a, b) => a[0] - b[0])[0];
    if (smallest === undefined) return [line, line + 1] as const;
    const [size, headStart, headEnd] = smallest;
    const clampedEnd = size > headerMax ? headStart + headerMax : headEnd;
    return [headStart, clampedEnd] as const;
  });
}

function padLinesOfInterest(lois: ReadonlySet<number>, lineCount: number, pad: number): Set<number> {
  const show = new Set<number>(lois);
  for (const line of lois) {
    for (let neighbor = line - pad; neighbor <= line + pad; neighbor += 1) {
      if (neighbor >= 0 && neighbor < lineCount) show.add(neighbor);
    }
  }
  return show;
}

function addParentScopes(show: Set<number>, lois: ReadonlySet<number>, scopeIndex: ScopeIndex, headers: ReadonlyArray<readonly [number, number]>, showTopOfScope: boolean): void {
  const done = new Set<number>();
  const queue = [...lois];
  for (;;) {
    const line = queue.shift();
    if (line === undefined) break;
    if (done.has(line) || line >= scopeIndex.scopes.length) continue;
    done.add(line);
    for (const scopeStart of scopeIndex.scopes[line] ?? []) {
      const [headStart, headEnd] = headers[scopeStart] ?? [scopeStart, scopeStart + 1];
      if (headStart > 0 || showTopOfScope) {
        for (let shown = headStart; shown < headEnd; shown += 1) show.add(shown);
      }
    }
  }
}

function closeSmallGaps(show: Set<number>, lines: readonly string[]): Set<number> {
  const closed = new Set<number>(show);
  const ordered = [...show].sort((a, b) => a - b);
  for (const [index, current] of ordered.entries()) {
    const next = ordered[index + 1];
    if (next !== undefined && next - current === 2) closed.add(current + 1);
  }
  for (const [line, text] of lines.entries()) {
    if (!closed.has(line)) continue;
    const next = lines[line + 1];
    if (text.trim().length > 0 && next !== undefined && next.trim() === '') closed.add(line + 1);
  }
  return closed;
}

function formatExcerpt(lines: readonly string[], show: ReadonlySet<number>, lois: ReadonlySet<number>): string {
  if (show.size === 0) return '';
  let output = '';
  let dots = !show.has(0);
  for (let line = 0; line < lines.length; line += 1) {
    if (!show.has(line)) {
      if (dots) {
        output += '...⋮...\n';
        dots = false;
      }
      continue;
    }
    const spacer = lois.has(line) ? '█' : '│';
    output += `${String(line + 1).padStart(3)}${spacer}${lines[line] ?? ''}\n`;
    dots = true;
  }
  return output;
}

export interface TreeContextInput {
  readonly code: string;
  readonly lineNums: readonly number[];
  readonly parse: (code: string) => ParsedTree | null;
}

export function treeContextExcerpt(input: TreeContextInput): string {
  const lines = splitLines(input.code);
  const tree = input.parse(input.code);
  if (tree === null) throw new Error('tree-sitter parse failed');
  const scopeIndex = walkTree(tree.rootNode, lines.length);
  const headers = resolveHeaderSpans(scopeIndex, 10);
  const lois = new Set<number>(input.lineNums);
  let show = padLinesOfInterest(lois, lines.length + 1, 3);
  addParentScopes(show, lois, scopeIndex, headers, false);
  show = closeSmallGaps(show, lines);
  return formatExcerpt(lines, show, lois);
}

/** The full excerpt block: heading, filename, and the marked excerpt. */
export function renderTreeContext(fname: string, code: string, lineNums: readonly number[], parse: (code: string) => ParsedTree | null): string {
  const excerpt = treeContextExcerpt({ code, lineNums, parse });
  const plural = new Set(lineNums).size > 1 ? 's' : '';
  return `## See relevant line${plural} below marked with █.\n\n${fname}:\n${excerpt}`;
}

function splitLines(code: string): string[] {
  const lines = code.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
