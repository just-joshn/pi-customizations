import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { type Inventory, sweep, inventory as takeInventory } from '../src/sweep.ts';

let work: string;
let inventory: Inventory;

beforeEach(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-sweep-')));
  const output = join(work, 'output.log');
  writeFileSync(output, '');
  inventory = { roots: [], absent: [], present: [], guards: [], quarantine: join(work, 'quarantine'), output };
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of ['.pi', 'locked']) if (existsSync(join(work, dir))) chmodSync(join(work, dir), 0o755);
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

  test('Pi code and git repositories that appear in a checkout are moved out, and what was there at launch stays', () => {
    mkdirSync(join(work, 'kept', '.pi', 'extensions'), { recursive: true });
    const before = takeInventory([work], [], inventory.quarantine, inventory.output);
    mkdirSync(join(work, 'deep', '.pi'), { recursive: true });
    writeFileSync(join(work, 'deep', '.pi', 'settings.json'), '{}');
    writeFileSync(join(work, 'deep', '.pi', 'notes.md'), '');
    mkdirSync(join(work, 'deep', 'repo', '.git'), { recursive: true });
    mkdirSync(join(work, 'nested'));
    symlinkSync(join(work, 'kept', '.pi'), join(work, 'nested', '.pi'));
    expect(sweep(before).sort()).toEqual([join(work, 'deep', '.pi', 'settings.json'), join(work, 'deep', 'repo', '.git'), join(work, 'nested', '.pi')].sort());
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
    expect(sweep(before).sort()).toEqual(
      [join(work, '.vscode'), join(work, 'app.code-workspace'), join(work, '.claude', 'settings.json'), join(work, '.claude', 'skills', 'probe', '.pi', 'extensions'), join(work, 'sub', '.cursor', 'hooks.json')].sort(),
    );
    expect(existsSync(join(work, '.claude', 'skills', 'probe', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(work, 'sub', '.cursor', 'rules'))).toBe(true);
  });

  test('installed packages are not searched, since Pi never loads project code from them', () => {
    const before = takeInventory([work], [], inventory.quarantine, inventory.output);
    mkdirSync(join(work, 'node_modules', 'pkg', '.git'), { recursive: true });
    expect(sweep(before)).toEqual([]);
  });

  test('a directory the job made unreadable is opened and searched, so code cannot hide in it', () => {
    const before = takeInventory([work], [], inventory.quarantine, inventory.output);
    mkdirSync(join(work, 'locked', '.pi', 'extensions'), { recursive: true });
    chmodSync(join(work, 'locked'), 0o000);
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

  test('a guarded file the job changed is quarantined and put back, one it removed is put back, and one it left alone is not touched', () => {
    const changed = join(work, 'config');
    const removed = join(work, 'worktree-config');
    const same = join(work, 'info');
    for (const path of [changed, removed, same]) writeFileSync(path, `original ${path}\n`);
    chmodSync(changed, 0o640);
    const before = takeInventory([], [], inventory.quarantine, inventory.output, { files: [changed, removed, same, join(work, 'absent')], dir: join(work, 'guard') });
    writeFileSync(changed, '[core]\n\tfsmonitor = touch pwned\n');
    rmSync(removed);
    expect(sweep(before)).toEqual([changed]);
    expect([readFileSync(changed, 'utf8'), readFileSync(removed, 'utf8'), readFileSync(same, 'utf8')]).toEqual([`original ${changed}\n`, `original ${removed}\n`, `original ${same}\n`]);
    expect(lstatSync(changed).mode & 0o777).toBe(0o640);
    expect(existsSync(join(work, 'absent'))).toBe(false);
    const output = readFileSync(inventory.output, 'utf8');
    expect(output).toContain(`pstack quarantined ${changed}, a guarded file that the job changed or removed`);
    expect(output).toContain(`pstack restored ${removed}`);
  });

  test('a guarded file the job replaced with a directory is moved out and the original comes back', () => {
    const guarded = join(work, 'commondir');
    writeFileSync(guarded, '../..\n');
    const before = takeInventory([], [], inventory.quarantine, inventory.output, { files: [guarded], dir: join(work, 'guard') });
    rmSync(guarded);
    mkdirSync(guarded);
    sweep(before);
    expect(readFileSync(guarded, 'utf8')).toBe('../..\n');
  });

  test('a guarded path that did not exist at launch is quarantined when it appears', () => {
    const later = join(work, 'config.worktree');
    const before = takeInventory([], [later], inventory.quarantine, inventory.output, { files: [later], dir: join(work, 'guard') });
    writeFileSync(later, '[core]\n');
    expect(sweep(before)).toEqual([later]);
    expect(existsSync(later)).toBe(false);
  });
});
