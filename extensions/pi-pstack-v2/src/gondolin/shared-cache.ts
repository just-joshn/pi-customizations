import { lstatSync, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Outside Gondolin's built-in tmpfs mounts (/tmp, /root, /var/tmp, /var/cache, /var/log), so the cache is the host's. */
export const GUEST_BUILD_CACHE = '/cache';

const PRIVATE_DIR_MODE = 0o700;
const GROUP_OTHER_BITS = 0o077;

/** Each build-tool cache variable and the subdirectory of the shared cache it points at. */
export const BUILD_CACHE_ENV_SUBDIRS: Readonly<Record<string, string>> = {
  npm_config_cache: 'npm',
  YARN_CACHE_FOLDER: 'yarn',
  PNPM_STORE_DIR: 'pnpm',
  BUN_INSTALL_CACHE_DIR: 'bun',
  PIP_CACHE_DIR: 'pip',
  UV_CACHE_DIR: 'uv',
  CARGO_HOME: 'cargo',
  GOMODCACHE: 'go/mod',
  GOCACHE: 'go/build',
  XDG_CACHE_HOME: 'xdg',
};

const currentUid = (): number => process.getuid?.() ?? 0;

export function sharedBuildCacheHostDir(baseTmpDir: string = os.tmpdir(), uid: number = currentUid()): string {
  return path.join(baseTmpDir, `pi-gondolin-build-cache-${uid}`);
}

/** Creates the host cache directory and its subdirectories, refusing a directory another local user could have made. */
export function ensureSharedBuildCacheDir(hostDir: string, uid: number = currentUid()): string {
  mkdirSync(hostDir, { recursive: true, mode: PRIVATE_DIR_MODE });
  const stat = lstatSync(hostDir);
  if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & GROUP_OTHER_BITS) !== 0) throw new Error(`${hostDir} must be a directory owned by you with mode 700.`);
  for (const subdir of new Set(Object.values(BUILD_CACHE_ENV_SUBDIRS))) mkdirSync(path.join(hostDir, subdir), { recursive: true, mode: PRIVATE_DIR_MODE });
  return hostDir;
}

export function buildCacheEnv(rootDir: string, pathImpl: Pick<typeof path, 'join'> = path.posix): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(BUILD_CACHE_ENV_SUBDIRS).map(([name, subdir]) => [name, pathImpl.join(rootDir, subdir)]));
}
