import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from 'vitest';
import { compare, identities } from '../../scripts/lint-baseline.mjs';

const script = fileURLToPath(new URL('../../scripts/lint-baseline.mjs', import.meta.url));

const findBiome = () => {
  if (process.env['BIOME_BIN']) return process.env['BIOME_BIN'];
  for (let dir = dirname(script); dir !== dirname(dir); dir = dirname(dir)) if (existsSync(join(dir, 'node_modules/.bin/biome'))) return join(dir, 'node_modules/.bin/biome');
  return undefined;
};
const biome = findBiome();

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const project = (source: string) => {
  const root = mkdtempSync(join(tmpdir(), 'lint-baseline-'));
  dirs.push(root);
  mkdirSync(join(root, 'extensions/pi-pstack'), { recursive: true });
  writeFileSync(join(root, 'biome.json'), JSON.stringify({ formatter: { enabled: false }, assist: { enabled: false }, linter: { rules: { recommended: false, suspicious: { noVar: 'error', noDebugger: 'error' } } } }));
  const write = (text: string) => writeFileSync(join(root, 'extensions/pi-pstack/a.js'), text);
  write(source);
  const run = (mode: '--check' | '--update') => spawnSync(process.execPath, [script, mode, '--root', root, '--biome', biome as string], { encoding: 'utf8' });
  return { root, write, run };
};

describe.skipIf(!biome)('lint-baseline against Biome', () => {
  test('the recorded tree passes, and a diagnostic that only moved still passes', () => {
    const p = project('var a = 1;\nexport { a };\n');
    expect(p.run('--update').status).toBe(0);
    expect(p.run('--check').status).toBe(0);
    p.write('// a comment shifts every line\n\n\nvar a = 1;\nexport { a };\n');
    const moved = p.run('--check');
    expect(moved.status, moved.stderr).toBe(0);
  });

  test('a new diagnostic fails and is named', () => {
    const p = project('var a = 1;\nexport { a };\n');
    p.run('--update');
    p.write('var a = 1;\ndebugger;\nexport { a };\n');
    const result = p.run('--check');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('a.js:2:1');
    expect(result.stderr).toContain('noDebugger');
  });

  test('a second copy of an already-recorded diagnostic fails', () => {
    const p = project('var a = 1;\nexport { a };\n');
    p.run('--update');
    p.write('var a = 1;\nvar a = 1;\nexport { a };\n');
    expect(p.run('--check').status).toBe(1);
  });

  test('a removed diagnostic passes and is reported', () => {
    const p = project('var a = 1;\ndebugger;\nexport { a };\n');
    p.run('--update');
    p.write('var a = 1;\nexport { a };\n');
    const result = p.run('--check');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 baseline diagnostic(s) no longer occur');
  });

  test('a new diagnostic fails even when an old one was removed in the same change', () => {
    const p = project('var a = 1;\nexport { a };\n');
    p.run('--update');
    p.write('debugger;\nexport const a = 1;\n');
    const result = p.run('--check');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('no longer occur');
    expect(result.stderr).toContain('noDebugger');
  });

  test('a baseline recorded by another Biome version is refused', () => {
    const p = project('var a = 1;\n');
    p.run('--update');
    const path = join(p.root, 'extensions/pi-pstack/lint-baseline.json');
    writeFileSync(path, readFileSync(path, 'utf8').replace(/"biomeVersion": "[^"]+"/, '"biomeVersion": "0.0.0"'));
    const result = p.run('--check');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('0.0.0');
  });
});

describe('identity comparison', () => {
  const diagnostic = (line: number, message = 'm') => ({ category: 'lint/x', message, location: { path: 'f.ts', start: { line, column: 1 }, end: { line, column: 4 } } });
  const source = (lines: string[]) => () => lines.join('\n');

  test('line numbers are not part of identity, flagged text is', () => {
    const before = identities([diagnostic(1)], source(['foo()', 'bar()']));
    expect(
      compare(
        [...before.values()].map(({ at: _, ...e }) => e),
        identities([diagnostic(2)], source(['', 'foo()'])),
      ).added,
    ).toEqual([]);
    expect(
      compare(
        [...before.values()].map(({ at: _, ...e }) => e),
        identities([diagnostic(2)], source(['', 'baz()'])),
      ).added,
    ).toHaveLength(1);
  });

  test('generated parity results are outside the baseline', () => {
    const found = identities([{ category: 'format', message: 'm', location: { path: 'extensions/pi-pstack/parity-results/ci/x.json', start: { line: 0, column: 0 }, end: { line: 0, column: 0 } } }], () => '');
    expect(found.size).toBe(0);
  });
});
