import { spawnSync } from 'node:child_process';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { MappingSchema, readJson } from '../lib/schemas.ts';

const dev = join(import.meta.dirname, '..');
const themePath = join(dev, '../themes/claude-default-dark.json');
const baseMapping = () => readJson(join(dev, 'mapping.json'), MappingSchema);

function generate(edit: (roles: ReturnType<typeof baseMapping>['roles']) => void) {
  const mapping = baseMapping();
  edit(mapping.roles);
  const file = join(mkdtempSync(join(tmpdir(), 'gen-theme-')), 'mapping.json');
  writeFileSync(file, JSON.stringify(mapping));
  const before = statSync(themePath).mtimeMs;
  const run = spawnSync(process.execPath, [join(dev, 'scripts/generate-theme.ts'), file], { encoding: 'utf8' });
  return { status: run.status, stderr: run.stderr, themeTouched: statSync(themePath).mtimeMs !== before };
}

describe('generate-theme refuses evidence that does not prove the value', () => {
  test('a foreground pointer on a blank cell', () => {
    const run = generate((roles) => {
      roles.mdHr = { class: 'measured', source: 'capture', value: 'default', direction: 'fg', evidence: ['markdown@26:0'] };
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/mdHr: evidence markdown@26:0 is a blank cell/);
    expect(run.themeTouched).toBe(false);
  });

  test('a capture value on a role ruled unmappable', () => {
    const run = generate((roles) => {
      roles.bashMode = { class: 'unmappable', source: 'capture', value: 'default', direction: 'fg', evidence: ['markdown@26:0'] };
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/bashMode: an unmappable role keeps the stock Pi value/);
    expect(run.themeTouched).toBe(false);
  });
});
