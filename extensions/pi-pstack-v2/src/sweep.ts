import { appendFileSync, chmodSync, cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { z } from 'zod';

/**
 * What a checkout held when a job started, so that the unsandboxed wrapper can quarantine, after the job, every path an
 * unsandboxed process would later execute from that the job made appear. A job can make one appear even where it may
 * not write it directly, by renaming a directory it built into place or by linking a parent elsewhere.
 */
export interface Inventory {
  /** Checkouts the job may write, walked without following links. */
  roots: string[];
  /** Protected paths absent at launch, each with whether its parent was already a link. */
  absent: { path: string; parentWasLink: boolean }[];
  /** Code entries present at launch, which the sweep leaves alone. */
  present: string[];
  /** Where swept paths go, and where the job's output notes them. */
  quarantine: string;
  output: string;
}

const InventorySchema: z.ZodType<Inventory> = z.object({
  roots: z.array(z.string()),
  absent: z.array(z.object({ path: z.string(), parentWasLink: z.boolean() })),
  present: z.array(z.string()),
  quarantine: z.string(),
  output: z.string(),
});

/** Pi loads code from these entries of any `.pi` directory, at any depth, once the project is trusted. */
export const PI_CODE = ['extensions', 'settings.json', 'mcp.json', 'npm', 'git'] as const;

/**
 * Editors and other agent harnesses run what these hold, unsandboxed, once you open the checkout in them: VS Code and
 * JetBrains tasks, and agent-harness hooks and MCP servers. pstack's sandbox refuses writing them at any depth. Every
 * entry of a harness directory is code apart from its instructions, which a job may still write.
 */
export const EDITOR_CODE = ['.vscode', '.idea', '.cursorignore'] as const;
export const WORKSPACE_SUFFIX = '.code-workspace';
export const HARNESS_DIRS = ['.cursor', '.claude'] as const;
export const HARNESS_INSTRUCTIONS = ['rules', 'commands', 'worktrees', 'skills', 'agents'] as const;

const includes = (list: readonly string[], name: string): boolean => list.includes(name);
/** Which entries of each such directory are code. */
const CODE_DIRS = new Map<string, (entry: string) => boolean>([['.pi', (entry) => includes(PI_CODE, entry)], ...HARNESS_DIRS.map((dir) => [dir, (entry: string) => !includes(HARNESS_INSTRUCTIONS, entry)] as const)]);
/** Entries that are code whole: any .git, and editor configuration. */
const wholeCode = (name: string): boolean => name === '.git' || includes(EDITOR_CODE, name) || name.endsWith(WORKSPACE_SUFFIX);

const exists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

/**
 * Code entries (Pi, git, editor, and harness) under the roots, found without following links or descending into heavy or git
 * directories. With `repair`, a directory the job made unreadable gets its owner permissions back so it can be searched,
 * and anything still unreadable lands in `unreadable`, since a job could otherwise hide code from the sweep that way.
 */
export function codePaths(roots: string[], repair = false): string[] {
  return scanCode(roots, repair).found;
}

type Scan = { found: string[]; unreadable: string[] };
const EMPTY_SCAN: Scan = { found: [], unreadable: [] };
const joinScans = (scans: Scan[]): Scan => ({ found: scans.flatMap((scan) => scan.found), unreadable: scans.flatMap((scan) => scan.unreadable) });

/** Reads with `read`, and with `repair` retries once after restoring owner permissions. Fails with the path as unreadable. */
function attempt<T>(path: string, repair: boolean, read: () => T): { value?: T; unreadable: string[] } {
  try {
    return { value: read(), unreadable: [] };
  } catch {
    if (!repair) return { unreadable: [] };
  }
  try {
    chmodSync(path, (lstatSync(path).mode & 0o7777) | 0o700);
    return { value: read(), unreadable: [] };
  } catch {
    return { unreadable: [path] };
  }
}

/** Like `codePaths`, and also names every directory that stayed unreadable even after repair. */
function scanCode(roots: string[], repair: boolean): Scan {
  // Links are never followed, so the walk cannot loop and needs no depth limit.
  const walk = (dir: string): Scan => {
    // Inside a code directory such as `.pi` or `.claude`, its code entries are found and the rest is searched like any directory.
    const isCode = CODE_DIRS.get(basename(dir));
    const listing = attempt(dir, repair, () => readdirSync(dir));
    const entries = (listing.value ?? []).map((name) => {
      const path = join(dir, name);
      const stat = attempt(dir, repair, () => lstatSync(path));
      return { name, path, stat: stat.value, unreadable: stat.unreadable };
    });
    const scans = entries.map(({ name, path, stat, unreadable }): Scan => {
      if (!stat) return { found: [], unreadable };
      if (wholeCode(name) || isCode?.(name) || (CODE_DIRS.has(name) && stat.isSymbolicLink())) return { found: [path], unreadable };
      return stat.isDirectory() && name !== 'node_modules' ? joinScans([{ found: [], unreadable }, walk(path)]) : { found: [], unreadable };
    });
    return joinScans([{ found: [], unreadable: listing.unreadable }, ...scans]);
  };
  return joinScans([EMPTY_SCAN, ...roots.map(walk)]);
}

export function inventory(roots: string[], protect: string[], quarantine: string, output: string): Inventory {
  const absent = protect.filter((path) => !exists(path)).map((path) => ({ path, parentWasLink: exists(dirname(path)) && lstatSync(dirname(path)).isSymbolicLink() }));
  return { roots, absent, present: codePaths(roots), quarantine, output };
}

// Moving a path out needs write permission on its parent, and a directory also on itself, which a job can take away.
// chmod follows links, so only real directories are touched.
function makeWritable(path: string): void {
  const stat = lstatSync(path);
  if (stat.isDirectory()) chmodSync(path, (stat.mode & 0o7777) | 0o700);
}

/** Renames into quarantine, which can sit on another filesystem. Copying keeps links as links and removing never follows one. */
function relocate(path: string, target: string): void {
  try {
    renameSync(path, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    cpSync(path, target, { recursive: true, verbatimSymlinks: true });
    rmSync(path, { recursive: true, force: true });
  }
}

/** Quarantines one path and notes it in the job's output. Returns whether it moved. */
function quarantine(inv: Inventory, path: string, reason: string, serial: number): boolean {
  if (!exists(path)) return false;
  try {
    mkdirSync(inv.quarantine, { recursive: true });
    const target = join(inv.quarantine, `${Date.now()}-${serial}-${basename(path)}`);
    makeWritable(dirname(path));
    makeWritable(path);
    relocate(path, target);
    appendFileSync(inv.output, `pstack quarantined ${path}, ${reason}, in ${inv.quarantine}.\n`);
    return true;
  } catch (error) {
    appendFileSync(inv.output, `pstack could not quarantine ${path}, ${reason}: ${String(error)}. Check it before you start Pi in this checkout.\n`);
    return false;
  }
}

type Move = { path: string; reason: string };

/** What to move for a protected path that was absent at launch: a link that appeared over its parent, else the path itself. */
function absentMoveOf({ path, parentWasLink }: Inventory['absent'][number]): Move {
  const parent = dirname(path);
  if (!parentWasLink && exists(parent) && lstatSync(parent).isSymbolicLink()) return { path: parent, reason: 'a link that appeared over a protected path while the job ran' };
  return { path, reason: 'which appeared while the job ran' };
}

/** Moves each path in order, then returns the earlier moves with the ones that happened. */
const moveAll = (inv: Inventory, moves: Move[], moved: string[]): string[] =>
  moves.reduce((done, { path, reason }) => (quarantine(inv, path, reason, done.length) ? [...done, path] : done), moved);

/** Moves each path that appeared during the job into quarantine, never following a link, and returns what it moved. */
export function sweep(inv: Inventory): string[] {
  // Each path is decided after the earlier moves, since a move can change what its parent is.
  const afterAbsent = inv.absent.reduce((moved, entry) => moveAll(inv, [absentMoveOf(entry)], moved), [] as string[]);
  const present = new Set(inv.present);
  const scan = scanCode(inv.roots, true);
  const moved = moveAll(inv, scan.found.filter((path) => !present.has(path)).map((path) => ({ path, reason: 'Pi, git, editor, or harness code that appeared while the job ran' })), afterAbsent);
  for (const path of new Set(scan.unreadable)) appendFileSync(inv.output, `pstack could not search ${path} for Pi, git, editor, or harness code the job may have left there. Check it before you start Pi in this checkout.\n`);
  return moved;
}

// The wrapper runs this file directly once the job has ended: `node sweep.ts <inventory.json>`.
if (process.argv[1] && basename(process.argv[1]) === 'sweep.ts' && process.argv[2]) {
  const inv = InventorySchema.parse(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  try {
    sweep(inv);
  } catch (error) {
    appendFileSync(inv.output, `pstack could not finish checking this job's checkout for Pi, git, editor, or harness code it left behind: ${String(error)}\n`);
  }
}

export const inventoryFile = (out: string): string => join(out, 'inventory.json');
