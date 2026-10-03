import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { lintPythonCompile } from '../src/python-compile.ts';

function hasPython3(): boolean {
  return spawnSync('python3', ['--version'], { stdio: 'ignore' }).status === 0;
}

const pythonAvailable = hasPython3();

describe('lintPythonCompile', () => {
  test.skipIf(!pythonAvailable)('returns nothing for valid python', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maintainer-'));
    const fname = join(dir, 'clean.py');
    writeFileSync(fname, 'x = 1\n');
    const result = await lintPythonCompile({ pythonPath: 'python3', cwd: dir }, fname);
    expect(result).toBe(undefined);
  });

  test.skipIf(!pythonAvailable)('returns the trimmed traceback and the zero-indexed error lines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maintainer-'));
    const fname = join(dir, 'syntax_err.py');
    writeFileSync(fname, 'def broken(\n    return 1\n');
    const result = await lintPythonCompile({ pythonPath: 'python3', cwd: dir }, fname);
    expect(result?.text).toBe(`Traceback (most recent call last):\n  File "${fname}", line 1\n    def broken(\n              ^\nSyntaxError: '(' was never closed\n`);
    expect(result?.lines).toEqual([0]);
  });

  test.skipIf(!pythonAvailable)('converts the reported line number to a zero-indexed line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maintainer-'));
    const fname = join(dir, 'late.py');
    writeFileSync(fname, 'x = 1\ny = 2\ndef broken(\n');
    const result = await lintPythonCompile({ pythonPath: 'python3', cwd: dir }, fname);
    expect(result?.text).toContain(`File "${fname}", line 3`);
    expect(result?.lines).toEqual([2]);
  });

  test.skipIf(!pythonAvailable)('propagates the crash for a syntax error without a line number', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maintainer-'));
    const fname = join(dir, 'nullbyte.py');
    writeFileSync(fname, 'x = 1\0\n');
    await expect(lintPythonCompile({ pythonPath: 'python3', cwd: dir }, fname)).rejects.toThrow(/TypeError/);
  });
});
