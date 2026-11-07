import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, expect, onTestFinished, test } from 'vitest';
import type { DurableRegistry } from '../src/subscriptions/durable-types.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const node = process.env['PSTACK_HELPER_NODE'] ?? process.execPath;
const npmBin = realpathSync(spawnSync('/bin/sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).stdout.trim());
const npm = npmBin.endsWith('.js') ? npmBin : join(dirname(node), '../lib/node_modules/npm/bin/npm-cli.js');
const peers = ['@earendil-works/pi-ai', '@earendil-works/pi-agent-core', '@earendil-works/pi-coding-agent', '@earendil-works/pi-tui', 'typebox'];
const artifacts = ['dist/supervisor-main.js', 'skills/statechart/scripts/statechart.js', 'skills/statechart/scripts/worker.js'];
const receipts = process.env['PSTACK_HELPER_RECEIPTS'];
let installation: string;
let installed: string;

function receipt(value: unknown): void {
  if (receipts === undefined) return;
  mkdirSync(receipts, { recursive: true });
  appendFileSync(join(receipts, 'commands.jsonl'), `${JSON.stringify(value)}\n`);
}

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
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 60_000 });
  receipt({ command, args, cwd, env, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr });
  return result;
}

beforeAll(() => {
  installation = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-installed-helpers-')));
  const env = environment(installation);
  writeFileSync(join(installation, 'package.json'), '{"private":true,"type":"module"}\n');
  const pack = run(node, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', installation], root, env);
  expect(pack.status, pack.stderr).toBe(0);
  const filename = (JSON.parse(pack.stdout) as { filename: string }[])[0]?.filename;
  if (filename === undefined) throw new Error('npm pack returned no tarball.');
  const tarball = join(installation, filename);
  receipt({ artifact: filename, sha256: createHash('sha256').update(readFileSync(tarball)).digest('hex') });
  const install = run(node, [npm, 'install', '--omit=dev', '--omit=peer', '--ignore-scripts', '--no-audit', '--no-fund', tarball], installation, env);
  expect(install.status, install.stderr).toBe(0);
  installed = join(installation, 'node_modules/@justjoshn/pi-pstack');
}, 120_000);

afterAll(() => {
  if (installation !== undefined) rmSync(installation, { recursive: true, force: true });
});

function sandbox() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-helper-home-')));
  const cwd = join(home, 'unrelated working directory');
  mkdirSync(cwd);
  writeFileSync(join(cwd, 'package.json'), '{"private":true,"type":"module"}\n');
  onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  return { home, cwd, env: environment(home) };
}

function registryDir(cwd: string, stateHome: string): string {
  const slug = `--${resolve(cwd)
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`;
  return join(stateHome, 'pstack/durable', slug);
}

async function supervisor(command: string, prefix: string[], cwd: string, env: NodeJS.ProcessEnv, stateHome: string, signal: AbortSignal, whileRunning?: () => Promise<void>, launchCwd = cwd) {
  const child = spawn(command, [...prefix, '--workspace', cwd], { cwd: launchCwd, env, signal, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (data: Buffer) => {
    stdout += data.toString();
  });
  child.stderr.on('data', (data: Buffer) => {
    stderr += data.toString();
  });
  const closed = new Promise<void>((done) => {
    child.on('error', (error) => {
      stderr += error.message;
    });
    child.on('close', () => {
      receipt({ command, args: [...prefix, '--workspace', cwd], cwd: launchCwd, env, stdout, stderr, status: child.exitCode, signal: child.signalCode });
      done();
    });
  });
  onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await closed;
  });
  await expect.poll(() => stdout.includes('started for') || child.exitCode !== null || child.signalCode !== null || stderr !== '', { timeout: 10_000 }).toBe(true);
  expect(stderr).toBe('');
  expect(stdout).toContain(`started for ${cwd} (pid ${child.pid}).`);
  const lockFile = join(registryDir(cwd, stateHome), 'runtime/supervisor.lock');
  const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as { pid: number; epoch: string };
  expect(lock).toMatchObject({ pid: child.pid, epoch: expect.any(String) });
  expect(lock.epoch).not.toBe('');
  const duplicate = run(command, [...prefix, '--workspace', cwd], launchCwd, env);
  expect(duplicate.status, duplicate.stderr).toBe(0);
  expect(duplicate.stdout).toContain(`already running for ${cwd} (pid ${child.pid}).`);
  expect(JSON.parse(readFileSync(lockFile, 'utf8'))).toEqual(lock);
  await whileRunning?.();
  child.kill('SIGTERM');
  await closed;
  expect(child.exitCode).toBe(0);
  expect(existsSync(lockFile)).toBe(false);
}

