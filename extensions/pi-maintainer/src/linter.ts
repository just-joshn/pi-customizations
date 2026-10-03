/**
 * The per-repo linter dispatcher. The decision order per file is: an explicit
 * command argument, then the file's language (unknown languages are never
 * linted), then the language-less global command, then the per-language
 * entry — a callable, a shell command string, or nothing, which falls back to
 * the tree-sitter scan. Results are wrapped in the fixed header plus the
 * marked-line excerpt.
 */

import { isAbsolute, join, relative } from 'node:path';

import { basicLint } from './basic-lint.ts';
import { flake8Lint } from './flake8.ts';
import { filenameToLang } from './languages.ts';
import { errorsToLintResult } from './lint-regex.ts';
import { lintPythonCompile } from './python-compile.ts';
import { quoteShellWord } from './shell-quote.ts';
import { LINT_HEADER } from './strings.ts';
import { renderTreeContext } from './tree-context.ts';
import type { LintChecker, LinterDeps, LinterIo, LintResult } from './types.ts';

export class Linter {
  readonly languages: Map<string, LintChecker>;
  allLintCmd: string | undefined;

  private readonly deps: LinterDeps;

  constructor(deps: LinterDeps) {
    this.deps = deps;
    this.languages = new Map<string, LintChecker>([['python', (input) => this.pyLint(input)]]);
    this.allLintCmd = undefined;
  }

  setLinter(lang: string | undefined, cmd: string): void {
    if (lang) {
      this.languages.set(lang, cmd);
      return;
    }
    this.allLintCmd = cmd;
  }

  get io(): LinterIo {
    return this.deps.io;
  }

  getRelFname(fname: string): string {
    if (this.deps.root === undefined) return fname;
    const rel = relative(this.deps.root, fname);
    return rel.startsWith('..') ? fname : rel;
  }

  async lint(fname: string, cmd?: string): Promise<string | undefined> {
    const relFname = this.getRelFname(fname);
    let code: string;
    try {
      code = this.deps.readReplacement(fname);
    } catch (error: unknown) {
      this.deps.io.error(`Unable to read ${fname}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }

    let checker: string | LintChecker | undefined = cmd?.trim();
    if (!checker) {
      const lang = filenameToLang(fname);
      if (lang === undefined) return undefined;
      if (this.allLintCmd !== undefined) {
        checker = this.allLintCmd;
      } else {
        checker = this.languages.get(lang);
      }
    }

    const lintres = await this.runChecker(checker, { fname, relFname, code });
    if (lintres === undefined) return undefined;

    const parser = await this.loadContextParser(relFname);
    let res = LINT_HEADER;
    res += lintres.text;
    res += '\n';
    res += renderTreeContext(relFname, code, lintres.lines, (source) => parser.parse(source));
    return res;
  }

  private async runChecker(checker: string | LintChecker | undefined, input: { fname: string; relFname: string; code: string }): Promise<LintResult | undefined> {
    if (typeof checker === 'function') return checker(input);
    if (checker !== undefined) return this.runLintCmd(checker, input.relFname);
    return basicLint({
      fname: input.relFname,
      code: input.code,
      loadParser: this.deps.loadParser,
      io: this.deps.io,
    });
  }

  private async loadContextParser(relFname: string) {
    const lang = filenameToLang(relFname);
    if (lang === undefined) throw new Error(`Unknown language for ${relFname}`);
    return this.deps.loadParser(lang);
  }

  private async pyLint(input: { fname: string; relFname: string; code: string }): Promise<LintResult | undefined> {
    const signal = this.deps.signal?.();
    const basicRes = await basicLint({
      fname: input.relFname,
      code: input.code,
      loadParser: this.deps.loadParser,
      io: this.deps.io,
    });
    const compileRes = await lintPythonCompile({ pythonPath: this.deps.pythonPath, cwd: this.deps.root }, input.fname, signal);
    const flakeRes = await flake8Lint({ pythonPath: this.deps.pythonPath, cwd: this.deps.root, runFatalLint: this.deps.runFatalLint }, input.relFname, signal);

    let text = '';
    const lines = new Set<number>();
    for (const res of [basicRes, compileRes, flakeRes]) {
      if (res === undefined) continue;
      if (text.length > 0) text += '\n';
      text += res.text;
      for (const line of res.lines) lines.add(line);
    }

    if (text.length > 0 || lines.size > 0) return { text, lines: [...lines] };
    return undefined;
  }

  async runLintCmd(cmd: string, relFname: string): Promise<LintResult | undefined> {
    const full = `${cmd} ${quoteShellWord(relFname)}`;
    let returncode: number;
    let stdout: string;
    try {
      [returncode, stdout] = await this.deps.runShell(full, this.deps.root, this.deps.signal?.());
    } catch (error: unknown) {
      this.deps.io.error(`Unable to execute lint command: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
    if (returncode === 0) return undefined;

    const res = `## Running: ${full}\n\n`;
    return errorsToLintResult(relFname, res + stdout);
  }

  errorsToLintResult(relFname: string, errors: string): LintResult | undefined {
    return errorsToLintResult(relFname, errors);
  }

  async lintEdited(fnames: readonly string[]): Promise<string | undefined> {
    let res = '';
    for (const fname of fnames) {
      if (!fname) continue;
      const errors = await this.lint(this.absRootPath(fname));
      if (errors === undefined) continue;
      res += '\n';
      res += errors;
      res += '\n';
    }
    if (res.length > 0) this.deps.io.warning(res);
    return res.length > 0 ? res : undefined;
  }

  absRootPath(path: string): string {
    if (isAbsolute(path)) return path;
    return join(this.deps.root ?? process.cwd(), path);
  }
}
