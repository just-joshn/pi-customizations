/**
 * The Python compile() check. The file is compiled by a Python subprocess
 * because no in-process Python runtime exists. The helper reproduces the
 * reference output exactly: a traceback header plus the exception rendering
 * of the compiled file, and 0-indexed line numbers from err.lineno through
 * end_lineno. A SyntaxError without a line number reproduces the reference
 * crash: the helper dies computing err.lineno - 1, and this module rethrows
 * the failure to its caller.
 */

import { fileURLToPath } from 'node:url';

import { runStdinCommand } from './run-command.ts';
import type { LintResult } from './types.ts';

const HELPER_PATH = fileURLToPath(new URL('./python-compile-helper.py', import.meta.url));

export interface PythonCompileDeps {
  readonly pythonPath: string;
  readonly cwd: string | undefined;
}

interface CompileReport {
  readonly ok: boolean;
  readonly text?: string;
  readonly lines?: readonly number[];
}

function parseReport(stdout: string): CompileReport {
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== 'object' || parsed === null || !('ok' in parsed)) {
    throw new Error(`Unexpected compile check output: ${stdout}`);
  }
  const record = parsed as { ok: unknown; text?: unknown; lines?: unknown };
  if (typeof record.ok !== 'boolean') throw new Error(`Unexpected compile check output: ${stdout}`);
  if (!record.ok) {
    return {
      ok: false,
      text: typeof record.text === 'string' ? record.text : '',
      lines: Array.isArray(record.lines) ? record.lines.filter((line): line is number => typeof line === 'number') : [],
    };
  }
  return { ok: true };
}

export async function lintPythonCompile(deps: PythonCompileDeps, fname: string, signal?: AbortSignal): Promise<LintResult | undefined> {
  const outcome = await runStdinCommand(deps.pythonPath, [HELPER_PATH, fname], '', deps.cwd, signal);
  if (outcome.spawnError !== undefined) throw new Error(outcome.spawnError);
  if (outcome.code !== 0 || outcome.stdout.trim() === '') {
    throw new Error(outcome.stderr.trim() === '' ? `compile check failed with exit code ${outcome.code}` : outcome.stderr);
  }
  const report = parseReport(outcome.stdout);
  if (report.ok) return undefined;
  return { text: report.text ?? '', lines: report.lines ?? [] };
}
