import { readFile } from 'node:fs/promises';
import { extname, relative } from 'node:path';

import type { Host } from '../core/host.ts';
import { runShellCommand, shellQuote } from './shell.ts';

export interface LintResult {
  readonly text: string;
  readonly lines: readonly number[];
}

export interface LinterOptions {
  readonly host: Host;
  readonly root: string;
  readonly lintCmds: ReadonlyMap<string | null, string>;
  readonly encoding?: string;
}

function langOf(fname: string): string | null {
  const ext = extname(fname).toLowerCase();
  if (ext === '.py') return 'python';
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'javascript';
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  if (ext === '.jsx') return 'javascript';
  return null;
}

function findFilenamesAndLinenums(text: string, fnames: readonly string[]): Map<string, Set<number>> {
  if (!fnames.length) return new Map();
  const pattern = new RegExp(`\\b(?:${fnames.map((fname) => fname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}):\\d+\\b`, 'g');
  const result = new Map<string, Set<number>>();
  for (const match of text.matchAll(pattern)) {
    const token = match[0] ?? '';
    const colon = token.lastIndexOf(':');
    const fname = token.slice(0, colon);
    const linenum = Number(token.slice(colon + 1));
    const set = result.get(fname) ?? new Set<number>();
    set.add(linenum);
    result.set(fname, set);
  }
  return result;
}

function errorsToLintResult(relFname: string, errors: string): LintResult | null {
  if (!errors) return null;
  const filenamesLinenums = findFilenamesAndLinenums(errors, [relFname]);
  const first = filenamesLinenums.get(relFname);
  const linenums = first ? [...first].map((num) => num - 1) : [];
  return { text: errors, lines: linenums };
}

async function runCmd(host: Host, root: string, cmd: string, relFname: string, signal?: AbortSignal): Promise<LintResult | null> {
  const full = `${cmd} ${shellQuote(relFname)}`;
  try {
    const { code, output } = await runShellCommand(host, full, root, signal);
    if (code === 0) return null;
    const res = `## Running: ${full}\n\n${output}`;
    return errorsToLintResult(relFname, res);
  } catch (error) {
    host.error(`Unable to execute lint command: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Lint one file through configured Host.exec commands (`aider/linter.py` cmd path). */
export async function lintFile(fname: string, options: LinterOptions, signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted();
  const relFname = relative(options.root, fname) || fname;
  let code: string;
  try {
    code = await readFile(fname, { encoding: (options.encoding ?? 'utf-8') as BufferEncoding });
  } catch (error) {
    options.host.error(`Unable to read ${fname}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  const lang = langOf(fname);
  const allCmd = options.lintCmds.get(null);
  const langCmd = lang ? options.lintCmds.get(lang) : undefined;
  const cmd = allCmd ?? langCmd;
  if (!cmd) return null;

  const lintres = await runCmd(options.host, options.root, cmd, relFname, signal);
  if (!lintres) return null;

  let res = '# Fix any errors below, if possible.\n\n';
  res += lintres.text;
  res += '\n';
  if (lintres.lines.length) {
    const marked = lintres.lines.length === 1 ? 'line' : 'lines';
    res += `## See relevant ${marked} below marked with █.\n\n`;
    res += `${relFname}:\n`;
    const lines = code.split(/\r?\n/);
    for (const line of lintres.lines) {
      if (line >= 0 && line < lines.length) res += `${line + 1}█${lines[line]}\n`;
    }
  }
  return res;
}
