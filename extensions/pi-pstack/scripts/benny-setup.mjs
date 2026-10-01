import { execFile } from 'node:child_process';
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { mergePackageEntry } from './benny-settings.mjs';

const run = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const settingsPath = '.pi/settings.json';
export const bennyDependencies = [
  'how',
  'why',
  'tdd',
  'unslop',
  'principle-separate-before-serializing-shared-state',
  'principle-minimize-reader-load',
  'principle-guard-the-context-window',
  'principle-sequence-verifiable-units',
  'principle-fix-root-causes',
  'principle-prove-it-works',
];

async function filesIn(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return filesIn(path, key);
      if (!entry.isFile()) throw new Error(`Benny source contains a non-regular file: ${key}`);
      return [[key, await readFile(path, 'utf8')]];
    }),
  );
  return groups.flat();
}

function nativeText(text) {
  return text
    .replaceAll('.cursor/automations/benny', '.pi/automations/benny')
    .replaceAll('.cursor/benny', '.pi/benny')
    .replaceAll('configured Cursor Slack actions', 'configured Slack actions')
    .replaceAll('prefer_cursor_actions', 'prefer_configured_actions')
    .replaceAll('choose-an-available-public-model-slug', 'choose-an-available-provider/model');
}

export async function nativeBennyFiles() {
  const source = await filesIn(join(packageRoot, 'upstream/automations/benny'));
  const files = Object.fromEntries(source.map(([path, content]) => [path, nativeText(content)]));
  const overrides = {
    'FOR_AGENTS.md': 'FOR_AGENTS.md',
    'README.md': 'README.md',
    'skills/setup-benny/SKILL.md': 'SKILL.md',
    'templates/triage-automation-prompt.md': 'triage-automation-prompt.md',
    'templates/reproduce-automation-prompt.md': 'reproduce-automation-prompt.md',
  };
  return {
    ...files,
    ...Object.fromEntries(
      await Promise.all(Object.entries(overrides).map(async ([path, name]) => [path, (await readFile(join(packageRoot, 'host/adapters/benny', name), 'utf8')).replace('(./SKILL.md)', '(./skills/setup-benny/SKILL.md)')])),
    ),
  };
}

async function prepareParent(root, path) {
  let current = root;
  for (const component of dirname(path).split('/')) {
    current = join(current, component);
    try {
      await mkdir(current);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    if (!(await lstat(current)).isDirectory()) throw new Error('Benny destination contains a symbolic link or non-directory.');
  }
}

async function mergeFile(root, path, content) {
  const destination = join(root, path);
  await prepareParent(root, path);
  try {
    await writeFile(destination, content, { flag: 'wx' });
    return 'created';
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return (await readFile(destination, 'utf8')) === content ? 'unchanged' : 'conflict';
  }
}

async function dependencyFiles() {
  return (await Promise.all(bennyDependencies.map(async (name) => (await filesIn(join(packageRoot, 'skills', name))).map(([path, text]) => [`.pi/skills/${name}/${path}`, text])))).flat();
}

async function mergeSettings(root, source) {
  await prepareParent(root, settingsPath);
  const destination = join(root, settingsPath);
  let current = '';
  try {
    current = await readFile(destination, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const merged = mergePackageEntry(current, source);
  if (!merged.changed) return 'unchanged';
  await writeFile(destination, merged.text);
  return current ? 'updated' : 'created';
}

export async function installBenny(target, { packageSource = packageRoot.replace(/\/$/, '') } = {}) {
  const root = await realpath(target);
  const pack = Object.entries(await nativeBennyFiles()).map(([path, text]) => [`.pi/automations/benny/${path}`, text]);
  const dependencies = await dependencyFiles();
  const results = [];
  for (const [path, text] of [...pack, ...dependencies]) results.push({ path, outcome: await mergeFile(root, path, text) });
  const settings = await mergeSettings(root, packageSource);
  return { enabled: false, files: results, conflicts: results.filter((item) => item.outcome === 'conflict').map((item) => item.path), settings };
}

export async function bennyCommitted(target, configurationPaths = []) {
  const root = await realpath(target);
  const paths = [...Object.keys(await nativeBennyFiles()).map((path) => `.pi/automations/benny/${path}`), ...(await dependencyFiles()).map(([path]) => path), settingsPath, ...configurationPaths];
  for (const path of paths) {
    if (typeof path !== 'string' || path.startsWith('/') || path.split('/').includes('..')) throw new Error('Benny runtime paths must be repository-relative.');
    const actual = await realpath(join(root, path));
    if (relative(root, actual).startsWith('..')) throw new Error('Benny runtime path resolves outside the repository.');
    await run('git', ['cat-file', '-e', `HEAD:${path}`], { cwd: root });
    await run('git', ['diff', '--quiet', 'HEAD', '--', path], { cwd: root });
  }
  const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: root });
  return { committed: true, revision: stdout.trim(), paths };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [action, target, ...rest] = process.argv.slice(2);
  const sourceFlag = rest.find((argument) => argument.startsWith('--package-source='));
  const paths = rest.filter((argument) => argument !== sourceFlag);
  if (!target || !['install', 'check-committed'].includes(action)) throw new Error('Usage: benny-setup.mjs install|check-committed <repository> [configuration paths] [--package-source=<pi package source>]');
  const result = action === 'install' ? await installBenny(target, sourceFlag ? { packageSource: sourceFlag.slice('--package-source='.length) } : undefined) : await bennyCommitted(target, paths);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.conflicts?.length) process.exitCode = 1;
}
