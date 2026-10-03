import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { Linter } from '../src/linter.ts';
import { loadParser } from '../src/parsers.ts';
import type { LinterDeps, LinterIo } from '../src/types.ts';

interface DepsSpans {
  readonly warnings: string[];
  readonly errors: string[];
  readonly output: string[];
  readonly shells: string[];
}

type PythonBehavior = 'silent-flake8' | 'reporting-flake8' | 'real';

function writeStubPython(dir: string, behavior: PythonBehavior): string {
  const stub = join(dir, '.stub-python');
  const passthrough = 'exec python3 "$@"';
  const flake8Branch = behavior === 'silent-flake8' ? 'exit 0' : `printf '%s\\n' 'broken.py:1:12: E999 SyntaxError: unchanged'; exit 1`;
  writeFileSync(stub, `#!/bin/sh\nfor arg in "$@"; do\n  if [ "$arg" = "flake8" ]; then\n    ${flake8Branch}\n  fi\ndone\n${passthrough}\n`);
  chmodSync(stub, 0o755);
  return stub;
}

function makeRepo(behavior: PythonBehavior): string {
  const dir = mkdtempSync(join(tmpdir(), 'maintainer-linter-'));
  writeFileSync(join(dir, 'broken.py'), 'def broken(\n    return 1\n');
  writeFileSync(join(dir, 'clean.py'), 'x = 1\n');
  writeFileSync(join(dir, 'nullbyte.py'), 'x = 1\0\n');
  writeFileSync(join(dir, 'broken.js'), 'function broken( {\n  return 1;\n}\n');
  mkdirSync(join(dir, 'pkg'));
  writeFileSync(join(dir, 'pkg', 'broken.py'), 'def broken(\n    return 1\n');
  writeStubPython(dir, behavior);
  return dir;
}

function makeDeps(root: string, spans: DepsSpans, runShellResult: readonly [number, string] = [0, ''], pythonPath: string): LinterDeps {
  const io: LinterIo = {
    output: (message) => spans.output.push(message),
    warning: (message) => spans.warnings.push(message),
    error: (message) => spans.errors.push(message),
  };
  return {
    io,
    root,
    pythonPath,
    loadParser,
    runShell: async (command) => {
      spans.shells.push(command);
      return runShellResult;
    },
    readReplacement: (path) => {
      if (path.endsWith('unreadable.py')) throw new Error('EACCES: permission denied');
      return new TextDecoder('utf-8').decode(readFileSync(path));
    },
  };
}

describe('Linter dispatch', () => {
  test('lints a python file through the three merged checkers', async () => {
    const dir = makeRepo('reporting-flake8');
    const spans: DepsSpans = { warnings: [], errors: [], output: [], shells: [] };
    const linter = new Linter(makeDeps(dir, spans, [0, ''], join(dir, '.stub-python')));
    const result = await linter.lint(join(dir, 'broken.py'));
    expect(result).toContain('# Fix any errors below, if possible.\n\n');
    expect(result).toContain("SyntaxError: '(' was never closed");
    expect(result).toContain('## Running:');
    expect(result).toContain('## See relevant line below marked with █.');
    expect(spans.shells).toHaveLength(0);
  });

  test('prefers an explicit command argument over everything', async () => {
    const dir = makeRepo('silent-flake8');
    const spans: DepsSpans = { warnings: [], errors: [], output: [], shells: [] };
    const linter = new Linter(makeDeps(dir, spans, [1, 'explicit failure broken.py:2:0\n'], 'python3'));
    const result = await linter.lint(join(dir, 'broken.py'), 'mylinter');
    expect(result).toContain('## Running: mylinter');
    expect(result).toContain('explicit failure');
    expect(spans.shells).toEqual(['mylinter broken.py']);
  });

  test('never lints unknown extensions even with a global command', async () => {
    const dir = makeRepo('silent-flake8');
    const spans: DepsSpans = { warnings: [], errors: [], output: [], shells: [] };
    const linter = new Linter(makeDeps(dir, spans, [0, ''], 'python3'));
    linter.setLinter(undefined, 'echo lint');
    const result = await linter.lint(join(dir, 'notes.txt'));
    expect(result).toBe(undefined);
    expect(spans.shells.length).toBe(0);
  });

  test('the global command overrides the built-in python stack', async () => {
    const dir = makeRepo('silent-flake8');
    const spans: DepsSpans = { warnings: [], errors: [], output: [], shells: [] };
    const linter = new Linter(makeDeps(dir, spans, [3, 'global says broken\n'], 'python3'));
    linter.setLinter(undefined, 'echo lint');
    const result = await linter.lint(join(dir, 'broken.py'));
    expect(result).toContain('global says broken');
    expect(result).not.toContain('SyntaxError');
    expect(result).not.toContain('flake8');
  });

  test('a per-language command replaces the python stack entirely', async () => {
    const dir = makeRepo('silent-flake8');
    const spans: DepsSpans = { warnings: [], errors: [], output: [], shells: [] };
    const linter = new Linter(makeDeps(dir, spans, [2, 'custom says broken\n'], 'python3'));
    linter.setLinter('python', 'projlint');
    const result = await linter.lint(join(dir, 'broken.py'));
    expect(result).toContain('## Running: projlint');
    expect(result).toContain('custom says broken');
    expect(result).not.toContain('SyntaxError');
  });

  test('a known non-python extension falls back to the tree-sitter scan', async () => {
    const dir = makeRepo('silent-flake8');
    const spans: DepsSpans = { warnings: [], errors: [], output: [], shells: [] };
    const linter = new Linter(makeDeps(dir, spans, [0, ''], 'python3'));
    const result = await linter.lint(join(dir, 'broken.js'));
    expect(result).toBe('# Fix any errors below, if possible.\n\n\n## See relevant lines below marked with █.\n\nbroken.js:\n  1█function broken( {\n  2█  return 1;\n  3│}\n');
  });

  test('typescript files are never tree-sitter linted', async () => {
    const dir = makeRepo('silent-flake8');
    const spans: DepsSpans = { warnings: [], errors: [], output: [], shells: [] };
    const linter = new Linter(makeDeps(dir, spans, [0, ''], 'python3'));
    const result = await linter.lint(join(dir, 'app.ts'));
    expect(result).toBe(undefined);
  });

  test('prints a note and skips files it cannot read', async () => {
    const dir = makeRepo('silent-flake8');
    const spans: DepsSpans = { warnings: [], errors: [], output: [], shells: [] };
    const linter = new Linter(makeDeps(dir, spans, [0, ''], 'python3'));
    const result = await linter.lint(join(dir, 'unreadable.py'));
    expect(result).toBeUndefined();
    expect(spans.errors[0]).toContain('Unable to read');
  });

  test('shows relative filenames rooted at the repository root', async () => {
    const dir = makeRepo('silent-flake8');
    const spans: DepsSpans = { warnings: [], errors: [], output: [], shells: [] };
    const linter = new Linter(makeDeps(dir, spans, [0, ''], 'python3'));
    const result = await linter.lint(join(dir, 'pkg', 'broken.py'));
    expect(result).toContain('pkg/broken.py:\n');
  });
});

