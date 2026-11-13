import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildSnapshot, PACKAGE_DIR } from '../../scripts/ci-linux/snapshot.mjs';
import { sourceDigest } from '../../scripts/parity-lib.mjs';
import { PKG } from './helpers.ts';

const repoRoot = execFileSync('git', ['-C', PKG, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
let dest = '';
beforeEach(() => {
  dest = mkdtempSync(join(tmpdir(), 'pstack-snapshot-'));
  buildSnapshot({ root: PKG, repoRoot, dest, commit: 'c'.repeat(40) });
  execFileSync('git', ['-C', dest, 'init', '-q']);
  execFileSync('git', ['-C', dest, 'add', '-A']);
});
afterEach(() => rmSync(dest, { recursive: true, force: true }));

describe('the Linux runner hashes the same inputs the local run does', () => {
  test('a snapshot of this checkout has the same source digest as the checkout', () => {
    expect(sourceDigest(join(dest, PACKAGE_DIR))).toBe(sourceDigest(PKG));
  });

  test('a snapshot whose lockfile differs has a different digest', () => {
    appendFileSync(join(dest, 'bun.lock'), '\n');
    expect(sourceDigest(join(dest, PACKAGE_DIR))).not.toBe(sourceDigest(PKG));
  });

  test('a snapshot whose workspace package.json differs has a different digest', () => {
    appendFileSync(join(dest, 'package.json'), '\n');
    expect(sourceDigest(join(dest, PACKAGE_DIR))).not.toBe(sourceDigest(PKG));
  });

  test('a snapshot whose biome.json differs has a different digest', () => {
    appendFileSync(join(dest, 'biome.json'), '\n');
    expect(sourceDigest(join(dest, PACKAGE_DIR))).not.toBe(sourceDigest(PKG));
  });

  test('the snapshot carries the checkout biome.json byte for byte', () => {
    expect(readFileSync(join(dest, 'biome.json'))).toEqual(readFileSync(join(repoRoot, 'biome.json')));
  });
});
