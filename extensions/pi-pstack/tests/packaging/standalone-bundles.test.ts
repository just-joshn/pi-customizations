import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, expect, test } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const node = process.env['PSTACK_HELPER_NODE'] ?? process.execPath;
const npmBin = realpathSync(spawnSync('/bin/sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).stdout.trim());
const npm = npmBin.endsWith('.js') ? npmBin : join(dirname(node), '../lib/node_modules/npm/bin/npm-cli.js');

let installation: string;
let installed: string;

function environment(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    TMPDIR: home,
    PATH: `${dirname(node)}:/usr/bin:/bin`,
    PI_OFFLINE: '1',
    PI_SKIP_VERSION_CHECK: '1',
    npm_config_userconfig: '/dev/null',
    npm_config_globalconfig: join(home, 'global.npmrc'),
    npm_config_cache: join(home, 'npm-cache'),
    npm_config_registry: 'https://registry.npmjs.org',
    npm_config_update_notifier: 'false',
  };
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 60_000 });
}

beforeAll(() => {
  installation = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-standalone-')));
  installed = join(installation, 'node_modules', '@justjoshn', 'pi-pstack');
  const list = run(node, [npm, 'pack', '--dry-run', '--json', '--ignore-scripts'], root, environment(installation));
  expect(list.status, list.stderr).toBe(0);
  const packed = JSON.parse(list.stdout.slice(list.stdout.indexOf('[\n'))) as { files: { path: string }[] }[];
  for (const entry of packed.flatMap((archive) => archive.files)) {
    const source = join(root, entry.path);
    const target = join(installed, entry.path);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
  }
}, 120_000);

afterAll(() => {
  rmSync(installation, { recursive: true, force: true });
});

function sandbox() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-standalone-home-')));
  const cwd = join(home, 'working directory');
  mkdirSync(cwd);
  return { home, cwd, env: environment(home) };
}

test('the shipped package has no host packages to resolve up the tree', () => {
  expect(existsSync(join(installation, 'node_modules', '@earendil-works'))).toBe(false);
});

test('the standalone routine-setup bundle starts without the host packages installed', () => {
  const { cwd, env } = sandbox();
  const result = run(node, [join(installed, 'dist/routine-setup.js')], cwd, env);
  expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('usage: routine-setup.mjs');
});

test('a real routine setup writes the config and credential key file', () => {
  const { home, cwd, env } = sandbox();
  const project = join(home, 'project');
  mkdirSync(project);
  const prompt = join(home, 'prompt.txt');
  writeFileSync(prompt, 'a harmless routine prompt\n');
  const result = run(
    node,
    [join(installed, 'dist/routine-setup.js'), '--project', project, '--name', 'standalone', '--prompt-file', prompt],
    cwd,
    env,
  );
  expect(result.status, result.stderr).toBe(0);
  const config = JSON.parse(readFileSync(join(project, '.pi/pstack/automation/standalone/config.json'), 'utf8')) as Record<string, unknown>;
  expect(config).toMatchObject({ kind: 'routine', name: 'standalone', projectRoot: realpathSync(project) });
  const keyFile = join(home, '.pi/agent/pstack/credentials/standalone.json');
  const key = JSON.parse(readFileSync(keyFile, 'utf8')) as { key: string };
  expect(key.key).toMatch(/^[0-9a-f]{64}$/);
  expect(statSync(keyFile).mode & 0o777).toBe(0o600);
});

test('the standalone automation-serve bundle starts without the host packages installed', () => {
  const { cwd, env } = sandbox();
  const result = run(node, [join(installed, 'dist/automation-serve.js')], cwd, env);
  expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('usage: automation-serve.mjs');
});
