import * as path from 'node:path';

/** The guest directory the host working directory is mounted at. */
export const GUEST_WORKSPACE = '/workspace';
const GUEST_ROOT = '/';

const stripAtPrefix = (value: string): string => (value.startsWith('@') ? value.slice(1) : value);

export const toPosix = (value: string): string => value.split(path.sep).join(path.posix.sep);

export const isInsideHostPath = (root: string, value: string): boolean => {
  const relativePath = path.relative(root, value);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
};

const hostPathToGuest = (localCwd: string, hostPath: string): string => {
  const relativePath = path.relative(localCwd, hostPath);
  if (!isInsideHostPath(localCwd, hostPath)) return toPosix(hostPath);
  return relativePath ? path.posix.join(GUEST_WORKSPACE, toPosix(relativePath)) : GUEST_WORKSPACE;
};

/**
 * Maps a path a tool received to the guest. Relative paths and host paths inside the working directory land under
 * the workspace mount; other absolute paths name the same path in the guest's own filesystem.
 */
export function toGuestPath(localCwd: string, inputPath: string): string {
  const trimmed = stripAtPrefix(inputPath.trim());
  if (!trimmed) return GUEST_WORKSPACE;
  if (path.isAbsolute(trimmed)) {
    if (isInsideHostPath(localCwd, trimmed)) return hostPathToGuest(localCwd, trimmed);
    return path.posix.resolve(GUEST_ROOT, toPosix(trimmed));
  }
  return path.posix.resolve(GUEST_WORKSPACE, toPosix(trimmed));
}
