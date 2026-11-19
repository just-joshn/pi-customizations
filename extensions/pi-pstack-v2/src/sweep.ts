import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, copyFileSync, cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** A file the container cannot mount read-only, as it was at launch, so the wrapper can put it back if the job changed it. */
export interface Guard {
  path: string;
  /** The launch-time copy, in a directory the job cannot write. */
  copy: string;
  sha: string;
  mode: number;
}

/**
 * What a checkout held when a job started, so that the wrapper, outside the container, can quarantine, after the job,
 * every path an uncontained process would later execute from that the job made appear. A job can make one appear even
 * where it may not write it directly, by renaming a directory it built into place or by linking a parent elsewhere.
 */
export interface Inventory {
  /** Checkouts the job may write, walked without following links. */
  roots: string[];
  /** Protected paths absent at launch, each with whether its parent was already a link. */
  absent: { path: string; parentWasLink: boolean }[];
  /** Code entries present at launch, which the sweep leaves alone. */
  present: string[];
  /** Guarded files that existed at launch. A changed or removed one is quarantined and restored. */
  guards: Guard[];
  /** Where swept paths go, and where the job's output notes them. */
  quarantine: string;
  output: string;
}

/** Pi loads code from these entries of any `.pi` directory, at any depth, once the project is trusted. */
export const PI_CODE = ['extensions', 'settings.json', 'mcp.json', 'npm', 'git'] as const;

/**
 * Editors and other agent harnesses run what these hold, outside the container, once you open the checkout in them: VS Code and
 * JetBrains tasks, and agent-harness hooks and MCP servers. pstack's container keeps the existing ones read-only and the sweep removes new ones. Every
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
export function codePaths(roots: string[], repair = false, unreadable: string[] = []): string[] {
  const found: string[] = [];
  const attempt = <T>(path: string, read: () => T): T | undefined => {
    try {
      return read();
    } catch {
      if (!repair) return undefined;
    }
    try {
      chmodSync(path, (lstatSync(path).mode & 0o7777) | 0o700);
      return read();
    } catch {
      unreadable.push(path);
      return undefined;
    }
  };
  // Links are never followed, so the walk cannot loop and needs no depth limit.
  const walk = (dir: string): void => {
    // Inside a code directory such as `.pi` or `.claude`, its code entries are found and the rest is searched like any directory.
    const isCode = CODE_DIRS.get(basename(dir));
    const names = attempt(dir, () => readdirSync(dir));
    for (const name of names ?? []) {
      const path = join(dir, name);
      const stat = attempt(dir, () => lstatSync(path));
      if (!stat) continue;
      if (wholeCode(name) || isCode?.(name) || (CODE_DIRS.has(name) && stat.isSymbolicLink())) {
        found.push(path);
      } else if (stat.isDirectory() && name !== 'node_modules') {
        walk(path);
      }
    }
  };
  for (const root of roots) walk(root);
  return found;
}

const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
const isFile = (path: string): boolean => {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
};

/** Copies each existing regular file in `files` into `dir`, with its hash, for the sweep to restore from. */
function snapshot(files: string[], dir: string): Guard[] {
  const present = files.filter(isFile);
  if (present.length) mkdirSync(dir, { recursive: true });
  return present.map((path, index) => {
    const copy = join(dir, String(index));
    copyFileSync(path, copy);
    return { path, copy, sha: sha(path), mode: lstatSync(path).mode & 0o7777 };
  });
}

export function inventory(roots: string[], protect: string[], quarantine: string, output: string, guard: { files: string[]; dir: string } = { files: [], dir: '' }): Inventory {
  const absent = protect.filter((path) => !exists(path)).map((path) => ({ path, parentWasLink: exists(dirname(path)) && lstatSync(dirname(path)).isSymbolicLink() }));
  return { roots, absent, present: codePaths(roots), guards: snapshot(guard.files, guard.dir), quarantine, output };
}

/** Moves each path that appeared during the job into quarantine, never following a link, and returns what it moved. */
export function sweep(inv: Inventory): string[] {
  const moved: string[] = [];
  // Moving a path out needs write permission on its parent, and a directory also on itself, which a job can take away.
  // chmod follows links, so only real directories are touched.
  const writable = (path: string): void => {
    const stat = lstatSync(path);
    if (stat.isDirectory()) chmodSync(path, (stat.mode & 0o7777) | 0o700);
  };
  const move = (path: string, reason: string): void => {
    if (!exists(path)) return;
    try {
      mkdirSync(inv.quarantine, { recursive: true });
      const target = join(inv.quarantine, `${Date.now()}-${moved.length}-${basename(path)}`);
      writable(dirname(path));
      writable(path);
      try {
        renameSync(path, target);
      } catch (error) {
        // Quarantine can sit on another filesystem than the checkout. Copying keeps links as links and removing never follows one.
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
        cpSync(path, target, { recursive: true, verbatimSymlinks: true });
        rmSync(path, { recursive: true, force: true });
      }
      moved.push(path);
      appendFileSync(inv.output, `pstack quarantined ${path}, ${reason}, in ${inv.quarantine}.\n`);
    } catch (error) {
      appendFileSync(inv.output, `pstack could not quarantine ${path}, ${reason}: ${String(error)}. Check it before you start Pi in this checkout.\n`);
    }
  };
  for (const { path, parentWasLink } of inv.absent) {
    const parent = dirname(path);
    if (!parentWasLink && exists(parent) && lstatSync(parent).isSymbolicLink()) move(parent, 'a link that appeared over a protected path while the job ran');
    else move(path, 'which appeared while the job ran');
  }
  for (const guard of inv.guards) {
    try {
      if (isFile(guard.path) && sha(guard.path) === guard.sha) continue;
      move(guard.path, 'a guarded file that the job changed or removed');
      mkdirSync(dirname(guard.path), { recursive: true });
      copyFileSync(guard.copy, guard.path);
      chmodSync(guard.path, guard.mode);
      appendFileSync(inv.output, `pstack restored ${guard.path}, which the job changed.\n`);
    } catch (error) {
      appendFileSync(inv.output, `pstack could not restore ${guard.path}: ${String(error)}. Check it before you start Pi in this checkout.\n`);
    }
  }
  const present = new Set(inv.present);
  const unreadable: string[] = [];
  for (const path of codePaths(inv.roots, true, unreadable)) if (!present.has(path)) move(path, 'Pi, git, editor, or harness code that appeared while the job ran');
  for (const path of new Set(unreadable)) appendFileSync(inv.output, `pstack could not search ${path} for Pi, git, editor, or harness code the job may have left there. Check it before you start Pi in this checkout.\n`);
  return moved;
}

// The wrapper runs this file directly once the job has ended: `node sweep.ts <inventory.json>`.
if (process.argv[1] && basename(process.argv[1]) === 'sweep.ts' && process.argv[2]) {
  const inv = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Inventory;
  try {
    sweep(inv);
  } catch (error) {
    appendFileSync(inv.output, `pstack could not finish checking this job's checkout for Pi, git, editor, or harness code it left behind: ${String(error)}\n`);
  }
}

export const inventoryFile = (out: string): string => join(out, 'inventory.json');
