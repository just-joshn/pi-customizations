import { rstrip, splitlines, strip } from '../support/pystr.ts';
import { DiffError } from './errors.ts';
import type { Chunk } from './patch.ts';

/** Action headers need the space after the colon. Section terminators match without it. */
export const HEADER = { update: '*** Update File: ', delete: '*** Delete File: ', add: '*** Add File: ', moveTo: '*** Move to: ' } as const;

const SECTION_TERMINATORS = ['@@', '*** End Patch', '*** Update File:', '*** Delete File:', '*** Add File:', '*** End of File'];

export type ContextMatch = readonly [index: number, fuzz: number];

export type Section = readonly [contextLines: readonly string[], chunks: readonly Chunk[], nextIndex: number, isEof: boolean];

type Mode = 'keep' | 'add' | 'delete';

const CONTEXT_PASSES: readonly (readonly [normalize: (line: string) => string, fuzz: number])[] = [
  [(line) => line, 0],
  [(line) => rstrip(line), 1],
  [(line) => strip(line), 100],
];

export const norm = (line: string): string => rstrip(line, '\r');

export const sameLines = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((line, index) => line === right[index]);

function firstWindow(lines: readonly string[], context: readonly string[], start: number): number {
  for (let index = start; index < lines.length - context.length + 1; index += 1) {
    if (sameLines(lines.slice(index, index + context.length), context)) return index;
  }
  return -1;
}

export function findContextCore(lines: readonly string[], context: readonly string[], start: number): ContextMatch {
  if (context.length === 0) return [start, 0];
  for (const [normalize, fuzz] of CONTEXT_PASSES) {
    const index = firstWindow(lines.map(normalize), context.map(normalize), start);
    if (index !== -1) return [index, fuzz];
  }
  return [-1, 0];
}

export function findContext(lines: readonly string[], context: readonly string[], start: number, eof: boolean): ContextMatch {
  if (!eof) return findContextCore(lines, context, start);
  if (lines.length >= context.length) {
    const [newIndex, fuzz] = findContextCore(lines, context, lines.length - context.length);
    if (newIndex !== -1) return [newIndex, fuzz];
  }
  const [newIndex, fuzz] = findContextCore(lines, context, start);
  return [newIndex, fuzz + 10_000];
}

function endsSection(line: string): boolean {
  const normLine = norm(line);
  if (SECTION_TERMINATORS.some((prefix) => normLine.startsWith(prefix)) || normLine === '***') return true;
  if (normLine.startsWith('***')) throw new DiffError(`Invalid patch line found in update section: ${line}`);
  return false;
}

function sectionLine(line: string): readonly [mode: Mode, content: string] {
  if (line.startsWith('+')) return ['add', line.slice(1)];
  if (line.startsWith('-')) return ['delete', line.slice(1)];
  if (line.startsWith(' ')) return ['keep', line.slice(1)];
  if (strip(line) === '') return ['keep', ''];
  throw new DiffError(`Invalid line prefix in update section: ${line}`);
}

export function peekNextSection(lines: readonly string[], start: number): Section {
  const contextLines: string[] = [];
  const chunks: Chunk[] = [];
  let delLines: string[] = [];
  let insLines: string[] = [];
  let mode: Mode = 'keep';
  const flush = (): void => {
    if (delLines.length > 0 || insLines.length > 0) chunks.push({ origIndex: contextLines.length - delLines.length, delLines, insLines });
    delLines = [];
    insLines = [];
  };
  let index = start;
  for (; index < lines.length && !endsSection(lines[index] ?? ''); index += 1) {
    const lastMode = mode;
    const [lineMode, content] = sectionLine(lines[index] ?? '');
    mode = lineMode;
    if (mode === 'keep' && lastMode !== 'keep') flush();
    if (mode === 'delete') {
      delLines.push(content);
      contextLines.push(content);
    } else if (mode === 'add') insLines.push(content);
    else contextLines.push(content);
  }
  flush();
  const isEof = index < lines.length && norm(lines[index] ?? '') === '*** End of File';
  const nextIndex = isEof ? index + 1 : index;
  if (nextIndex === start && !isEof) throw new DiffError('Empty patch section found.');
  return [contextLines, chunks, nextIndex, isEof];
}

/** Aider returns a set, whose order varies with the hash seed. First appearance is the stable order. */
export function identifyFilesNeeded(text: string): string[] {
  const paths = new Set<string>();
  for (const line of splitlines(text)) {
    const normLine = norm(line);
    if (normLine.startsWith(HEADER.update)) paths.add(strip(normLine.slice(HEADER.update.length)));
    else if (normLine.startsWith(HEADER.delete)) paths.add(strip(normLine.slice(HEADER.delete.length)));
  }
  return [...paths];
}
