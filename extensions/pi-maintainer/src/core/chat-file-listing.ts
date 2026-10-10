import { resolve } from 'node:path';

import { pythonSorted } from '../support/python-sort.ts';
import type { ChatFiles } from './chat-files.ts';
import { getRelFname, inchatRelativeFiles } from './chat-files.ts';

export interface FormatFilesForInput {
  readonly relFnames: readonly string[];
  readonly relReadOnlyFnames: readonly string[];
  readonly pretty: boolean;
  readonly root: string;
  /** Rich Console width when `force_terminal=False` (default 80). */
  readonly columnsWidth?: number;
}

/** Rich `Columns` row-first layout used by Aider's pretty file listing. */
function formatColumns(items: readonly string[], width: number): string {
  if (!items.length) return '';
  const maxLen = Math.max(...items.map((item) => item.length));
  const cols = Math.max(1, Math.min(items.length, Math.floor((width + 1) / (maxLen + 1))));
  const colWidths = Array.from({ length: cols }, (_, column) => {
    let widest = 0;
    for (let index = column; index < items.length; index += cols) widest = Math.max(widest, items[index]?.length ?? 0);
    return widest;
  });
  const fullWidth = colWidths.reduce((sum, columnWidth) => sum + columnWidth, 0) + (cols - 1);
  const lines: string[] = [];
  for (let start = 0; start < items.length; start += cols) {
    const row = items.slice(start, start + cols);
    let line = '';
    for (let column = 0; column < row.length; column += 1) {
      const cell = row[column] ?? '';
      line += `${column === 0 ? '' : ' '}${cell.padEnd(colWidths[column] ?? cell.length)}`;
    }
    lines.push(line.padEnd(fullWidth));
  }
  return `${lines.join('\n')}\n`;
}

function shortReadonlyPath(root: string, relPath: string): string {
  const absPath = resolve(root, relPath);
  return absPath.length < relPath.length ? absPath : relPath;
}

/** Aider `InputOutput.format_files_for_input`. */
export function formatFilesForInput(input: FormatFilesForInput): string {
  const readOnlySet = new Set(input.relReadOnlyFnames);
  const readOnlySorted = pythonSorted(input.relReadOnlyFnames);
  const editableSorted = pythonSorted(input.relFnames).filter((path) => !readOnlySet.has(path));

  if (!input.pretty) {
    const lines = [...readOnlySorted.map((path) => `${path} (read only)`), ...editableSorted];
    return `${lines.join('\n')}\n`;
  }

  const width = input.columnsWidth ?? 80;
  const parts: string[] = [];
  let readOnlyLines = 0;
  if (readOnlySorted.length) {
    const readOnlyBlock = formatColumns(['Readonly:', ...readOnlySorted.map((path) => shortReadonlyPath(input.root, path))], width);
    readOnlyLines = readOnlyBlock.split('\n').filter((line) => line.length > 0).length;
    parts.push(readOnlyBlock.replace(/\n$/, ''));
  }
  if (editableSorted.length) {
    const editableItems = readOnlySorted.length ? ['Editable:', ...editableSorted] : editableSorted;
    const editableBlock = formatColumns(editableItems, width);
    const editableLines = editableBlock.split('\n').filter((line) => line.length > 0).length;
    if (readOnlySorted.length && (readOnlyLines > 1 || editableLines > 1)) parts.push('');
    parts.push(editableBlock.replace(/\n$/, ''));
  }
  return parts.length ? `${parts.join('\n')}\n` : '';
}

/** Paths Aider passes to `get_input` / `format_files_for_input`. */
export function chatListingPaths(root: string, files: ChatFiles): { readonly relFnames: string[]; readonly relReadOnlyFnames: string[] } {
  const inchat = inchatRelativeFiles(root, files);
  const relReadOnlyFnames = [...files.readOnly].map((path) => getRelFname(root, path));
  return {
    relFnames: pythonSorted(new Set([...inchat, ...relReadOnlyFnames])),
    relReadOnlyFnames,
  };
}
