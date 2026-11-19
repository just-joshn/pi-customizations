import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Resolves symlinks in the longest existing prefix, so a path that does not exist yet still compares by where it would land. */
export function landing(path: string): string {
  const absolute = resolve(path);
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = dirname(absolute);
  return parent === absolute ? absolute : join(landing(parent), relative(parent, absolute));
}

export const within = (path: string, roots: string[]): boolean =>
  roots.some((root) => {
    const inside = relative(landing(root), landing(path));
    return inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
  });
