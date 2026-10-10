import { dirname } from 'node:path';

import { splitlines, strip } from '../support/pystr.ts';
import { DiffError, ValueError } from './errors.ts';
import type { ActionType, EditResult, PatchAction, PatchContext } from './patch.ts';
import { norm, sameLines } from './patch-sections.ts';

type AddAction = Extract<PatchAction, { type: 'Add' }>;
type DeleteAction = Extract<PatchAction, { type: 'Delete' }>;
type UpdateAction = Extract<PatchAction, { type: 'Update' }>;

/** Python 3.11+ formats a `str, Enum` member as `ActionType.ADD` in an f-string, not as its value. */
const ACTION_TYPE_STR: Readonly<Record<ActionType, string>> = { Add: 'ActionType.ADD', Delete: 'ActionType.DELETE', Update: 'ActionType.UPDATE' };

/** Node's system errors carry an errno, as Python's `OSError` does. */
const isOSError = (error: unknown): error is Error => error instanceof Error && 'errno' in error && typeof error.errno === 'number';

const stripped = (line: string): string => strip(norm(line));

function mismatch(path: string, start: number, expected: readonly string[], actual: readonly string[]): DiffError {
  const expectedStr = expected.map((line) => `- ${line}`).join('\n');
  const actualStr = actual.map((line) => `  ${line}`).join('\n');
  return new DiffError(`${path}: Mismatch applying patch near line ${start + 1}.\nExpected lines to remove:\n${expectedStr}\nFound lines in file:\n${actualStr}`);
}

function applyUpdate(text: string, action: UpdateAction, path: string): string {
  const origLines = splitlines(text);
  const segments: (readonly string[])[] = [];
  let currentOrigLineIdx = 0;
  for (const chunk of action.chunks.toSorted((left, right) => left.origIndex - right.origIndex)) {
    const chunkStartIndex = chunk.origIndex;
    if (chunkStartIndex < currentOrigLineIdx) throw new DiffError(`${path}: Overlapping or out-of-order chunk detected. Current index ${currentOrigLineIdx}, chunk starts at ${chunkStartIndex}.`);
    segments.push(origLines.slice(currentOrigLineIdx, chunkStartIndex));
    const actualDeletedLines = origLines.slice(chunkStartIndex, chunkStartIndex + chunk.delLines.length);
    if (!sameLines(chunk.delLines.map(stripped), actualDeletedLines.map(stripped))) throw mismatch(path, chunkStartIndex, chunk.delLines, actualDeletedLines);
    segments.push(chunk.insLines);
    currentOrigLineIdx = chunkStartIndex + chunk.delLines.length;
  }
  segments.push(origLines.slice(currentOrigLineIdx));
  const result = segments.flat().join('\n');
  if (result || origLines.length > 0) return `${result}\n`;
  return result;
}

async function addFile(action: AddAction, fullPath: string, { io, tree }: PatchContext): Promise<void> {
  if (await tree.exists(fullPath)) throw new DiffError(`ADD Error: File already exists: ${action.path}`);
  io.output(`Adding ${action.path}`);
  await tree.mkdir(dirname(fullPath));
  await tree.write(fullPath, action.newContent.endsWith('\n') ? action.newContent : `${action.newContent}\n`);
}

async function deleteFile(action: DeleteAction, fullPath: string, { io, tree }: PatchContext): Promise<void> {
  io.output(`Deleting ${action.path}`);
  if (await tree.exists(fullPath)) await tree.remove(fullPath);
  else io.warning(`DELETE Warning: File not found, skipping: ${action.path}`);
}

async function updateFile(action: UpdateAction, fullPath: string, { absRootPath, io, tree }: PatchContext): Promise<void> {
  if (!(await tree.exists(fullPath))) throw new DiffError(`UPDATE Error: File does not exist: ${action.path}`);
  const currentContent = await tree.read(fullPath);
  if (currentContent === null) throw new DiffError(`Could not read file for UPDATE: ${action.path}`);
  const newContent = applyUpdate(currentContent, action, action.path);
  const targetFullPath = action.movePath ? absRootPath(action.movePath) : fullPath;
  if (action.movePath) {
    io.output(`Updating and moving ${action.path} to ${action.movePath}`);
    if ((await tree.exists(targetFullPath)) && fullPath !== targetFullPath) io.warning(`UPDATE Warning: Target file for move already exists, overwriting: ${action.movePath}`);
  } else io.output(`Updating ${action.path}`);
  await tree.mkdir(dirname(targetFullPath));
  await tree.write(targetFullPath, newContent);
  if (action.movePath && fullPath !== targetFullPath) await tree.remove(fullPath);
}

function applyAction(action: PatchAction, fullPath: string, ctx: PatchContext): Promise<void> {
  switch (action.type) {
    case 'Add':
      return addFile(action, fullPath, ctx);
    case 'Delete':
      return deleteFile(action, fullPath, ctx);
    case 'Update':
      return updateFile(action, fullPath, ctx);
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

function applyFailure(action: PatchAction, error: unknown): ValueError {
  const actionType = ACTION_TYPE_STR[action.type];
  if (error instanceof DiffError || isOSError(error)) return new ValueError(`Error applying action '${actionType}' to ${action.path}: ${error.message}`);
  return new ValueError(`Unexpected error applying action '${actionType}' to ${action.path}: ${error instanceof Error ? error.message : String(error)}`);
}

export async function applyEdits(edits: readonly EditResult[], ctx: PatchContext): Promise<void> {
  for (const [, action] of edits) {
    const fullPath = ctx.absRootPath(action.path);
    try {
      await applyAction(action, fullPath, ctx);
    } catch (error) {
      throw applyFailure(action, error);
    }
  }
}
