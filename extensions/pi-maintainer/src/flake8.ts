/**
 * The fatal-only flake8 subset: E9 plus the selected F codes, with source
 * shown and isolated configuration, run in the repository root. Empty output
 * never counts as a lint failure, whatever the exit code; a failure to run
 * flake8 at all becomes error text the model is asked to fix.
 */

import { errorsToLintResult } from './lint-regex.ts';
import { runArgsCommand } from './run-command.ts';
import type { FatalLintRunner, LintResult } from './types.ts';

const FATAL_CODES = 'E9,F821,F823,F831,F406,F407,F701,F702,F704,F706';

export interface Flake8Deps {
  readonly pythonPath: string;
  readonly cwd: string | undefined;
  /** Overrides the real fatal-lint subprocess runner; the default stays in place. */
  readonly runFatalLint?: FatalLintRunner | undefined;
}

export interface Flake8Io {
  readonly error: (message: string) => void;
}

export async function flake8Lint(deps: Flake8Deps, relFname: string, signal?: AbortSignal): Promise<LintResult | undefined> {
  const args = [deps.pythonPath, '-m', 'flake8', `--select=${FATAL_CODES}`, '--show-source', '--isolated', relFname] as const;

  let text = `## Running: ${args.join(' ')}\n\n`;

  const run = deps.runFatalLint ?? runArgsCommand;
  const outcome = await run(args, deps.cwd, signal);
  if (outcome.spawnError !== undefined) {
    text += `Error running flake8: ${outcome.spawnError}`;
  } else if (outcome.stdout === '' && outcome.stderr === '') {
    return undefined;
  } else {
    text += outcome.stdout + outcome.stderr;
  }

  return errorsToLintResult(relFname, text);
}
