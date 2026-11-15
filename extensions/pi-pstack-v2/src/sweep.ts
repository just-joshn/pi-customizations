import { appendFileSync, chmodSync, cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

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
  /** Pi code entries and .git entries present at launch, which the sweep leaves alone. */
  present: string[];
  /** Where swept paths go, and where the job's output notes them. */
  quarantine: string;
  output: string;
}

/** Pi loads code from these entries of any `.pi` directory, at any depth, once the project is trusted. */
export const PI_CODE = ['extensions', 'settings.json', 'mcp.json', 'npm', 'git'] as const;

const exists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

/**
 * Pi code entries and .git entries under the roots, found without following links or descending into heavy or git
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
    const names = attempt(dir, () => readdirSync(dir));
    for (const name of names ?? []) {
      const path = join(dir, name);
      const stat = attempt(dir, () => lstatSync(path));
      if (!stat) continue;
      if (name === '.git') {
        found.push(path);
      } else if (name === '.pi') {
        if (stat.isSymbolicLink()) found.push(path);
        else if (stat.isDirectory()) for (const code of attempt(path, () => readdirSync(path)) ?? []) if ((PI_CODE as readonly string[]).includes(code)) found.push(join(path, code));
      } else if (stat.isDirectory() && name !== 'node_modules') {
        walk(path);
      }
    }
  };
  for (const root of roots) walk(root);
  return found;
}

export function inventory(roots: string[], protect: string[], quarantine: string, output: string): Inventory {
  const absent = protect.filter((path) => !exists(path)).map((path) => ({ path, parentWasLink: exists(dirname(path)) && lstatSync(dirname(path)).isSymbolicLink() }));
  return { roots, absent, present: codePaths(roots), quarantine, output };
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
  const present = new Set(inv.present);
  const unreadable: string[] = [];
  for (const path of codePaths(inv.roots, true, unreadable)) if (!present.has(path)) move(path, 'Pi or git code that appeared while the job ran');
  for (const path of new Set(unreadable)) appendFileSync(inv.output, `pstack could not search ${path} for Pi or git code the job may have left there. Check it before you start Pi in this checkout.\n`);
  return moved;
}

// The wrapper runs this file directly once the job has ended: `node sweep.ts <inventory.json>`.
if (process.argv[1] && basename(process.argv[1]) === 'sweep.ts' && process.argv[2]) {
  const inv = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Inventory;
  try {
    sweep(inv);
  } catch (error) {
    appendFileSync(inv.output, `pstack could not finish checking this job's checkout for Pi or git code it left behind: ${String(error)}\n`);
  }
}

export const inventoryFile = (out: string): string => join(out, 'inventory.json');
