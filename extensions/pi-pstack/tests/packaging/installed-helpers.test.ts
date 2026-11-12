import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, expect, onTestFinished, test } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const node = process.env['PSTACK_HELPER_NODE'] ?? process.execPath;
const npmBin = realpathSync(spawnSync('/bin/sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).stdout.trim());
const npm = npmBin.endsWith('.js') ? npmBin : join(dirname(node), '../lib/node_modules/npm/bin/npm-cli.js');
const peers = ['@earendil-works/pi-ai', '@earendil-works/pi-coding-agent', 'typebox'];
const artifacts = Object.keys((JSON.parse(readFileSync(join(root, 'dist/helpers.json'), 'utf8')) as { outputs: Record<string, string> }).outputs);
const receipts = process.env['PSTACK_HELPER_RECEIPTS'];
// Node alone on PATH: Homebrew and /usr/local install Bun beside Node, and the consumer must not see it.
const nodeBin = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-node-bin-')));
symlinkSync(node, join(nodeBin, 'node'));
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
    PATH: `${nodeBin}:/usr/bin:/bin`,
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
  rmSync(nodeBin, { recursive: true, force: true });
});

function sandbox() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-helper-home-')));
  const cwd = join(home, 'unrelated working directory');
  mkdirSync(cwd);
  writeFileSync(join(cwd, 'package.json'), '{"private":true,"type":"module"}\n');
  onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  return { home, cwd, env: environment(home) };
}

test('the consumer installs all production dependencies with exactly the host peers omitted', () => {
  for (const peer of peers) expect(existsSync(join(installation, 'node_modules', peer)), peer).toBe(false);
  const listing = run(node, [npm, 'ls', '--omit=dev', '--all', '--json'], installation, environment(installation));
  const tree = JSON.parse(listing.stdout) as { problems?: string[] };
  const missing = tree.problems ?? [];
  expect(missing.map((problem) => problem.match(/^missing: (.*)@\*, required by /)?.[1]).sort()).toEqual([...peers].sort());
  expect(listing.status).toBe(1);
  const bun = run('/bin/sh', ['-c', 'command -v bun'], installation, environment(installation));
  expect({ found: bun.stdout, failed: bun.status !== 0 }).toEqual({ found: '', failed: true });
});

function chart(packageRoot: string) {
  const { home, cwd, env } = sandbox();
  const replay = join(home, 'Login');
  cpSync(join(root, 'generated/skills/statechart/scripts/test/corpus/Login'), replay, { recursive: true });
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
  const result = run(join(packageRoot, 'generated/skills/statechart/scripts/statechart'), [join(replay, 'Login.tla'), '--view', view, '--out', out], cwd, { ...env, JAVA: java, TLA2TOOLS: 'fixture.jar', STATECHART_REPLAY: replay });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const drawing = readFileSync(join(out, 'chart.mmd'), 'utf8');
  expect(drawing).toContain('Installed custom view');
  expect(drawing).toContain(readFileSync(join(replay, 'chart.mmd'), 'utf8').trim());
  expect(readFileSync(join(out, 'report.md'), 'utf8')).toContain('Rules that hold');
  expect(result.stdout).toContain(`Wrote ${out}`);
}

test('the installed statechart entry and worker render a custom view', () => {
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
  cpSync(join(root, 'generated/skills/statechart/scripts/test/corpus/Login/Login.tla'), model);
  cpSync(join(root, 'generated/skills/statechart/scripts/test/corpus/Login/Login.cfg'), join(cwd, 'Login.cfg'));
  const view = join(cwd, 'real view.mjs');
  writeFileSync(view, 'export const title = "Installed real TLC";\nexport const state = (v) => v.main.split(".");\n');
  const output = join(cwd, 'checked output');
  const result = run(join(installed, 'generated/skills/statechart/scripts/statechart'), [model, '--view', view, '--out', output], cwd, { ...env, JAVA: java, TLA2TOOLS: jar });
  expect(result.status, result.stderr).toBe(0);
  const chart = readFileSync(join(output, 'chart.mmd'), 'utf8');
  const report = readFileSync(join(output, 'report.md'), 'utf8');
  receipt({ check: 'installed-real-tlc', model: readFileSync(model, 'utf8'), config: readFileSync(join(cwd, 'Login.cfg'), 'utf8'), view: readFileSync(view, 'utf8'), chart, report });
  expect(chart).toContain('Installed real TLC');
  expect(chart).toContain('Locked out');
  expect(report).toContain('Rules that hold');
});

test('source installs contain the same ready-to-run helpers without consumer build scripts', () => {
  const { home } = sandbox();
  const source = join(home, 'source package');
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { files: string[]; scripts: Record<string, string>; pi: { extensions: string[] } };
  for (const artifact of artifacts) {
    expect(readFileSync(join(root, artifact))).toEqual(readFileSync(join(installed, artifact)));
  }
  for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare']) expect(manifest.scripts[lifecycle]).toBeUndefined();
  expect(manifest.pi.extensions).toEqual(['./src/extension.ts']);
  mkdirSync(source);
  cpSync(join(root, 'package.json'), join(source, 'package.json'));
  for (const entry of manifest.files.filter((path) => !path.startsWith('!'))) cpSync(join(root, entry), join(source, entry), { recursive: true, filter: (path) => basename(path) !== 'node_modules' });
  expect(existsSync(join(source, 'node_modules'))).toBe(false);
  chart(source);
});
