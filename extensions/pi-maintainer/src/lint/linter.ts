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
  /** Explicit command override; bypasses unknown-extension skip. */
  readonly explicitCmd?: string;
}

function langOf(fname: string): string | null {
  const ext = extname(fname).toLowerCase();
  if (ext === '.py') return 'python';
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs' || ext === '.jsx') return 'javascript';
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  return null;
}

/** Resolve the shell command, or null when auto-dispatch should skip the file. */
export function resolveLintCommand(
  fname: string,
  lintCmds: ReadonlyMap<string | null, string>,
  explicitCmd?: string,
): string | null {
  const trimmed = explicitCmd?.trim() ?? '';
  if (trimmed) return trimmed;

  const lang = langOf(fname);
  if (!lang) return null;

  const allCmd = lintCmds.get(null);
  if (allCmd) return allCmd;
  return lintCmds.get(lang) ?? null;
}

/** One-based line sets keyed by matched filename (`aider/linter.py:find_filenames_and_linenums`). */
export function findFilenamesAndLinenums(text: string, fnames: readonly string[]): Map<string, Set<number>> {
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

/** Mark extracted source lines; TreeContext structural slices stay out of scope. */
function renderLineMarkers(relFname: string, code: string, zeroBasedLines: readonly number[]): string {
  if (!zeroBasedLines.length) return '';
  const marked = zeroBasedLines.length === 1 ? 'line' : 'lines';
  let out = `## See relevant ${marked} below marked with █.\n\n`;
  out += `${relFname}:\n`;
  const lines = code.split(/\r?\n/);
  for (const line of zeroBasedLines) {
    if (line >= 0 && line < lines.length) out += `${line + 1}█${lines[line]}\n`;
  }
  return out;
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

  const cmd = resolveLintCommand(fname, options.lintCmds, options.explicitCmd);
  if (!cmd) return null;

  const lintres = await runCmd(options.host, options.root, cmd, relFname, signal);
  if (!lintres) return null;

  let res = '# Fix any errors below, if possible.\n\n';
  res += lintres.text;
  res += '\n';
  res += renderLineMarkers(relFname, code, lintres.lines);
  return res;
}