describe('Linter.runLintCmd', () => {
  test('returns nothing on exit code zero', async () => {
    const dir = makeRepo('silent-flake8');
    const spans: DepsSpans = { warnings: [], errors: [], output: [], shells: [] };
    const linter = new Linter(makeDeps(dir, spans, [0, 'all good\n'], 'python3'));
    const result = await linter.runLintCmd('mylinter', 'src.py');
    expect(result).toBe(undefined);
  });

  test('wraps failing output with the running line and the shell-safe filename', async () => {
    const dir = makeRepo('silent-flake8');
    const spans: DepsSpans = { warnings: [], errors: [], output: [], shells: [] };
    const linter = new Linter(makeDeps(dir, spans, [1, 'src.py:9:1: E999 nope\n'], 'python3'));
    const result = await linter.runLintCmd('mylinter --flag', 'src.py');
    expect(spans.shells).toEqual(['mylinter --flag src.py']);
    expect(result?.text).toBe('## Running: mylinter --flag src.py\n\nsrc.py:9:1: E999 nope\n');
    expect(result?.lines).toEqual([8]);
  });

  test('reports a shell that cannot start and returns nothing', async () => {
    const dir = makeRepo('silent-flake8');
    const spans: DepsSpans = { warnings: [], errors: [], output: [], shells: [] };
    const deps = makeDeps(dir, spans, [0, ''], 'python3');
    const failingDeps: LinterDeps = {
      ...deps,
      runShell: async () => {
        throw new Error('spawn failed');
      },
    };
    const linter = new Linter(failingDeps);
    const result = await linter.runLintCmd('mylinter', 'src.py');
    expect(result).toBeUndefined();
    expect(spans.errors[0]).toContain('Unable to execute lint command');
  });
});

describe('Linter.lintEdited', () => {
  test('joins each result with surrounding newlines and warns once', async () => {
    const dir = makeRepo('silent-flake8');
    const spans: DepsSpans = { warnings: [], errors: [], output: [], shells: [] };
    const linter = new Linter(makeDeps(dir, spans, [0, ''], join(dir, '.stub-python')));
    const blob = await linter.lintEdited(['broken.py', 'clean.py', 'broken.py']);
    expect(blob?.startsWith('\n')).toBe(true);
    expect(blob?.endsWith('\n')).toBe(true);
    expect((blob?.match(/# Fix any errors below, if possible\./g) ?? []).length).toBe(2);
    expect(spans.warnings).toEqual([blob]);
  });

  test('returns nothing when no file has lint errors', async () => {
    const dir = makeRepo('silent-flake8');
    const spans: DepsSpans = { warnings: [], errors: [], output: [], shells: [] };
    const linter = new Linter(makeDeps(dir, spans, [0, ''], join(dir, '.stub-python')));
    const blob = await linter.lintEdited(['clean.py']);
    expect(blob).toBe(undefined);
    expect(spans.warnings.length).toBe(0);
  });
});

describe('Linter crash parity', () => {
  test('a compile error without a line number propagates out of linting', async () => {
    const dir = makeRepo('real');
    const spans: DepsSpans = { warnings: [], errors: [], output: [], shells: [] };
    const linter = new Linter(makeDeps(dir, spans, [0, ''], 'python3'));
    await expect(linter.lint(join(dir, 'nullbyte.py'))).rejects.toThrow();
  });
});
