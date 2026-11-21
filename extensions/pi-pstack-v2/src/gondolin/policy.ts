import * as path from 'node:path';

import { createHttpHooks, createShadowPathPredicate, ReadonlyProvider, RealFSProvider, ShadowProvider, type VirtualProvider, type VMOptions } from '@earendil-works/gondolin';
import { GUEST_WORKSPACE, toPosix } from './paths.ts';
import { buildCacheEnv, GUEST_BUILD_CACHE } from './shared-cache.ts';

const GIT_HOOKS_PATH = '/.git/hooks';
const GIT_CONFIG_PATH = '/.git/config';

export const PROTECTED_GIT_PATHS: readonly string[] = [GIT_HOOKS_PATH, GIT_CONFIG_PATH];

/** Gondolin host patterns do not match apex domains with `*.x`, so apex domains are listed beside their wildcards. */
export const DEFAULT_ALLOWED_HOSTS: readonly string[] = [
  'github.com',
  '*.github.com',
  '*.githubusercontent.com',
  'ghcr.io',
  '*.ghcr.io',
  'registry.npmjs.org',
  '*.npmjs.org',
  'nodejs.org',
  '*.nodejs.org',
  'registry.yarnpkg.com',
  'bun.sh',
  '*.bun.sh',
  'pypi.org',
  '*.pypi.org',
  'files.pythonhosted.org',
  '*.pythonhosted.org',
  'crates.io',
  '*.crates.io',
  'static.rust-lang.org',
  'proxy.golang.org',
  'sum.golang.org',
  'storage.googleapis.com',
  'rubygems.org',
  '*.rubygems.org',
  'dl-cdn.alpinelinux.org',
  '*.alpinelinux.org',
  'repo1.maven.org',
  'repo.maven.apache.org',
  'registry-1.docker.io',
  'auth.docker.io',
  'production.cloudflare.docker.com',
];

export function createWorkspaceProvider(localCwd: string): ShadowProvider {
  return new ShadowProvider(new RealFSProvider(localCwd), {
    shouldShadow: createShadowPathPredicate([...PROTECTED_GIT_PATHS]),
    writeMode: 'deny',
  });
}

export function createDefaultNetworkPolicy() {
  return createHttpHooks({ allowedHosts: [...DEFAULT_ALLOWED_HOSTS] });
}

export type VmPolicyOptions = {
  localCwd: string;
  /** Host directories mounted read-only at the same path in the guest. */
  readonlyMounts: readonly string[];
  /** Host directory mounted writable at /cache, with the build-tool cache variables pointed into it. Unset leaves caches in the guest. */
  sharedBuildCacheDir?: string | undefined;
  /** A subagent's memory directory, mounted writable at its host path so the guest can keep notes in it. */
  writableMemoryDir?: string | undefined;
};

type Mount = [string, VirtualProvider];

/** A writable mount of `dir` at `guestPath`, which defaults to the same path, or no mount when `dir` is unset. */
const writableMount = (dir: string | undefined, guestPath?: string): Mount[] => (dir === undefined ? [] : [[toPosix(guestPath ?? dir), new RealFSProvider(dir)]]);

export function createVmOptions({ localCwd, readonlyMounts, sharedBuildCacheDir, writableMemoryDir }: VmPolicyOptions): VMOptions {
  const { httpHooks, env } = createDefaultNetworkPolicy();
  const mounts: Mount[] = [
    [GUEST_WORKSPACE, createWorkspaceProvider(localCwd)],
    ...readonlyMounts.map((dir): Mount => [toPosix(dir), new ReadonlyProvider(new RealFSProvider(dir))]),
    ...writableMount(sharedBuildCacheDir, GUEST_BUILD_CACHE),
    ...writableMount(writableMemoryDir),
  ];
  return {
    sessionLabel: `pi ${path.basename(localCwd)}`,
    httpHooks,
    env: sharedBuildCacheDir === undefined ? env : { ...env, ...buildCacheEnv(GUEST_BUILD_CACHE, path.posix) },
    vfs: { mounts: Object.fromEntries(mounts) },
  };
}
