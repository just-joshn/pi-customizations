import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createWorld, loadPstack, startJob, untilExited, type World } from './core-host.ts';

const JOB_TIMEOUT_MS = 30_000;
const ENV = 'PI_GONDOLIN_SHARED_BUILD_CACHE';
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
const PRINT_ENV = Object.keys(CACHE_ENV)
  .map((name) => `printf '%s=%s\\n' ${name} "$${name}"`)
  .join('; ');

let world: World;

beforeEach(() => {
  world = createWorld();
  vi.stubEnv('TMPDIR', world.root);
  vi.stubEnv(ENV, '');
  for (const name of Object.keys(CACHE_ENV)) vi.stubEnv(name, '');
});

afterEach(() => world.dispose());

const hostCacheDir = () => join(world.root, `pi-gondolin-build-cache-${process.getuid?.() ?? 0}`);

const runPrintingEnv = async (): Promise<string> => {
  const host = loadPstack(world);
  const id = await startJob(host, { name: 'cache-env', command: PRINT_ENV });
  await untilExited(host, id);
  return readFileSync(join(world.jobsRoot, id, 'output.log'), 'utf8');
};

describe('tmux_run with the shared build cache', { timeout: JOB_TIMEOUT_MS }, () => {
  test('leaves the caches alone by default', async () => {
    const output = await runPrintingEnv();
    for (const name of Object.keys(CACHE_ENV)) expect(output).toContain(`${name}=\n`);
    expect(existsSync(hostCacheDir())).toBe(false);
  });

  test('exports every cache variable under the host cache directory when it is on', async () => {
    vi.stubEnv(ENV, '1');
    const output = await runPrintingEnv();
    for (const [name, subdir] of Object.entries(CACHE_ENV)) expect(output).toContain(`${name}=${join(hostCacheDir(), subdir)}\n`);
    expect(existsSync(join(hostCacheDir(), 'npm'))).toBe(true);
  });
});
