import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ShadowProvider, VirtualProvider } from '@earendil-works/gondolin';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { type GondolinHost, GUEST, loadGondolin } from './core-gondolin-host.ts';

vi.mock('@earendil-works/gondolin', async (importOriginal) => ({ ...(await importOriginal<typeof import('@earendil-works/gondolin')>()), VM: { create: vi.fn() } }));

const EACCES = os.constants.errno.EACCES;
const EXDEV = os.constants.errno.EXDEV;
const EROFS = os.constants.errno.EROFS;
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const WRITE_PROBE = '/guest-write-probe.txt';
const PACKAGE_MANIFEST = '/package.json';
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
let host: GondolinHost;
const hostFile = (guestPath: string) => path.join(dir, guestPath);
const readHost = (guestPath: string) => fs.readFileSync(hostFile(guestPath), 'utf8');
const readHostIfPresent = (guestPath: string) => (fs.existsSync(hostFile(guestPath)) ? readHost(guestPath) : undefined);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gondolin-policy-'));
  fs.mkdirSync(hostFile(SRC_DIR));
  fs.mkdirSync(hostFile(GIT_HOOKS_DIR), { recursive: true });
  fs.writeFileSync(hostFile(SRC_FILE), 'source');
  fs.writeFileSync(hostFile(GIT_CONFIG), 'config');
  fs.writeFileSync(hostFile(PRE_COMMIT), 'hook');
  host = loadGondolin({ cwd: dir });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The workspace as the guest sees it: the provider the extension mounted at /workspace when it created the VM. */
const workspace = async (): Promise<ShadowProvider> => {
  await host.fire('session_start');
  return host.vmOptions()?.vfs?.mounts?.[GUEST] as ShadowProvider;
};

const errnoOf = (operation: Promise<unknown>): Promise<number | undefined> =>
  operation.then(
    () => undefined,
    (error: unknown) => (error as { errno?: number }).errno,
  );

const writeThrough = async (provider: ShadowProvider, guestPath: string, content: string) => {
  const handle = await provider.open(guestPath, 'w');
  await handle.writeFile(content).finally(() => handle.close());
};

describe('the workspace the guest can write to', () => {
  test('ordinary workspace files are read and written on the real host file', async () => {
    const provider = await workspace();
    const handle = await provider.open(SRC_FILE, 'r');
    expect((await handle.readFile()).toString()).toBe('source');
    await handle.close();
    await writeThrough(provider, SRC_FILE, 'changed');
    expect(readHost(SRC_FILE)).toBe('changed');
  });

  test.for([PRE_COMMIT, POST_CHECKOUT, GIT_CONFIG])('writing %s is denied with EACCES and leaves the host unchanged', async (guestPath) => {
    const provider = await workspace();
    expect(await errnoOf(writeThrough(provider, guestPath, 'pwned'))).toBe(EACCES);
    expect(readHostIfPresent(guestPath)).toBe(ORIGINAL_CONTENT[guestPath]);
  });

  test.for([PRE_COMMIT, GIT_CONFIG])('unlinking %s is denied with EACCES', async (guestPath) => {
    expect(await errnoOf((await workspace()).unlink(guestPath))).toBe(EACCES);
    expect(fs.existsSync(hostFile(guestPath))).toBe(true);
  });

  test('protected files cannot be renamed, and nothing can be renamed onto a protected path', async () => {
    const provider = await workspace();
    expect(await errnoOf(provider.rename(PRE_COMMIT, POST_CHECKOUT))).toBe(EXDEV);
    expect(await errnoOf(provider.rename(GIT_CONFIG, CONFIG_COPY))).toBe(EXDEV);
    expect(await errnoOf(provider.rename(SRC_FILE, POST_CHECKOUT))).toBe(EXDEV);
    expect(readHost(PRE_COMMIT)).toBe('hook');
    expect(readHost(GIT_CONFIG)).toBe('config');
    expect(readHost(SRC_FILE)).toBe('source');
    expect(fs.existsSync(hostFile(POST_CHECKOUT))).toBe(false);
  });

  test('a symlink to the hooks directory does not bypass the protection', async () => {
    const provider = await workspace();
    await provider.symlink(GIT_HOOKS_DIR, HOOKS_LINK);
    expect(await errnoOf(writeThrough(provider, HOOKS_LINK_PRE_COMMIT, 'pwned'))).toBeDefined();
    expect(await errnoOf(provider.unlink(HOOKS_LINK_PRE_COMMIT))).toBeDefined();
    expect(readHost(PRE_COMMIT)).toBe('hook');
  });
});

describe('the network the guest can reach', () => {
  const allowed = async (hostname: string, ip = PUBLIC_IP) => {
    await host.fire('session_start');
    const hooks = host.vmOptions()?.httpHooks;
    return hooks?.isIpAllowed?.({ hostname, ip, family: ip.includes(':') ? IPV6_FAMILY : IPV4_FAMILY, port: HTTPS_PORT, protocol: 'https' });
  };

  test.for(['api.github.com', 'github.com', 'registry.npmjs.org', 'pypi.org', 'crates.io', 'proxy.golang.org', 'dl-cdn.alpinelinux.org'])('the development endpoint %s is allowed', async (hostname) => {
    expect(await allowed(hostname)).toBe(true);
  });

  test.for(['example.com', 'evil.invalid', 'httpbin.org', 'evilgithub.com'])('the arbitrary public host %s is blocked', async (hostname) => {
    expect(await allowed(hostname)).toBe(false);
  });

  test.for(['127.0.0.1', '169.254.169.254', '10.0.0.1', '::1'])('the internal address %s is blocked even for an allowed host', async (ip) => {
    expect(await allowed('github.com', ip)).toBe(false);
  });
});

describe('the VM the extension asks Gondolin for', () => {
  test('is labelled with the project folder and puts no injected secrets in the guest environment', async () => {
    await host.fire('session_start');
    const options = host.vmOptions();
    expect(options?.sessionLabel).toBe(`pi ${path.basename(dir)}`);
    expect(options?.env ?? {}).toEqual({});
  });

  test('lets the guest read this package but never write to it', async () => {
    await host.fire('session_start');
    const mounts = host.vmOptions()?.vfs?.mounts ?? {};
    const packageMount = mounts[PACKAGE_ROOT] as VirtualProvider;
    const manifest = await packageMount.open(PACKAGE_MANIFEST, 'r');
    expect((await manifest.readFile()).toString()).toContain('"name": "@justjoshn/pi-pstack-v2"');
    await manifest.close();
    expect(await errnoOf(packageMount.open(WRITE_PROBE, 'w'))).toBe(EROFS);
    expect(fs.existsSync(path.join(PACKAGE_ROOT, WRITE_PROBE))).toBe(false);
  });

  test('leaves only the workspace writable, whatever else is mounted', async () => {
    await host.fire('session_start');
    const mounts = Object.entries(host.vmOptions()?.vfs?.mounts ?? {}).filter(([mountPoint]) => mountPoint !== GUEST);
    for (const [, provider] of mounts) expect(await errnoOf((provider as VirtualProvider).open(WRITE_PROBE, 'w'))).toBe(EROFS);
  });
});
