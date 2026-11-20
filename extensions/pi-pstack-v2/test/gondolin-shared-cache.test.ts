import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { CONFIG_DIR_NAME } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { GUEST, loadGondolin } from './core-gondolin-host.ts';

vi.mock('@earendil-works/gondolin', async (importOriginal) => ({ ...(await importOriginal<typeof import('@earendil-works/gondolin')>()), VM: { create: vi.fn() } }));

const FLAG = 'gondolin-shared-build-cache';
const ENV = 'PI_GONDOLIN_SHARED_BUILD_CACHE';
const CONFIG_FILE = 'gondolin.json';
const GUEST_CACHE = '/cache';
const PROBE_FILE = '/npm/probe.txt';
const PRIVATE_MODE = 0o700;
const OPEN_MODE = 0o755;
const GROUP_OTHER_BITS = 0o077;
/** Every cache variable and where, under the cache root, it must point. */
const CACHE_ENV: Readonly<Record<string, string>> = {
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

let root = '';
let agentDir = '';
let localCwd = '';

const hostCacheDir = () => path.join(root, `pi-gondolin-build-cache-${process.getuid?.() ?? 0}`);
const expectedEnv = (cacheRoot: string) => Object.fromEntries(Object.entries(CACHE_ENV).map(([name, subdir]) => [name, path.join(cacheRoot, subdir)]));

const writeConfig = (dir: string, contents: unknown): void => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, CONFIG_FILE), typeof contents === 'string' ? contents : JSON.stringify(contents));
};
const writeProject = (contents: unknown) => writeConfig(path.join(localCwd, CONFIG_DIR_NAME), contents);
const writeUser = (contents: unknown) => writeConfig(agentDir, contents);

/** Starts a session and returns the VM options the extension gave Gondolin. */
const startSession = async (flags: Record<string, boolean> = {}) => {
  const host = loadGondolin({ cwd: localCwd, flags });
  await host.fire('session_start');
  const options = host.vmOptions();
  return { host, mount: options?.vfs?.mounts?.[GUEST_CACHE], env: options?.env ?? {} };
};
const cacheOn = async (flags: Record<string, boolean> = {}): Promise<boolean> => (await startSession(flags)).mount !== undefined;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gondolin-cache-')));
  agentDir = path.join(root, 'agent');
  localCwd = path.join(root, 'project');
  fs.mkdirSync(agentDir);
  fs.mkdirSync(localCwd);
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
  vi.stubEnv('TMPDIR', root);
  vi.stubEnv(ENV, '');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('the VM without the shared build cache', () => {
  test('mounts nothing at /cache, sets no environment, and creates no host directory', async () => {
    const { mount, env } = await startSession();
    expect(mount).toBeUndefined();
    expect(env).toEqual({});
    expect(fs.existsSync(hostCacheDir())).toBe(false);
  });

  test('an unset flag does not override the config files', async () => {
    writeUser({ enableSharedBuildCache: true });
    expect(await cacheOn({ [FLAG]: false })).toBe(true);
  });
});

describe('what turns the shared build cache on', () => {
  const none = (): void => undefined;
  test.for([
    { label: 'flag', setUp: none, flags: { [FLAG]: true } },
    {
      label: 'env',
      setUp: () => {
        vi.stubEnv(ENV, '1');
      },
      flags: {},
    },
    { label: 'project', setUp: () => writeProject({ enableSharedBuildCache: true }), flags: {} },
    { label: 'user', setUp: () => writeUser({ enableSharedBuildCache: true }), flags: {} },
  ])('the $label mounts the host cache writable at /cache and points the tools into it', async ({ setUp, flags }) => {
    setUp();
    const { mount, env } = await startSession(flags);
    if (!mount) throw new Error(`The extension mounted nothing at ${GUEST_CACHE}.`);
    expect(env).toMatchObject(expectedEnv(GUEST_CACHE));
    const handle = await mount.open(PROBE_FILE, 'w');
    await handle.writeFile('cached');
    await handle.close();
    expect(fs.readFileSync(path.join(hostCacheDir(), PROBE_FILE), 'utf8')).toBe('cached');
  });

  test('the flag wins over a variable and config that turn it off', async () => {
    vi.stubEnv(ENV, '0');
    writeProject({ enableSharedBuildCache: false });
    expect(await cacheOn({ [FLAG]: true })).toBe(true);
  });

  test.for([
    ['1', true],
    ['true', true],
    ['0', false],
    ['false', false],
  ] as const)('the variable value %s gives %s over config files', async ([value, expected]) => {
    vi.stubEnv(ENV, value);
    writeProject({ enableSharedBuildCache: !expected });
    expect(await cacheOn()).toBe(expected);
  });
});

