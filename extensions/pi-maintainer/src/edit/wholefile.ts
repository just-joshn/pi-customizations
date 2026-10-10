import { lstrip, pyLength, rstrip, splitlines, splitWhitespace, strip } from '../support/pystr.ts';
import { ValueError } from './errors.ts';
import { defaultFence, type Fence } from './fences.ts';
import type { WorkingTree } from './working-tree.ts';

export type FilenameSource = 'block' | 'saw' | 'chat';
export type WholeFileEdit = readonly [path: string, source: FilenameSource, lines: readonly string[]];
type Filename = readonly [path: string, source: FilenameSource];

function blockFilename(previousLine: string, chatFiles: readonly string[]): string {
  let fname = strip(previousLine);
  fname = strip(fname, '*');
  fname = rstrip(fname, ':');
  fname = strip(fname, '`');
  fname = lstrip(fname, '#');
  fname = strip(fname);
  if (pyLength(fname) > 250) return '';
  const basename =
    fname
      .split('/')
      .filter((part) => part !== '' && part !== '.')
      .at(-1) ?? '';
  if (fname && !chatFiles.includes(fname) && chatFiles.includes(basename)) return basename;
  return fname;
}

function openingFilename(previousLine: string, sawFname: string | null, chatFiles: readonly string[], fence: Fence): Filename {
  const fname = blockFilename(previousLine, chatFiles);
  if (fname) return [fname, 'block'];
  if (sawFname) return [sawFname, 'saw'];
  const onlyFile = chatFiles[0];
  if (chatFiles.length === 1 && onlyFile !== undefined) return [onlyFile, 'chat'];
  throw new ValueError(`No filename provided before ${fence[0]} in file listing`);
}

function mentionedFilename(line: string, chatFiles: readonly string[], previous: string | null): string | null {
  let sawFname = previous;
  for (const word of splitWhitespace(strip(line))) {
    const unpunctuated = rstrip(word, '.:,;!');
    for (const chatFile of chatFiles) {
      if (unpunctuated === `\`${chatFile}\``) sawFname = chatFile;
    }
  }
  return sawFname;
}

function refineEdits(edits: readonly WholeFileEdit[]): WholeFileEdit[] {
  const refined: WholeFileEdit[] = [];
  const seen = new Set<string>();
  for (const source of ['block', 'saw', 'chat']) {
    for (const edit of edits) {
      if (edit[1] !== source || seen.has(edit[0])) continue;
      seen.add(edit[0]);
      refined.push(edit);
    }
  }
  return refined;
}

export function getEdits(content: string, chatFiles: readonly string[] = [], fence: Fence = defaultFence): WholeFileEdit[] {
  const lines = splitlines(content, true);
  const edits: WholeFileEdit[] = [];
  let sawFname: string | null = null;
  let fname: Filename | null = null;
  let newLines: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.startsWith(fence[0]) || line.startsWith(fence[1])) {
      if (fname !== null) {
        sawFname = null;
        edits.push([fname[0], fname[1], newLines]);
        fname = null;
        newLines = [];
      } else {
        fname = openingFilename(lines[index - 1] ?? '', sawFname, chatFiles, fence);
      }
    } else if (fname !== null) {
      newLines.push(line);
    } else {
      sawFname = mentionedFilename(line, chatFiles, sawFname);
    }
  }
  if (fname?.[0]) edits.push([fname[0], fname[1], newLines]);
  return refineEdits(edits);
}

export async function applyEdits(edits: readonly WholeFileEdit[], context: { readonly tree: Pick<WorkingTree, 'write'>; readonly absRootPath: (path: string) => string }): Promise<void> {
  for (const [path, , newLines] of edits) {
    await context.tree.write(context.absRootPath(path), newLines.join(''));
  }
}
