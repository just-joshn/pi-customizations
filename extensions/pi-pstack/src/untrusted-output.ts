// Reading files a container worker wrote. The worker owns that directory and can swap any entry in it for a symlink at any
// moment, so nothing here follows a symlink and no check is trusted past the read it guards. Plain Node.
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';

export type FileRead = { kind: 'ok'; bytes: Buffer } | { kind: 'missing' } | { kind: 'refused'; reason: string };

const isRegularDirectory = (path: string): boolean => {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  return stat !== undefined && stat.isDirectory() && !stat.isSymbolicLink();
};

/**
 * Reads the regular file at `rel` below `root` (a directory the worker controls). Every directory on the way must be a real
 * directory, and the file is opened with O_NOFOLLOW. After the open, the path must still resolve to the very file that was
 * opened, so a component swapped for a symlink between the check and the open is caught instead of followed.
 */
export function readFileBelow(root: string, rel: string): FileRead {
  const base = realpathSync(root);
  const parts = rel.split('/').filter((part) => part !== '');
  if (parts.length === 0 || parts.some((part) => part === '..' || part === '.')) return { kind: 'refused', reason: `${rel} is not a path below the worker output directory` };
  let directory = base;
  for (const part of parts.slice(0, -1)) {
    directory = join(directory, part);
    const stat = lstatSync(directory, { throwIfNoEntry: false });
    if (stat === undefined) return { kind: 'missing' };
    if (!isRegularDirectory(directory)) return { kind: 'refused', reason: `${relative(base, directory)} is not a plain directory` };
  }
  const file = join(directory, parts.at(-1) as string);
  const before = lstatSync(file, { throwIfNoEntry: false });
  if (before === undefined) return { kind: 'missing' };
  if (before.isSymbolicLink() || !before.isFile()) return { kind: 'refused', reason: `${rel} is not a regular file` };
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') return { kind: 'refused', reason: `${rel} became a symlink` };
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    throw error;
  }
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile()) return { kind: 'refused', reason: `${rel} is not a regular file` };
    const resolved = lstatSync(realpathSync(file));
    if (realpathSync(file) !== file || resolved.ino !== opened.ino || resolved.dev !== opened.dev) return { kind: 'refused', reason: `${rel} no longer names the file that was opened` };
    return { kind: 'ok', bytes: readFileSync(fd) };
  } finally {
    closeSync(fd);
  }
}

/** The regular files below the directory at `rel`, relative to it and sorted. Symlinks, of any kind, are skipped, so no walk leaves `root`. */
export function listFilesBelow(root: string, rel: string): string[] {
  const base = realpathSync(root);
  const start = join(base, rel);
  const files: string[] = [];
  const walk = (directory: string) => {
    if (!isRegularDirectory(directory)) return;
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      const stat = lstatSync(path, { throwIfNoEntry: false });
      if (stat === undefined || stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) files.push(relative(start, path));
    }
  };
  walk(start);
  return files.sort();
}