test('the consumer installs all production dependencies with exactly the five host peers omitted', () => {
  for (const peer of peers) expect(existsSync(join(installation, 'node_modules', peer)), peer).toBe(false);
  const listing = run(node, [npm, 'ls', '--omit=dev', '--all', '--json'], installation, environment(installation));
  const tree = JSON.parse(listing.stdout) as { problems?: string[] };
  const missing = tree.problems ?? [];
  expect(missing.map((problem) => problem.match(/^missing: (.*)@\*, required by /)?.[1]).sort()).toEqual([...peers].sort());
  expect(listing.status).toBe(1);
  expect(run('/bin/sh', ['-c', 'command -v bun'], installation, environment(installation)).status).toBe(1);
});

test('the packed supervisor starts directly, keeps its lock, and cleans up after SIGTERM', async ({ signal }) => {
  const { home, cwd, env } = sandbox();
  await supervisor(join(installed, 'bin/pstack-routines-supervisor'), [], cwd, env, join(home, '.pi/agent'), signal);
});

test('the real npm bin resolves its package from an unrelated spaced working directory', async ({ signal }) => {
  const { home, cwd, env } = sandbox();
  await supervisor(join(installation, 'node_modules/.bin/pstack-routines-supervisor'), [], cwd, env, join(home, '.pi/agent'), signal);
});

test('the Node supervisor entry honors a file URL agent directory', async ({ signal }) => {
  const { home, cwd, env } = sandbox();
  const state = join(home, 'custom agent directory');
  await supervisor(node, [join(installed, 'bin/pstack-routines-supervisor.mjs')], cwd, { ...env, PI_CODING_AGENT_DIR: new URL(`file://${state}`).href }, state, signal);
});

test('the installed supervisor launches a local fire with its relocated package root', async ({ signal }) => {
  const { home, cwd, env } = sandbox();
  const state = join(home, '.pi/agent');
  const registryFile = join(registryDir(cwd, state), 'subscriptions.json');
  const registry: DurableRegistry = {
    version: 2,
    workspaceCwd: cwd,
    revision: 1,
    subscriptions: [
      {
        id: 'sub-fixture',
        name: 'local fixture',
        ownerSessionId: 'fixture-owner',
        createdAt: 0,
        expiresAt: 0,
        revision: 1,
        lifecycle: 'completed',
        config: { kind: 'timer', prompt: 'fixture prompt', delaySeconds: 1, once: true, strategy: 'new_session' },
      },
    ],
    pending: [{ id: 'fixture-fire', subscriptionId: 'sub-fixture', acceptedAt: 0, content: 'fixture prompt' }],
  };
  mkdirSync(dirname(registryFile), { recursive: true });
  writeFileSync(registryFile, JSON.stringify(registry));
  const received = join(home, 'pi-args.json');
  const fakePi = join(home, 'pi-fixture.mjs');
  writeFileSync(
    fakePi,
    `import fs from 'node:fs';\nfs.writeFileSync(process.env.FIXTURE_ARGS, JSON.stringify(process.argv.slice(2)));\nconsole.log(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'fixture complete' }] } }));\n`,
  );
  await supervisor(join(installation, 'node_modules/.bin/pstack-routines-supervisor'), [], cwd, { ...env, PI_PSTACK_PI_COMMAND: JSON.stringify([node, fakePi]), FIXTURE_ARGS: received }, state, signal, async () => {
    await expect.poll(() => existsSync(received), { timeout: 5_000 }).toBe(true);
    expect(JSON.parse(readFileSync(received, 'utf8'))).toEqual(['--mode', 'json', '-e', installed, '-p', '--', 'fixture prompt']);
    await expect.poll(() => (JSON.parse(readFileSync(registryFile, 'utf8')) as DurableRegistry).subscriptions[0]?.lastOutcome?.text).toBe('fixture complete');
  });
});

