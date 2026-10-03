import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { Linter } from '../src/linter.ts';
import { loadParser } from '../src/parsers.ts';
import { lintPythonCompile } from '../src/python-compile.ts';
import type { ProcessOutcome } from '../src/run-command.ts';
import type { LinterDeps, LinterIo } from '../src/types.ts';
import { GOLDEN_SOURCES, goldenJson, goldenText } from './helpers/golden-fixtures.ts';

/** Recorded fatal-lint output for the fixtures, keyed by the relative filename. */
const RECORDED_FATAL_LINT: Record<string, { readonly code: number; readonly stdout: string }> = {
  'syntax_err.py': { code: 1, stdout: "syntax_err.py:1:12: E999 SyntaxError: '(' was never closed\n" },
  'undef_name.py': { code: 1, stdout: "undef_name.py:2:12: F821 undefined name 'not_defined'\n    return not_defined\n           ^\n" },
};

const PYTHON_AVAILABLE = spawnSync('python3', ['--version'], { stdio: 'ignore' }).status === 0;

async function recordedFatalLint(args: readonly string[]): Promise<ProcessOutcome> {
  const recorded = RECORDED_FATAL_LINT[args.at(-1) ?? ''];
  return { code: recorded?.code ?? 0, stdout: recorded?.stdout ?? '', stderr: '', spawnError: undefined };
}

function makeGoldenDeps(root: string): LinterDeps {
  const io: LinterIo = { output: () => undefined, warning: () => undefined, error: () => undefined };
  return {
    io,
    root,
    pythonPath: 'python3',
    loadParser,
    runShell: async () => [0, ''],
    readReplacement: (path) => readFileSync(path, 'utf8'),
    runFatalLint: recordedFatalLint,
  };
}

/** The scratch directory and interpreter path are normalized the same way the goldens are. */
function normalize(text: string, dir: string): string {
  return text.replaceAll(dir, '<D>').replaceAll('python3', '<python>');
}

async function lintGoldenFile(file: keyof typeof GOLDEN_SOURCES): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'maintainer-golden-'));
  const fname = join(dir, file);
  writeFileSync(fname, GOLDEN_SOURCES[file]);
  const output = await new Linter(makeGoldenDeps(dir)).lint(fname);
  rmSync(dir, { recursive: true, force: true });
  return normalize(output ?? '', dir);
}

describe('Linter.lint golden parity', () => {
  test.skipIf(!PYTHON_AVAILABLE)('matches the recorded python syntax-error output', async () => {
    expect(await lintGoldenFile('syntax_err.py')).toBe(goldenText('lint-syntax_err.py.txt'));
  });

  test.skipIf(!PYTHON_AVAILABLE)('matches the recorded python undefined-name output', async () => {
    expect(await lintGoldenFile('undef_name.py')).toBe(goldenText('lint-undef_name.py.txt'));
  });

  test('matches the recorded javascript syntax-error output', async () => {
    expect(await lintGoldenFile('syntax_err.js')).toBe(goldenText('lint-syntax_err.js.txt'));
  });
});

describe('lintPythonCompile golden parity', () => {
  test.skipIf(!PYTHON_AVAILABLE)('matches the recorded compile traceback and line list', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maintainer-golden-'));
    const fname = join(dir, 'syntax_err.py');
    writeFileSync(fname, GOLDEN_SOURCES['syntax_err.py']);
    const result = await lintPythonCompile({ pythonPath: 'python3', cwd: dir }, fname);
    rmSync(dir, { recursive: true, force: true });
    expect(normalize(result?.text ?? '', dir)).toBe(goldenText('compile-syntax-err.txt'));
    expect(result?.lines).toEqual(goldenJson('compile-syntax-err-lines.json'));
  });
});
