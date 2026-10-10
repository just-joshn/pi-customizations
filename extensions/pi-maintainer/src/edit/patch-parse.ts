import { splitlines, strip } from '../support/pystr.ts';
import { DiffError } from './errors.ts';
import type { Chunk, Patch, PatchAction, PatchContext } from './patch.ts';
import { findContext, HEADER, norm, peekNextSection } from './patch-sections.ts';

const ACTION_TERMINATORS = ['*** End Patch', '*** Update File:', '*** Delete File:', '*** Add File:'];

type UpdateAction = Extract<PatchAction, { type: 'Update' }>;

interface ParseState {
  readonly actions: ReadonlyMap<string, PatchAction>;
  readonly fuzz: number;
  readonly index: number;
}

const endsAction = (line: string): boolean => ACTION_TERMINATORS.some((prefix) => norm(line).startsWith(prefix));

function withAction(state: ParseState, action: PatchAction, index: number, fuzz = 0): ParseState {
  return { actions: new Map(state.actions).set(action.path, action), fuzz: state.fuzz + fuzz, index };
}

function readScopeLines(lines: readonly string[], start: number): readonly [scopeLines: string[], index: number] {
  const scopeLines: string[] = [];
  let index = start;
  for (; index < lines.length && norm(lines[index] ?? '').startsWith('@@'); index += 1) {
    const scope = strip((lines[index] ?? '').slice('@@'.length));
    if (scope) scopeLines.push(scope);
  }
  return [scopeLines, index];
}

/**
 * Aider follows this pass with a whitespace-insensitive one worth one fuzz point. Both compare
 * the same already-stripped scope text, so the second pass can never match where this one failed.
 */
function findScope(origLines: readonly string[], scopeLines: readonly string[], from: number): number {
  for (let tempIndex = from; tempIndex < origLines.length; tempIndex += 1) {
    const matches = scopeLines.every((scope, offset) => tempIndex + offset < origLines.length && strip(norm(origLines[tempIndex + offset] ?? '')) === scope);
    if (matches) return tempIndex + scopeLines.length;
  }
  throw new DiffError(`Could not find scope context:\n${scopeLines.join('\n')}`);
}

function parseUpdateFileSections(lines: readonly string[], start: number, fileContent: string): readonly [chunks: readonly Chunk[], index: number, fuzz: number] {
  const origLines = splitlines(fileContent);
  const chunks: Chunk[] = [];
  let index = start;
  let currentFileIndex = 0;
  let totalFuzz = 0;
  while (index < lines.length && !endsAction(lines[index] ?? '')) {
    const [scopeLines, sectionStart] = readScopeLines(lines, index);
    if (scopeLines.length > 0) currentFileIndex = findScope(origLines, scopeLines, currentFileIndex);
    const [contextBlock, sectionChunks, nextIndex, isEof] = peekNextSection(lines, sectionStart);
    const [foundIndex, fuzz] = findContext(origLines, contextBlock, currentFileIndex, isEof);
    totalFuzz += fuzz;
    if (foundIndex === -1) {
      const marker = isEof ? '*** End of File' : '';
      throw new DiffError(`Could not find patch context ${marker} starting near line ${currentFileIndex}:\n${contextBlock.join('\n')}`);
    }
    for (const chunk of sectionChunks) chunks.push({ ...chunk, origIndex: chunk.origIndex + foundIndex });
    currentFileIndex = foundIndex + contextBlock.length;
    index = nextIndex;
  }
  return [chunks, index, totalFuzz];
}

function parseAddFileContent(lines: readonly string[], start: number): readonly [newContent: string, index: number] {
  const addedLines: string[] = [];
  let index = start;
  for (; index < lines.length && !endsAction(lines[index] ?? ''); index += 1) {
    const line = lines[index] ?? '';
    if (line.startsWith('+')) addedLines.push(line.slice(1));
    else if (strip(norm(line)) === '') addedLines.push('');
    else throw new DiffError(`Invalid Add File line (missing '+'): ${line}`);
  }
  return [addedLines.join('\n'), index];
}