test.for(['relative-cross-cwd', 'relative-same-cwd', 'absolute-cross-cwd', 'file-url-cross-cwd'])('an installed local fire retains its originating agent directory for %s', async (form, { signal }) => {
  const { home, env } = sandbox();
  const origin = join(home, 'A launcher cwd');
  const cwd = form === 'relative-same-cwd' ? origin : join(home, 'B fire cwd');
  mkdirSync(origin);
  mkdirSync(cwd, { recursive: true });
  const state = form.startsWith('relative') ? join(origin, 'relative agent') : join(home, 'absolute agent');
  const override = form.startsWith('relative') ? 'relative agent' : form.startsWith('file-url') ? pathToFileURL(state).href : state;
  const registryFile = join(registryDir(cwd, state), 'subscriptions.json');
  const registry: DurableRegistry = {
    version: 2,
    workspaceCwd: cwd,
    revision: 1,
    subscriptions: [
      {
        id: 'sub-boundary',
        name: 'boundary fixture',
        ownerSessionId: 'fixture-owner',
        createdAt: 0,
        expiresAt: 0,
        revision: 1,
        lifecycle: 'completed',
        config: { kind: 'timer', prompt: 'boundary prompt', delaySeconds: 1, once: true, strategy: 'new_session' },
      },
    ],
    pending: [{ id: 'boundary-fire', subscriptionId: 'sub-boundary', acceptedAt: 0, content: 'boundary prompt' }],
  };
  mkdirSync(dirname(registryFile), { recursive: true });
  writeFileSync(registryFile, JSON.stringify(registry));
  const received = join(home, 'received.json');
  const fakePi = join(home, 'boundary-pi.mjs');
  writeFileSync(
    fakePi,
    `import fs from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const raw = process.env.PI_CODING_AGENT_DIR;
fs.writeFileSync(process.env.FIXTURE_RECEIVED, JSON.stringify({ pid: process.pid, cwd: process.cwd(), effectiveAgent: resolve(raw.startsWith('file:') ? fileURLToPath(raw) : raw), sentinel: process.env.FIXTURE_SENTINEL }));
console.log(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'boundary complete' }] } }));
`,
  );
  await supervisor(
    join(installation, 'node_modules/.bin/pstack-routines-supervisor'),
    [],
    cwd,
    { ...env, PI_CODING_AGENT_DIR: override, PI_PSTACK_PI_COMMAND: JSON.stringify([node, fakePi]), FIXTURE_RECEIVED: received, FIXTURE_SENTINEL: 'retained' },
    state,
    signal,
    async () => {
      await expect.poll(() => existsSync(received)).toBe(true);
      const child = JSON.parse(readFileSync(received, 'utf8')) as { pid: number; cwd: string; effectiveAgent: string; sentinel: string };
      receipt({ check: 'installed-agent-directory-boundary', form, origin, expectedAgent: state, child });
      expect(child).toMatchObject({ cwd, effectiveAgent: state, sentinel: 'retained' });
      await expect.poll(() => (JSON.parse(readFileSync(registryFile, 'utf8')) as DurableRegistry).subscriptions[0]?.lastOutcome?.text).toBe('boundary complete');
      await expect
        .poll(() => {
          try {
            process.kill(child.pid, 0);
            return false;
          } catch {
            return true;
          }
        })
        .toBe(true);
    },
    origin,
  );
});