describe('a variable naming an object prototype property', () => {
  test.for(['constructor', '__proto__', 'toString'])('the value %s does not turn the shared build cache on', async (value) => {
    vi.stubEnv(ENV, value);
    expect(await cacheOn()).toBe(false);
  });
});

describe('the config files', () => {
  test('the project config wins over the user config', async () => {
    writeUser({ enableSharedBuildCache: true });
    writeProject({ enableSharedBuildCache: false });
    expect(await cacheOn()).toBe(false);
  });

  test('a project config that leaves the setting out falls through to the user config', async () => {
    writeProject({});
    writeUser({ enableSharedBuildCache: true });
    expect(await cacheOn()).toBe(true);
  });

  test.for(['{not json', '{"enableSharedBuildCache": "yes"}'])('a malformed config %s stops the VM from starting, naming the file', async (contents) => {
    writeUser(contents);
    const host = loadGondolin({ cwd: localCwd });
    await expect(host.fire('session_start')).rejects.toThrow(path.join(agentDir, CONFIG_FILE));
  });
});

describe('the host cache directory', () => {
  test('is private to the user and holds a directory for each cache', async () => {
    await startSession({ [FLAG]: true });
    expect(fs.statSync(hostCacheDir()).mode & GROUP_OTHER_BITS).toBe(0);
    for (const subdir of Object.values(CACHE_ENV)) expect(fs.statSync(path.join(hostCacheDir(), subdir)).isDirectory()).toBe(true);
  });

  test('is reused by the next session', async () => {
    await startSession({ [FLAG]: true });
    fs.writeFileSync(path.join(hostCacheDir(), 'npm', 'kept'), 'kept');
    await startSession({ [FLAG]: true });
    expect(fs.readFileSync(path.join(hostCacheDir(), 'npm', 'kept'), 'utf8')).toBe('kept');
  });

  test('is refused when others can enter it', async () => {
    fs.mkdirSync(hostCacheDir(), { mode: PRIVATE_MODE });
    fs.chmodSync(hostCacheDir(), OPEN_MODE);
    const host = loadGondolin({ cwd: localCwd, flags: { [FLAG]: true } });
    await expect(host.fire('session_start')).rejects.toThrow('mode 700');
  });
  test('still reads workspace files beside the shared cache', async () => {
    const workspaceFile = '/hello.txt';
    fs.writeFileSync(path.join(localCwd, workspaceFile), 'from-workspace');
    const { host } = await startSession({ [FLAG]: true });
    const workspaceMount = host.vmOptions()?.vfs?.mounts?.[GUEST];
    if (!workspaceMount) throw new Error(`The extension mounted nothing at ${GUEST}.`);
    const handle = await workspaceMount.open(workspaceFile, 'r');
    try {
      expect((await handle.readFile()).toString()).toBe('from-workspace');
    } finally {
      await handle.close();
    }
  });
});

describe('the gondolin status command', () => {
  const statusOf = async (flags: Record<string, boolean>): Promise<string> => {
    const { host } = await startSession(flags);
    await host.commands()['gondolin']?.handler('', host.ctx);
    return String(host.notify.mock.lastCall?.[0]);
  };

  test('with the shared build cache off, the status does not name it', async () => {
    expect(await statusOf({})).not.toContain('Shared build cache');
  });

  test('with the shared build cache on, the status names the host directory and mount', async () => {
    expect(await statusOf({ [FLAG]: true })).toContain(`Shared build cache: ${hostCacheDir()} -> ${GUEST_CACHE}`);
  });
});
