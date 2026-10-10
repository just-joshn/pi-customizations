import { readFile } from 'node:fs/promises';
import { extname, relative } from 'node:path';

import type { Host } from '../core/host.ts';
import { runShellCommand, shellQuote } from './shell.ts';

export interface LintResult {
  readonly text: string;
  readonly lines: readonly number[];
}

/** Honest per-file lint outcome. Aider's falsy return collapsed these into one signal. */
export type LintFileOutcome =
  | { readonly kind: 'clean' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'unreadable'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'failed'; readonly report: string };

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

/**
 * Aider `Linter.get_rel_fname`: when root is set, return a relative string; when root is null,
 * return the incoming path value unchanged so a pathlib.Path can pass through.
 */
export function relativeLintName(fname: string, root: string | null): string;
export function relativeLintName<T>(fname: T, root: string | null): T | string;
export function relativeLintName(fname: unknown, root: string | null): unknown {
  if (root == null) return fname;
  const asString = typeof fname === 'string' ? fname : String(fname);
  return relative(root, asString) || asString;
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

async function runCmd(host: Host, root: string, cmd: string, relFname: string, signal?: AbortSignal): Promise<LintResult | null | { unavailable: string }> {
  const full = `${cmd} ${shellQuote(relFname)}`;
  try {
    const { code, output } = await runShellCommand(host, full, root, signal);
    if (code === 0) return null;
    const res = `## Running: ${full}\n\n${output}`;
    return errorsToLintResult(relFname, res);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    host.error(`Unable to execute lint command: ${reason}`);
    return { unavailable: reason };
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

/** Lint report text for callers that only need the model-facing string. */
export function lintReportText(outcome: LintFileOutcome): string | null {
  return outcome.kind === 'failed' ? outcome.report : null;
}

/** Lint one file through configured Host.exec commands (`aider/linter.py` cmd path). */
export async function lintFile(fname: string, options: LinterOptions, signal?: AbortSignal): Promise<LintFileOutcome> {
  signal?.throwIfAborted();
  const relFname = relativeLintName(fname, options.root);
  let code: string;
  try {
    code = await readFile(fname, { encoding: (options.encoding ?? 'utf-8') as BufferEncoding });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    options.host.error(`Unable to read ${fname}: ${reason}`);
    return { kind: 'unreadable', reason };
  }

  const cmd = resolveLintCommand(fname, options.lintCmds, options.explicitCmd);
  if (!cmd) return { kind: 'unsupported' };

  const lintres = await runCmd(options.host, options.root, cmd, relFname, signal);
  if (lintres && 'unavailable' in lintres) return { kind: 'unavailable', reason: lintres.unavailable };
  if (!lintres) return { kind: 'clean' };

  let res = '# Fix any errors below, if possible.\n\n';
  res += lintres.text;
  res += '\n';
  res += renderLineMarkers(relFname, code, lintres.lines);
  return { kind: 'failed', report: res };
}
