import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { listFiles } from '../../adapters/provenance.ts';
import { fixture, PKG, run, treeHash } from './helpers.ts';

let cleanup = () => {};
afterEach(() => cleanup());

const SOURCE = 'vendor/upstream-pstack/automations/benny';
const OUTPUT = 'generated/automations/benny';

function withFixture() {
  const f = fixture();
  cleanup = f.cleanup;
  return f.root;
}

test('the shipped Benny pack is generated output with no hand-kept copy beside it', () => {
  expect(existsSync(join(PKG, 'automations'))).toBe(false);
  expect(listFiles(join(PKG, OUTPUT))).toEqual(listFiles(join(PKG, SOURCE)));
  const manifest = JSON.parse(readFileSync(join(PKG, 'generated/transformation-manifest.json'), 'utf8')) as { automations: string[]; spans: { file: string; output: string; rule: string }[] };
  expect(manifest.automations).toEqual(listFiles(join(PKG, SOURCE)).map((file) => `${OUTPUT}/${file}`));
  const changed = new Set(manifest.spans.filter((span) => span.file.startsWith(SOURCE)).map((span) => span.output));
  expect(changed.size).toBeGreaterThan(5);
  for (const output of changed) expect(output.startsWith(`${OUTPUT}/`)).toBe(true);
});

test('a hand edit to the shipped pack fails the parity gate', () => {
  const root = withFixture();
  writeFileSync(join(root, OUTPUT, 'README.md'), `${readFileSync(join(root, OUTPUT, 'README.md'), 'utf8')}\nhand edit\n`);
  const result = run('check-parity.mjs', ['--root', root]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(`${OUTPUT}/README.md: differs from a fresh compile`);
});

test('a changed upstream phrase in the pack fails the build and leaves the generated tree alone', () => {
  const root = withFixture();
  const file = join(root, SOURCE, 'README.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace('point cursor at', 'direct cursor at'));
  const before = treeHash(join(root, 'generated'));
  const result = run('compile-skills.mjs', ['--root', root]);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/rule readme\.\S+ expected 1 match\(es\), found 0/);
  expect(treeHash(join(root, 'generated'))).toBe(before);
});

test('new upstream pack text that names a Cursor primitive no rule maps fails the build', () => {
  const root = withFixture();
  const file = join(root, SOURCE, 'skills/triage-issue-reports/references/routing.example.md');
  writeFileSync(file, `${readFileSync(file, 'utf8')}\nAsk Cursor to open the Automations editor.\n`);
  const result = run('compile-skills.mjs', ['--root', root]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Cursor');
});

test('a new upstream pack file with no rule still compiles and ships, and regeneration is byte stable', () => {
  const root = withFixture();
  writeFileSync(join(root, SOURCE, 'NOTES.md'), '# Notes\n\nPlain text.\n');
  expect(run('compile-skills.mjs', ['--root', root]).status).toBe(0);
  expect(readFileSync(join(root, OUTPUT, 'NOTES.md'), 'utf8')).toBe('# Notes\n\nPlain text.\n');
  const first = treeHash(join(root, 'generated'));
  expect(run('compile-skills.mjs', ['--root', root]).status).toBe(0);
  expect(treeHash(join(root, 'generated'))).toBe(first);
});