function chart(packageRoot: string) {
  const { home, cwd, env } = sandbox();
  const replay = join(home, 'Login');
  cpSync(join(root, 'skills/statechart/scripts/test/corpus/Login'), replay, { recursive: true });
  const java = join(home, 'java.mjs');
  writeFileSync(
    java,
    `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const config = args.includes('-config') ? args[args.indexOf('-config') + 1] : undefined;
const name = config ? path.basename(config, '.cfg') : 'sany';
const replay = process.env.STATECHART_REPLAY;
if (args.includes('-dump')) fs.copyFileSync(path.join(replay, 'graph.dot'), args[args.indexOf('-dump') + 2] + '.dot');
const tag = fs.existsSync('ChartRun.tla') ? fs.readFileSync('ChartRun.tla', 'utf8').match(/"chart-[0-9a-f]{32}"/)?.[0] : undefined;
const saved = fs.readFileSync(path.join(replay, name + '.out'), 'utf8');
process.stdout.write(tag ? saved.replace(/(<<\\s*)"chart"(?=,)/g, '$1' + tag) : saved);
const exit = path.join(replay, name + '.exit');
process.exit(fs.existsSync(exit) ? Number(fs.readFileSync(exit, 'utf8')) : 0);
`,
    { mode: 0o755 },
  );
  const view = join(cwd, 'custom view.mjs');
  writeFileSync(view, 'export const title = "Installed custom view";\nexport const state = (v) => v.main.split(".");\n');
  const out = join(cwd, 'output');
  const result = run(join(packageRoot, 'skills/statechart/scripts/statechart'), [join(replay, 'Login.tla'), '--view', view, '--out', out], cwd, { ...env, JAVA: java, TLA2TOOLS: 'fixture.jar', STATECHART_REPLAY: replay });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const drawing = readFileSync(join(out, 'chart.mmd'), 'utf8');
  expect(drawing).toContain('Installed custom view');
  expect(drawing).toContain(readFileSync(join(replay, 'chart.mmd'), 'utf8').trim());
  expect(readFileSync(join(out, 'report.md'), 'utf8')).toContain('Rules that hold');
  expect(result.stdout).toContain(`Wrote ${out}`);
}

test('the installed statechart entry and worker render a custom view without TypeScript support', () => {
  chart(installed);
});

test.skipIf(process.env['TLA2TOOLS'] === undefined)('the installed statechart checks a model with real TLC', () => {
  const { cwd, env } = sandbox();
  const jar = process.env['TLA2TOOLS'] ?? '';
  expect(createHash('sha256').update(readFileSync(jar)).digest('hex')).toBe('936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88');
  const java = process.env['JAVA'] ?? (process.env['JAVA_HOME'] === undefined ? 'java' : join(process.env['JAVA_HOME'], 'bin/java'));
  const version = run(java, ['-version'], cwd, env);
  expect(version.status, version.stderr).toBe(0);
  const model = join(cwd, 'Login.tla');
  cpSync(join(root, 'skills/statechart/scripts/test/corpus/Login/Login.tla'), model);
  cpSync(join(root, 'skills/statechart/scripts/test/corpus/Login/Login.cfg'), join(cwd, 'Login.cfg'));
  const view = join(cwd, 'real view.mjs');
  writeFileSync(view, 'export const title = "Installed real TLC";\nexport const state = (v) => v.main.split(".");\n');
  const output = join(cwd, 'checked output');
  const result = run(join(installed, 'skills/statechart/scripts/statechart'), [model, '--view', view, '--out', output], cwd, { ...env, JAVA: java, TLA2TOOLS: jar });
  expect(result.status, result.stderr).toBe(0);
  const chart = readFileSync(join(output, 'chart.mmd'), 'utf8');
  const report = readFileSync(join(output, 'report.md'), 'utf8');
  receipt({ check: 'installed-real-tlc', model: readFileSync(model, 'utf8'), config: readFileSync(join(cwd, 'Login.cfg'), 'utf8'), view: readFileSync(view, 'utf8'), chart, report });
  expect(chart).toContain('Installed real TLC');
  expect(chart).toContain('Locked out');
  expect(report).toContain('Rules that hold');
});

test('source installs contain the same ready-to-run helpers without consumer build scripts', async ({ signal }) => {
  const { home, cwd, env } = sandbox();
  const source = join(home, 'source package');
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { files: string[]; scripts: Record<string, string>; pi: { extensions: string[] } };
  for (const artifact of artifacts) {
    expect(readFileSync(join(root, artifact))).toEqual(readFileSync(join(installed, artifact)));
  }
  for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare']) expect(manifest.scripts[lifecycle]).toBeUndefined();
  expect(manifest.pi.extensions).toEqual(['./src/index.ts']);
  mkdirSync(source);
  cpSync(join(root, 'package.json'), join(source, 'package.json'));
  for (const entry of manifest.files) cpSync(join(root, entry), join(source, entry), { recursive: true, filter: (path) => basename(path) !== 'node_modules' });
  expect(existsSync(join(source, 'node_modules'))).toBe(false);
  await supervisor(join(source, 'bin/pstack-routines-supervisor'), [], cwd, env, join(home, '.pi/agent'), signal);
  chart(source);
});
