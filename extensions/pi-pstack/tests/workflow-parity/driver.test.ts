// The driver reports a pi that cannot run as that, with pi's stderr, and never as the ENOENT of a file it then reads.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { writeContainerScenario as writeFakeForgeScenario } from './fixtures/forge.ts';
import { writeContainerScenario as writeRealForgeScenario } from './fixtures/real-forge.ts';
import type { RunSpec } from './lib/driver.ts';
import { runWorkflow, withoutForgeCredentials } from './lib/driver.ts';

const FAKE_PI = join(import.meta.dirname, 'fixtures/fake-pi.mjs');
const spec: RunSpec = { family: 'driver-test', runId: 'driver-test', history: [{ message: 'init', files: { 'README.md': 'x\n' } }], prompt: () => '/noop', scenario: () => ({ actors: {} }) };
const withPi = (mode: string) => {
  process.env['FAKE_PI_MODE'] = mode;
  return runWorkflow(spec, 'scripted', { pi: FAKE_PI, rpcTimeoutMs: 1_500 });
};

test.for(['scripted', 'real'] as const)('%s sandboxes expose scripted scenarios only to the scripted driver', async (driver) => {
  const seen: { container: boolean; parent: boolean }[] = [];
  process.env['FAKE_PI_MODE'] = 'crash';
  for (const writeScenario of [writeFakeForgeScenario, writeRealForgeScenario]) {
    await expect(
      runWorkflow(
        {
          ...spec,
          prepare: (ctx) => writeScenario(ctx, { actors: { parent: ['scripted secret'] } }),
          env: (ctx) => {
            seen.push({ container: existsSync(join(ctx.sandbox, 'sim-scenario/scenario.json')), parent: existsSync(join(ctx.sandbox, 'scenario.json')) });
            return {};
          },
        },
        driver,
        { pi: FAKE_PI, model: 'sim/claude-sim', rpcTimeoutMs: 1_500 },
      ),
    ).rejects.toThrow(/pi exited/);
  }
  expect(seen).toEqual(Array.from({ length: 2 }, () => ({ container: driver === 'scripted', parent: driver === 'scripted' })));
});

test('a pi that crashes at start is reported with its exit and stderr', async () => {
  await expect(withPi('crash')).rejects.toThrow(/pi exited \(code 3[^)]*\) before.*fatal: provider auth missing/s);
});

test('a pi that never answers is reported as unanswered with the request that hung', async () => {
  await expect(withPi('silent')).rejects.toThrow(/get_state: no answer within 1500 ms/);
});

test('a pi that runs but writes no session is reported as that, not as a missing file', async () => {
  await expect(withPi('no-session')).rejects.toThrow(/left no session file/);
});

test('a sandbox removed under the run is reported as removed', async () => {
  await expect(withPi('sandbox-removed')).rejects.toThrow(/is gone or gutted .*something outside this run removed it/);
});

test('a failed run leaves no sandbox behind', async () => {
  let sandbox = '';
  process.env['FAKE_PI_MODE'] = 'crash';
  await expect(runWorkflow({ ...spec, prepare: (ctx) => void (sandbox = ctx.sandbox) }, 'scripted', { pi: FAKE_PI, rpcTimeoutMs: 1_500 })).rejects.toThrow();
  expect(sandbox).not.toBe('');
  expect(existsSync(sandbox)).toBe(false);
});

test('a fake-forge run inherits no live forge credential: tokens and the ssh agent are dropped, git cannot prompt or use the system credential helper', () => {
  const env = withoutForgeCredentials({ PATH: '/bin', GH_TOKEN: 'live', GITHUB_TOKEN: 'live', GH_ENTERPRISE_TOKEN: 'live', GITHUB_ENTERPRISE_TOKEN: 'live', SSH_AUTH_SOCK: '/agent.sock', GIT_ASKPASS: '/askpass', SSH_ASKPASS: '/askpass' });
  expect(env).toEqual({ PATH: '/bin', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' });
});

const LEAKY_ENV: Record<string, string> = {
  GH_CONFIG_DIR: '/operator/gh',
  GIT_CONFIG_GLOBAL: '/operator/gitconfig',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'credential.helper',
  GIT_CONFIG_VALUE_0: 'osxkeychain',
  GIT_CONFIG_PARAMETERS: "'credential.helper=osxkeychain'",
  GIT_SSH_COMMAND: 'ssh -i /operator/key',
  GIT_SSH: '/operator/ssh',
  XDG_CONFIG_HOME: '/operator/xdg',
  GH_TOKEN: 'live',
  SSH_AUTH_SOCK: '/agent.sock',
};

// The Pi process the driver spawns is what a fake forge must not reach the operator's forge through; this is credential hygiene, not OS or network isolation.
async function spawnedEnv(extra?: RunSpec['env']): Promise<Record<string, string>> {
  const out = mkdtempSync(join(tmpdir(), 'driver-env-'));
  const saved = new Map(Object.keys(LEAKY_ENV).map((name) => [name, process.env[name]]));
  Object.assign(process.env, LEAKY_ENV, { FAKE_PI_MODE: 'dump-env', FAKE_PI_ENV_OUT: join(out, 'env.json') });
  try {
    await expect(runWorkflow(extra === undefined ? spec : { ...spec, env: extra }, 'scripted', { pi: FAKE_PI, rpcTimeoutMs: 1_500 })).rejects.toThrow();
    return JSON.parse(readFileSync(join(out, 'env.json'), 'utf8'));
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(out, { recursive: true, force: true });
  }
}

test('the spawned Pi process carries none of the operator git, gh, or ssh configuration', async () => {
  const env = await spawnedEnv();
  for (const name of Object.keys(LEAKY_ENV)) expect(env, name).not.toHaveProperty(name);
  expect(env['GIT_TERMINAL_PROMPT']).toBe('0');
  expect(env['GIT_CONFIG_NOSYSTEM']).toBe('1');
});

test('a real-forge family still puts its token back through spec.env', async () => {
  const env = await spawnedEnv(() => ({ GH_TOKEN: 'family-token' }));
  expect(env['GH_TOKEN']).toBe('family-token');
  expect(env).not.toHaveProperty('GIT_CONFIG_GLOBAL');
});
