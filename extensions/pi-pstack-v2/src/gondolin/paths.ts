import * as path from 'node:path';

import { isInsideHostPath } from '../paths.ts';

/** The guest directory the host working directory is mounted at. */
export const GUEST_WORKSPACE = '/workspace';
const GUEST_ROOT = '/';

const stripAtPrefix = (value: string): string => (value.startsWith('@') ? value.slice(1) : value);

export const toPosix = (value: string): string => value.split(path.sep).join(path.posix.sep);

const hostPathToGuest = (localCwd: string, hostPath: string): string => {
  const relativePath = path.relative(localCwd, hostPath);
  return relativePath ? path.posix.join(GUEST_WORKSPACE, toPosix(relativePath)) : GUEST_WORKSPACE;
};

/**
 * Maps a path a tool received to the guest. Relative paths and host paths inside the working directory land under
 * the workspace mount; other absolute paths name the same path in the guest's own filesystem.
 */
export function toGuestPath(localCwd: string, inputPath: string): string {
  const trimmed = stripAtPrefix(inputPath.trim());
  if (!trimmed) return GUEST_WORKSPACE;
  if (!path.isAbsolute(trimmed)) return path.posix.resolve(GUEST_WORKSPACE, toPosix(trimmed));
  return isInsideHostPath(localCwd, trimmed) ? hostPathToGuest(localCwd, trimmed) : path.posix.resolve(GUEST_ROOT, toPosix(trimmed));
}
