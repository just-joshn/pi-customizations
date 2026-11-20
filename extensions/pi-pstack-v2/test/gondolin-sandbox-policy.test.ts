import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ReadonlyProvider, ShadowProvider } from '@earendil-works/gondolin';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { GUEST_WORKSPACE } from '../src/gondolin/paths.ts';
import { createDefaultNetworkPolicy, createVmOptions, createWorkspaceProvider, DEFAULT_ALLOWED_HOSTS, PROTECTED_GIT_PATHS } from '../src/gondolin/policy.ts';

const EACCES = os.constants.errno.EACCES;
const EXDEV = os.constants.errno.EXDEV;
const PUBLIC_IP = '93.184.216.34';
const HTTPS_PORT = 443;
const IPV4_FAMILY = 4;
const IPV6_FAMILY = 6;
const SRC_DIR = '/src';
const GIT_HOOKS_DIR = '/.git/hooks';
const SRC_FILE = '/src/file.txt';
const PRE_COMMIT = '/.git/hooks/pre-commit';
const POST_CHECKOUT = '/.git/hooks/post-checkout';
const GIT_CONFIG = '/.git/config';
const CONFIG_COPY = '/src/config-copy';
const HOOKS_LINK = '/src/hooks-link';
const HOOKS_LINK_PRE_COMMIT = '/src/hooks-link/pre-commit';

const ORIGINAL_CONTENT: Readonly<Record<string, string | undefined>> = { [PRE_COMMIT]: 'hook', [GIT_CONFIG]: 'config', [POST_CHECKOUT]: undefined };

let dir = '';
const hostFile = (guestPath: string) => path.join(dir, guestPath);
const readHostIfPresent = (guestPath: string) => (fs.existsSync(hostFile(guestPath)) ? fs.readFileSync(hostFile(guestPath), 'utf8') : undefined);
const readHost = (guestPath: string) => fs.readFileSync(hostFile(guestPath), 'utf8');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gondolin-policy-'));
  fs.mkdirSync(hostFile(SRC_DIR));
  fs.mkdirSync(hostFile(GIT_HOOKS_DIR), { recursive: true });
  fs.writeFileSync(hostFile(SRC_FILE), 'source');
  fs.writeFileSync(hostFile(GIT_CONFIG), 'config');
  fs.writeFileSync(hostFile(PRE_COMMIT), 'hook');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const errnoOf = (operation: Promise<unknown>): Promise<number | undefined> =>
  operation.then(
    () => undefined,
    (error: unknown) => (error as { errno?: number }).errno,
  );

const writeThrough = async (provider: ShadowProvider, guestPath: string, content: string) => {
  const handle = await provider.open(guestPath, 'w');
  try {
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
};

describe('workspace provider', () => {
  test('protects the git hooks and config paths', () => {
    expect(PROTECTED_GIT_PATHS).toEqual([GIT_HOOKS_DIR, GIT_CONFIG]);
  });

  test('reads and writes ordinary workspace files on the real host file', async () => {
    const provider = createWorkspaceProvider(dir);
    const handle = await provider.open(SRC_FILE, 'r');
    expect((await handle.readFile()).toString()).toBe('source');
    await handle.close();
    await writeThrough(provider, SRC_FILE, 'changed');
    expect(readHost(SRC_FILE)).toBe('changed');
  });

  test.each([PRE_COMMIT, POST_CHECKOUT, GIT_CONFIG])('denies writing %s with EACCES and leaves the host unchanged', async (guestPath) => {
    const provider = createWorkspaceProvider(dir);
    expect(await errnoOf(writeThrough(provider, guestPath, 'pwned'))).toBe(EACCES);
    expect(readHostIfPresent(guestPath)).toBe(ORIGINAL_CONTENT[guestPath]);
  });

  test.each([PRE_COMMIT, GIT_CONFIG])('denies unlinking %s with EACCES', async (guestPath) => {
    expect(await errnoOf(createWorkspaceProvider(dir).unlink(guestPath))).toBe(EACCES);
    expect(fs.existsSync(hostFile(guestPath))).toBe(true);
  });

  test('refuses to rename protected files or onto protected paths', async () => {
    const provider = createWorkspaceProvider(dir);
    expect(await errnoOf(provider.rename(PRE_COMMIT, POST_CHECKOUT))).toBe(EXDEV);
    expect(await errnoOf(provider.rename(GIT_CONFIG, CONFIG_COPY))).toBe(EXDEV);
    expect(await errnoOf(provider.rename(SRC_FILE, POST_CHECKOUT))).toBe(EXDEV);
    expect(readHost(PRE_COMMIT)).toBe('hook');
    expect(readHost(GIT_CONFIG)).toBe('config');
    expect(readHost(SRC_FILE)).toBe('source');
    expect(fs.existsSync(hostFile(POST_CHECKOUT))).toBe(false);
  });

  test('a symlink to the hooks directory does not bypass the protection', async () => {
    const provider = createWorkspaceProvider(dir);
    await provider.symlink(GIT_HOOKS_DIR, HOOKS_LINK);
    expect(await errnoOf(writeThrough(provider, HOOKS_LINK_PRE_COMMIT, 'pwned'))).toBeDefined();
    expect(await errnoOf(provider.unlink(HOOKS_LINK_PRE_COMMIT))).toBeDefined();
    expect(readHost(PRE_COMMIT)).toBe('hook');
  });
});

describe('default network policy', () => {
  const allowed = (hostname: string, ip = PUBLIC_IP) => createDefaultNetworkPolicy().httpHooks.isIpAllowed?.({ hostname, ip, family: ip.includes(':') ? IPV6_FAMILY : IPV4_FAMILY, port: HTTPS_PORT, protocol: 'https' });

  test.each(['api.github.com', 'github.com', 'registry.npmjs.org', 'pypi.org', 'crates.io', 'proxy.golang.org', 'dl-cdn.alpinelinux.org'])('allows the development endpoint %s', async (hostname) => {
    expect(await allowed(hostname)).toBe(true);
  });

  test.each(['example.com', 'evil.invalid', 'httpbin.org', 'evilgithub.com'])('blocks the arbitrary public host %s', async (hostname) => {
    expect(await allowed(hostname)).toBe(false);
  });

  test.each(['127.0.0.1', '169.254.169.254', '10.0.0.1', '::1'])('blocks the internal address %s even for an allowed host', async (ip) => {
    expect(await allowed('github.com', ip)).toBe(false);
  });

  test('allowlist has no duplicates', () => {
    expect(new Set(DEFAULT_ALLOWED_HOSTS).size).toBe(DEFAULT_ALLOWED_HOSTS.length);
  });
});

describe('VM options', () => {
  test('wire workspace protection, the read-only package mount, and restricted network hooks', () => {
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gondolin-package-'));
    try {
      const options = createVmOptions(dir, packageRoot);
      const mounts = options.vfs?.mounts ?? {};
      expect(Object.keys(mounts).toSorted()).toEqual([GUEST_WORKSPACE, packageRoot].toSorted());
      expect(mounts[GUEST_WORKSPACE]).toBeInstanceOf(ShadowProvider);
      expect(mounts[packageRoot]).toBeInstanceOf(ReadonlyProvider);
      expect(options.sessionLabel).toBe(`pi ${path.basename(dir)}`);
      expect(options.httpHooks).toBeDefined();
      expect(options.env).toBeDefined();
    } finally {
      fs.rmSync(packageRoot, { recursive: true, force: true });
    }
  });
});
