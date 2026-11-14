import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const dev = join(import.meta.dirname, '..');
const check = (edit: (lock: { terminal: Record<string, unknown>; target: Record<string, unknown> }) => void) => {
  const lock = JSON.parse(readFileSync(join(dev, 'reference-lock.json'), 'utf8'));
  edit(lock);
  const file = join(mkdtempSync(join(tmpdir(), 'lock-')), 'reference-lock.json');
  writeFileSync(file, JSON.stringify(lock));
  return spawnSync(process.execPath, [join(dev, 'scripts/lock.mjs'), '--check', '--lock', file], { encoding: 'utf8' });
};

describe('lock.mjs --check', () => {
  test('accepts a lock that matches the current environment', () => {
    const run = check(() => {});
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ drift: [] });
  });

  test('records the terminal font without treating a font change as drift', () => {
    const run = check((l) => {
      l.terminal['font'] = 'Some Other Mono';
      l.terminal['font_size'] = 99;
    });
    expect(run.status, run.stdout).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ drift: [] });
  });

  type Lock = { terminal: Record<string, unknown>; target: Record<string, unknown> };
  test.for<[string, (lock: Lock) => void, string]>([
    ['terminal emulator version', (l) => (l.terminal['emulator_version'] = '0.0.0'), 'terminal.emulator_version'],
    ['Claude binary hash', (l) => (l.target['actual_binary_sha256'] = '0'.repeat(64)), 'target.actual_binary_sha256'],
  ])('reports drift in %s and exits 1', ([, edit, field]) => {
    const run = check(edit);
    expect(run.status).toBe(1);
    expect(JSON.parse(run.stdout).drift).toContain(field);
  });
});
