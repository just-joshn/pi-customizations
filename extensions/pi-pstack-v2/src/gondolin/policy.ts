import * as path from 'node:path';

import { createHttpHooks, createShadowPathPredicate, ReadonlyProvider, RealFSProvider, ShadowProvider, type VMOptions } from '@earendil-works/gondolin';
import { GUEST_WORKSPACE } from './paths.ts';

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

export function createVmOptions(localCwd: string, packageRoot: string): VMOptions {
  const { httpHooks, env } = createDefaultNetworkPolicy();
  return {
    sessionLabel: `pi ${path.basename(localCwd)}`,
    httpHooks,
    env,
    vfs: { mounts: { [GUEST_WORKSPACE]: createWorkspaceProvider(localCwd), [packageRoot]: new ReadonlyProvider(new RealFSProvider(packageRoot)) } },
  };
}
