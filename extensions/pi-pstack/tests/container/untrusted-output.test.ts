// A container worker owns its output directory, so reading it must never follow a symlink out of it.
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { listFilesBelow, readFileBelow } from '../../src/untrusted-output.ts';

let dir: string;
let out: string;
let outside: string;

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-untrusted-')));
  out = join(dir, 'out');
  outside = join(dir, 'outside');
  mkdirSync(join(out, 'evidence', 'nested'), { recursive: true });
  mkdirSync(join(out, 'session'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, 'host-secret.txt'), 'host secret\n');
  writeFileSync(join(out, 'report.md'), 'report\n');
  writeFileSync(join(out, 'evidence', 'real.txt'), 'real\n');
  writeFileSync(join(out, 'evidence', 'nested', 'deep.txt'), 'deep\n');
  linkSync(join(out, 'evidence', 'real.txt'), join(out, 'evidence', 'second-name.txt'));
  symlinkSync('/', join(out, 'evidence', 'x'));
  symlinkSync(outside, join(out, 'evidence', 'dir-link'));
  symlinkSync(join(outside, 'host-secret.txt'), join(out, 'evidence', 'file-link.txt'));
  symlinkSync(join(outside, 'host-secret.txt'), join(out, 'session', 'swapped.jsonl'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('listing a worker-controlled directory', () => {
  test('lists regular files, and does not traverse or list a symlink to / or to a host directory or file', () => {
    expect(listFilesBelow(out, 'evidence')).toEqual(['nested/deep.txt', 'real.txt', 'second-name.txt']);
  });

  test('lists nothing when the directory itself was swapped for a symlink or is missing', () => {
    rmSync(join(out, 'session'), { recursive: true });
    symlinkSync(outside, join(out, 'session'));

    expect(listFilesBelow(out, 'session')).toEqual([]);
    expect(listFilesBelow(out, 'absent')).toEqual([]);
  });
});

describe('reading a worker-controlled file', () => {
  test('reads a regular file below the root', () => {
    expect(readFileBelow(out, 'report.md')).toEqual({ kind: 'ok', bytes: Buffer.from('report\n') });
    expect(readFileBelow(out, 'evidence/nested/deep.txt')).toEqual({ kind: 'ok', bytes: Buffer.from('deep\n') });
  });

  test('refuses a symlink to a host file, a path through a symlinked directory, and a path that climbs out', () => {
    expect(readFileBelow(out, 'evidence/file-link.txt').kind).toBe('refused');
    expect(readFileBelow(out, 'evidence/dir-link/host-secret.txt').kind).toBe('refused');
    expect(readFileBelow(out, 'evidence/x/etc/hosts').kind).toBe('refused');
    expect(readFileBelow(out, 'session/swapped.jsonl').kind).toBe('refused');
    expect(readFileBelow(out, '../outside/host-secret.txt').kind).toBe('refused');
  });

  test('a file that is absent is missing, not refused', () => {
    expect(readFileBelow(out, 'nothing.md')).toEqual({ kind: 'missing' });
    expect(readFileBelow(out, 'nested-absent/nothing.md')).toEqual({ kind: 'missing' });
  });
});
