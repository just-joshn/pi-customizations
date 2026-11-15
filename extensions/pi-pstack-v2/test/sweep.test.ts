import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { type Inventory, sweep } from '../src/sweep.ts';

let work: string;
let inventory: Inventory;

beforeEach(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-sweep-')));
  const output = join(work, 'output.log');
  writeFileSync(output, '');
  inventory = { roots: [], absent: [], present: [], quarantine: join(work, 'quarantine'), output };
});

afterEach(() => {
  vi.restoreAllMocks();
  chmodSync(join(work, '.pi'), 0o755);
  rmSync(work, { recursive: true, force: true });
});

describe.runIf(process.getuid?.() !== 0)('sweep', () => {
  test('quarantines a path whose parent the job made read-only', () => {
    const planted = join(work, '.pi', 'extensions');
    mkdirSync(planted, { recursive: true });
    writeFileSync(join(planted, 'x.ts'), 'planted');
    chmodSync(join(work, '.pi'), 0o555);
    inventory.absent = [{ path: planted, parentWasLink: false }];
    expect(sweep(inventory)).toEqual([planted]);
    expect(existsSync(planted)).toBe(false);
  });

  test('one path that cannot move is noted and the next is still swept', () => {
    mkdirSync(join(work, '.pi'));
    const first = join(work, '.pi', 'settings.json');
    const second = join(work, '.pi', 'mcp.json');
    writeFileSync(first, '{}');
    writeFileSync(second, '{}');
    vi.spyOn(Date, 'now').mockReturnValue(1);
    mkdirSync(join(inventory.quarantine, '1-0-settings.json', 'occupied'), { recursive: true });
    inventory.absent = [first, second].map((path) => ({ path, parentWasLink: false }));
    expect(sweep(inventory)).toEqual([second]);
    expect(readFileSync(inventory.output, 'utf8')).toContain(`pstack could not quarantine ${first}`);
  });
});
