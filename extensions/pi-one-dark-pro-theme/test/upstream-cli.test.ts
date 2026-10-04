import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect } from 'vitest';
import { test as packageTest } from './harness/package-fixture.ts';

const test = packageTest.extend<{ sourceChecker: string; sourceReplay: string }>({
  sourceChecker: async ({ sourceRoot, packageFixture }, use) => {
    const root = packageFixture.root;
    mkdirSync(join(root, 'scripts'));
    cpSync(join(sourceRoot, 'upstream', 'provenance.json'), join(root, 'upstream', 'provenance.json'));
    for (const name of ['theme.ts', 'upstream.ts']) symlinkSync(join(sourceRoot, 'parity', name), join(root, 'parity', name));
    symlinkSync(join(sourceRoot, 'node_modules'), join(root, 'node_modules'));
    const checker = join(root, 'scripts', 'check-parity.mjs');
    cpSync(join(sourceRoot, 'scripts', 'check-parity.mjs'), checker);
    cpSync(join(sourceRoot, 'scripts', 'replay-upstream.mjs'), join(root, 'scripts', 'replay-upstream.mjs'));
    await use(checker);
  },
  sourceReplay: async ({ sourceChecker }, use) => {
    await use(join(dirname(sourceChecker), 'replay-upstream.mjs'));
  },
});

function run(script: string, themePath?: string) {
  return spawnSync(process.execPath, themePath === undefined ? [script] : [script, '--theme', themePath], { encoding: 'utf8' });
}

test('the real checker verifies both original provenance and the formatted artifact', ({ sourceChecker, packageFixture }) => {
  const result = run(sourceChecker, packageFixture.themePath);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('upstream sha256 and shared Biome artifact verified');
});

test('the real checker rejects an unmapped semantic change in the artifact', ({ sourceChecker, packageFixture }) => {
  const text = readFileSync(packageFixture.upstreamPath, 'utf8').replace('"name": "One Dark Pro"', '"name": "tampered"');
  expect(text).toContain('"name": "tampered"');
  writeFileSync(packageFixture.upstreamPath, text);
  const result = run(sourceChecker, packageFixture.themePath);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('upstream artifact differs from shared Biome formatting of the pinned original source');
});

test('the real checker rejects whitespace drift in the artifact', ({ sourceChecker, packageFixture }) => {
  writeFileSync(packageFixture.upstreamPath, `${readFileSync(packageFixture.upstreamPath, 'utf8')} `);
  const result = run(sourceChecker, packageFixture.themePath);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('upstream artifact differs from shared Biome formatting of the pinned original source');
});

test('the real checker rejects original source drift even if formatting hides it', ({ sourceChecker, packageFixture }) => {
  const path = join(packageFixture.root, 'upstream', 'provenance.json');
  const provenance = JSON.parse(readFileSync(path, 'utf8')) as { originalSource: string };
  writeFileSync(path, JSON.stringify({ originalSource: `${provenance.originalSource} ` }));
  const result = run(sourceChecker, packageFixture.themePath);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('upstream file sha256 is');
  expect(result.stderr).toContain('1 parity problem(s)');
});

test('the real checker fails closed on invalid provenance', ({ sourceChecker, packageFixture }) => {
  writeFileSync(join(packageFixture.root, 'upstream', 'provenance.json'), '{"originalSource":42}');
  const result = run(sourceChecker, packageFixture.themePath);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('upstream provenance must contain an originalSource string');
});

test('replay emits the exact shared-policy artifact without changing files', ({ sourceReplay, packageFixture }) => {
  const before = readFileSync(packageFixture.upstreamPath, 'utf8');
  const result = run(sourceReplay);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(before);
  expect(readFileSync(packageFixture.upstreamPath, 'utf8')).toBe(before);
});

test('replay refuses a corrupted original before emitting any artifact', ({ sourceReplay, packageFixture }) => {
  writeFileSync(join(packageFixture.root, 'upstream', 'provenance.json'), '{"originalSource":"{}"}');
  const result = run(sourceReplay);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('upstream source sha256 is');
});
