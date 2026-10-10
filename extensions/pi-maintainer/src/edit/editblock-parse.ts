/**
 * The reply parsing half of `aider/coders/editblock_coder.py`: SEARCH/REPLACE markers, filename
 * discovery, and suggested shell commands.
 */
import { basename } from 'node:path';

import { getCloseMatches } from '../support/difflib.ts';
import { PY_SPACE } from '../support/pyre.ts';
import { lstrip, rstrip, splitlines, strip } from '../support/pystr.ts';
import { ValueError } from './errors.ts';
import { defaultFence, type Fence } from './fences.ts';

export type { Fence } from './fences.ts';

export const DEFAULT_FENCE: Fence = defaultFence;

/** A SEARCH/REPLACE edit: the file it names, the SEARCH text, and the REPLACE text. */
export type EditBlock = readonly [path: string, original: string, updated: string];

/** A shell-language fence, which Aider offers to run instead of applying. */
export type ShellBlock = readonly [path: null, command: string];

export type ParsedBlock = EditBlock | ShellBlock;

const HEAD = new RegExp(`^<{5,9} SEARCH>?${PY_SPACE}*$`);
const DIVIDER = new RegExp(`^={5,9}${PY_SPACE}*$`);
const UPDATED = new RegExp(`^>{5,9} REPLACE${PY_SPACE}*$`);

const DIVIDER_ERR = '=======';
const UPDATED_ERR = '>>>>>>> REPLACE';

const missingFilenameErr = (fence: Fence): string => `Bad/missing filename. The filename must be alone on the line before the opening fence ${fence[0]}`;

/** Always be willing to treat triple-backticks as a fence when searching for filenames. */
const TRIPLE_BACKTICKS = '```';

const SHELL_STARTS = ['```bash', '```sh', '```shell', '```cmd', '```batch', '```powershell', '```ps1', '```zsh', '```fish', '```ksh', '```csh', '```tcsh'];

const isMarker = (pattern: RegExp, line: string | undefined): boolean => line !== undefined && pattern.test(strip(line));

export function stripFilename(filename: string, fence: Fence): string | null {
  let name = strip(filename);
  if (name === '...') return null;
  for (const start of [fence[0], TRIPLE_BACKTICKS]) {
    if (!name.startsWith(start)) continue;
    const candidate = name.slice(start.length);
    return candidate && (candidate.includes('.') || candidate.includes('/')) ? candidate : null;
  }
  name = rstrip(name, ':');
  name = lstrip(name, '#');
  name = strip(name);
  name = strip(name, '`');
  return strip(name, '*');
}

function bestFilename(filenames: readonly string[], validFnames: readonly string[]): string | null {
  const exact = filenames.find((fname) => validFnames.includes(fname));
  if (exact !== undefined) return exact;
  for (const fname of filenames) {
    const sameName = validFnames.find((vfn) => fname === basename(vfn));
    if (sameName !== undefined) return sameName;
  }
  for (const fname of filenames) {
    const closeMatches = getCloseMatches(fname, validFnames, { n: 1, cutoff: 0.8 });
    if (closeMatches.length === 1) return closeMatches[0] ?? null;
  }
  return filenames.find((fname) => fname.includes('.')) ?? filenames[0] ?? null;
}

/** Looks back through up to three lines, past fence lines, for the filename a block edits. */
export function findFilename(lines: readonly string[], fence: Fence, validFnames: readonly string[] | null): string | null {
  const filenames: string[] = [];
  for (const line of lines.toReversed().slice(0, 3)) {
    const filename = stripFilename(line, fence);
    if (filename) filenames.push(filename);
    if (!line.startsWith(fence[0]) && !line.startsWith(TRIPLE_BACKTICKS)) break;
  }
  if (filenames.length === 0) return null;
  return bestFilename(filenames, validFnames ?? []);
}

const malformed = (lines: readonly string[], i: number, err: string): ValueError => new ValueError(`${lines.slice(0, i + 1).join('')}\n^^^ ${err}`);

function readShellBlock(lines: readonly string[], start: number): { readonly command: string; readonly next: number } {
  let i = start;
  while (i < lines.length && !strip(lines[i] ?? '').startsWith('```')) i += 1;
  return { command: lines.slice(start, i).join(''), next: i < lines.length ? i + 1 : i };
}

function readSearchReplace(lines: readonly string[], start: number): { readonly original: string; readonly updated: string; readonly end: number } {
  let i = start;
  while (i < lines.length && !isMarker(DIVIDER, lines[i])) i += 1;
  if (i >= lines.length) throw malformed(lines, i, `Expected \`${DIVIDER_ERR}\``);
  const divider = i;
  i += 1;
  while (i < lines.length && !(isMarker(UPDATED, lines[i]) || isMarker(DIVIDER, lines[i]))) i += 1;
  if (i >= lines.length) throw malformed(lines, i, `Expected \`${UPDATED_ERR}\` or \`${DIVIDER_ERR}\``);
  return { original: lines.slice(start, divider).join(''), updated: lines.slice(divider + 1, i).join(''), end: i };
}

/** An immediately empty SEARCH proposes a new file, so its name is not matched against chat files. */
function headFilename(lines: readonly string[], i: number, fence: Fence, validFnames: readonly string[] | null): string | null {
  const preceding = lines.slice(Math.max(0, i - 3), i);
  return findFilename(preceding, fence, isMarker(DIVIDER, lines[i + 1]) ? null : validFnames);
}

const isShellStart = (line: string): boolean => SHELL_STARTS.some((start) => strip(line).startsWith(start));

const nextIsEditblock = (lines: readonly string[], i: number): boolean => isMarker(HEAD, lines[i + 1]) || isMarker(HEAD, lines[i + 2]);

export function findOriginalUpdateBlocks(content: string, fence: Fence = DEFAULT_FENCE, validFnames: readonly string[] | null = null): ParsedBlock[] {
  const lines = splitlines(content, true);
  const blocks: ParsedBlock[] = [];
  let currentFilename: string | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (isShellStart(line) && !nextIsEditblock(lines, i)) {
      const shell = readShellBlock(lines, i + 1);
      blocks.push([null, shell.command]);
      i = shell.next;
      continue;
    }
    if (isMarker(HEAD, line)) {
      const filename: string | null = headFilename(lines, i, fence, validFnames) || currentFilename;
      if (!filename) throw malformed(lines, i, missingFilenameErr(fence));
      currentFilename = filename;
      const block = readSearchReplace(lines, i + 1);
      blocks.push([filename, block.original, block.updated]);
      i = block.end;
    }
    i += 1;
  }
  return blocks;
}