function moveTarget(lines: readonly string[], index: number): readonly [movePath: string | null, index: number] {
  const normLine = norm(lines[index] ?? '');
  if (index >= lines.length || !normLine.startsWith(HEADER.moveTo)) return [null, index];
  const moveTo = strip(normLine.slice(HEADER.moveTo.length));
  if (!moveTo) throw new DiffError('Move to action missing path.');
  return [moveTo, index + 1];
}

function mergeUpdate(existing: UpdateAction, chunks: readonly Chunk[], moveTo: string | null): UpdateAction {
  if (moveTo && existing.movePath && existing.movePath !== moveTo) throw new DiffError(`Conflicting move targets for file: ${existing.path}`);
  return { ...existing, chunks: [...existing.chunks, ...chunks], movePath: moveTo ?? existing.movePath };
}

function parseUpdate(lines: readonly string[], path: string, state: ParseState, currentFiles: ReadonlyMap<string, string>): ParseState {
  if (!path) throw new DiffError('Update File action missing path.');
  const [moveTo, index] = moveTarget(lines, state.index);
  const fileContent = currentFiles.get(path);
  if (fileContent === undefined) throw new DiffError(`Update File Error - missing file content for: ${path}`);
  const existing = state.actions.get(path);
  if (existing !== undefined && existing.type !== 'Update') throw new DiffError(`Conflicting actions for file: ${path}`);
  const [chunks, nextIndex, fuzz] = parseUpdateFileSections(lines, index, fileContent);
  const action: UpdateAction = existing === undefined ? { type: 'Update', path, chunks, movePath: moveTo } : mergeUpdate(existing, chunks, moveTo);
  return withAction(state, action, nextIndex, fuzz);
}

function parseDelete(path: string, state: ParseState, currentFiles: ReadonlyMap<string, string>, io: PatchContext['io']): ParseState {
  if (!path) throw new DiffError('Delete File action missing path.');
  const existing = state.actions.get(path);
  if (existing !== undefined && existing.type !== 'Delete') throw new DiffError(`Conflicting actions for file: ${path}`);
  if (existing !== undefined) {
    io.warning(`Duplicate delete action for file: ${path} ignored.`);
    return state;
  }
  if (!currentFiles.has(path)) throw new DiffError(`Delete File Error - file not found: ${path}`);
  return withAction(state, { type: 'Delete', path }, state.index);
}

function parseAdd(lines: readonly string[], path: string, state: ParseState): ParseState {
  if (!path) throw new DiffError('Add File action missing path.');
  if (state.actions.has(path)) throw new DiffError(`Duplicate action for file: ${path}`);
  const [newContent, index] = parseAddFileContent(lines, state.index);
  return withAction(state, { type: 'Add', path, newContent }, index);
}

function parseLine(lines: readonly string[], line: string, after: ParseState, currentFiles: ReadonlyMap<string, string>, io: PatchContext['io']): ParseState {
  const normLine = norm(line);
  if (normLine.startsWith(HEADER.update)) return parseUpdate(lines, strip(normLine.slice(HEADER.update.length)), after, currentFiles);
  if (normLine.startsWith(HEADER.delete)) return parseDelete(strip(normLine.slice(HEADER.delete.length)), after, currentFiles, io);
  if (normLine.startsWith(HEADER.add)) return parseAdd(lines, strip(normLine.slice(HEADER.add.length)), after);
  if (!strip(normLine)) return after;
  throw new DiffError(`Unknown or misplaced line while parsing patch: ${line}`);
}

export function parsePatchText(lines: readonly string[], startIndex: number, currentFiles: ReadonlyMap<string, string>, io: PatchContext['io']): Patch {
  let state: ParseState = { actions: new Map(), fuzz: 0, index: startIndex };
  while (state.index < lines.length) {
    const line = lines[state.index] ?? '';
    if (norm(line) === '*** End Patch') break;
    state = parseLine(lines, line, { ...state, index: state.index + 1 }, currentFiles, io);
  }
  return { actions: state.actions, fuzz: state.fuzz };
}
