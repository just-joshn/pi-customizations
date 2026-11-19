import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { type Inventory, sweep, inventory as takeInventory } from '../src/sweep.ts';

const DIR_MODE_OPEN = 0o755;
const DIR_MODE_READ_ONLY = 0o555;
const DIR_MODE_NONE = 0o000;
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
  for (const dir of ['.pi', 'locked']) if (existsSync(join(work, dir))) chmodSync(join(work, dir), DIR_MODE_OPEN);
  rmSync(work, { recursive: true, force: true });
});

const notRoot = process.getuid?.() !== 0;

describe.runIf(notRoot)('sweep', () => {
  test('quarantines a path whose parent the job made read-only', () => {
    const planted = join(work, '.pi', 'extensions');
    mkdirSync(planted, { recursive: true });
    writeFileSync(join(planted, 'x.ts'), 'planted');
    chmodSync(join(work, '.pi'), DIR_MODE_READ_ONLY);
    inventory = { ...inventory, absent: [{ path: planted, parentWasLink: false }] };
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
    inventory = { ...inventory, absent: [first, second].map((path) => ({ path, parentWasLink: false })) };
    expect(sweep(inventory)).toEqual([second]);
    expect(readFileSync(inventory.output, 'utf8')).toContain(`pstack could not quarantine ${first}`);
  });
});

describe.runIf(notRoot)('sweep, appearing code', () => {
  test('Pi code and git repositories that appear in a checkout are moved out, and what was there at launch stays', () => {
    mkdirSync(join(work, 'kept', '.pi', 'extensions'), { recursive: true });
    const before = takeInventory([work], [], inventory.quarantine, inventory.output);
    mkdirSync(join(work, 'deep', '.pi'), { recursive: true });
    writeFileSync(join(work, 'deep', '.pi', 'settings.json'), '{}');
    writeFileSync(join(work, 'deep', '.pi', 'notes.md'), '');
    mkdirSync(join(work, 'deep', 'repo', '.git'), { recursive: true });
    mkdirSync(join(work, 'nested'));
    symlinkSync(join(work, 'kept', '.pi'), join(work, 'nested', '.pi'));
    expect(sweep(before).toSorted()).toEqual([join(work, 'deep', '.pi', 'settings.json'), join(work, 'deep', 'repo', '.git'), join(work, 'nested', '.pi')].toSorted());
    expect(existsSync(join(work, 'kept', '.pi', 'extensions'))).toBe(true);
    expect(existsSync(join(work, 'deep', '.pi', 'notes.md'))).toBe(true);
    expect(readFileSync(inventory.output, 'utf8')).toContain(`pstack quarantined ${join(work, 'deep', 'repo', '.git')}, Pi, git, editor, or harness code that appeared while the job ran`);
  });

  test('editor and harness configuration that appears is moved out, and harness instructions stay', () => {
    mkdirSync(join(work, '.claude', 'skills'), { recursive: true });
    const before = takeInventory([work], [], inventory.quarantine, inventory.output);
    mkdirSync(join(work, '.vscode'));
    writeFileSync(join(work, '.vscode', 'tasks.json'), '{}');
    writeFileSync(join(work, 'app.code-workspace'), '{}');
    writeFileSync(join(work, '.claude', 'settings.json'), '{}');
    mkdirSync(join(work, '.claude', 'skills', 'probe'));
    writeFileSync(join(work, '.claude', 'skills', 'probe', 'SKILL.md'), '');
    mkdirSync(join(work, '.claude', 'skills', 'probe', '.pi', 'extensions'), { recursive: true });
    mkdirSync(join(work, 'sub', '.cursor', 'rules'), { recursive: true });
    writeFileSync(join(work, 'sub', '.cursor', 'hooks.json'), '{}');
    expect(sweep(before).toSorted()).toEqual(
      [join(work, '.vscode'), join(work, 'app.code-workspace'), join(work, '.claude', 'settings.json'), join(work, '.claude', 'skills', 'probe', '.pi', 'extensions'), join(work, 'sub', '.cursor', 'hooks.json')].toSorted(),
    );
    expect(existsSync(join(work, '.claude', 'skills', 'probe', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(work, 'sub', '.cursor', 'rules'))).toBe(true);
  });
});

describe.runIf(notRoot)('sweep, installed and protected paths', () => {
  test('installed packages are not searched, since Pi never loads project code from them', () => {
    const before = takeInventory([work], [], inventory.quarantine, inventory.output);
    mkdirSync(join(work, 'node_modules', 'pkg', '.git'), { recursive: true });
    expect(sweep(before)).toEqual([]);
  });

  test('a directory the job made unreadable is opened and searched, so code cannot hide in it', () => {
    const before = takeInventory([work], [], inventory.quarantine, inventory.output);
    mkdirSync(join(work, 'locked', '.pi', 'extensions'), { recursive: true });
    chmodSync(join(work, 'locked'), DIR_MODE_NONE);
    expect(sweep(before)).toEqual([join(work, 'locked', '.pi', 'extensions')]);
  });

  test('a link the job put over the parent of a protected path is moved out, not followed', () => {
    const target = join(work, 'target');
    mkdirSync(join(target, 'hooks'), { recursive: true });
    const protectedPath = join(work, 'gitdir', 'hooks');
    const before = takeInventory([], [protectedPath], inventory.quarantine, inventory.output);
    symlinkSync(target, join(work, 'gitdir'));
    expect(sweep(before)).toEqual([join(work, 'gitdir')]);
    expect(existsSync(join(target, 'hooks'))).toBe(true);
    expect(readFileSync(inventory.output, 'utf8')).toContain('a link that appeared over a protected path while the job ran');
  });

  test('a protected path that never appeared needs nothing', () => {
    const before = takeInventory([], [join(work, 'absent', 'hooks')], inventory.quarantine, inventory.output);
    expect(sweep(before)).toEqual([]);
    expect(readFileSync(inventory.output, 'utf8')).toBe('');
  });
});
