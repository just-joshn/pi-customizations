import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { flake8Lint } from '../src/flake8.ts';

interface StubPython {
  readonly dir: string;
  readonly pythonPath: string;
}

function makeStubPython(lines: readonly string[], exitCode: number): StubPython {
  const dir = mkdtempSync(join(tmpdir(), 'maintainer-flake8-'));
  const pythonPath = join(dir, 'stubpython');
  const body = lines.map((line) => `printf '%s\\n' ${JSON.stringify(line).replaceAll('"', "'")}`).join('\n');
  writeFileSync(pythonPath, `#!/bin/sh\nif [ "$1" = "-m" ] && [ "$2" = "flake8" ]; then\n  ${body}\n  exit ${exitCode}\nfi\nexit 0\n`);
  chmodSync(pythonPath, 0o755);
  return { dir, pythonPath };
}

describe('flake8Lint', () => {
  test('prepends the unquoted running line and extracts zero-indexed lines', async () => {
    const stub = makeStubPython(['src.py:2:12: F821 undefined name x'], 1);
    const result = await flake8Lint({ pythonPath: stub.pythonPath, cwd: stub.dir }, 'src.py');
    expect(result?.text.startsWith(`## Running: ${stub.pythonPath} -m flake8 --select=E9,F821,F823,F831,F406,F407,F701,F702,F704,F706 --show-source --isolated src.py\n\n`)).toBe(true);
    expect(result?.lines).toEqual([1]);
  });

  test('returns nothing when flake8 prints nothing', async () => {
    const stub = makeStubPython([], 0);
    const result = await flake8Lint({ pythonPath: stub.pythonPath, cwd: stub.dir }, 'src.py');
    expect(result).toBe(undefined);
  });

  test('keeps output even when the exit code is zero', async () => {
    const stub = makeStubPython(['src.py:4:1: E999 late error'], 0);
    const result = await flake8Lint({ pythonPath: stub.pythonPath, cwd: stub.dir }, 'src.py');
    expect(result?.lines).toEqual([3]);
  });

  test('reports a missing flake8 interpreter as error text for the model', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maintainer-flake8-'));
    const missing = join(dir, 'no-such-python');
    const result = await flake8Lint({ pythonPath: missing, cwd: dir }, 'src.py');
    expect(result?.text).toContain('Error running flake8:');
    expect(result?.lines).toEqual([]);
  });
});
