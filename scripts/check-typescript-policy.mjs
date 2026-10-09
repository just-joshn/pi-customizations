#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { API } from 'typescript/unstable/sync';

const artifacts = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);
const sourcePattern = /\.(?:ts|tsx|mts|cts)$/;
const configPattern = /^tsconfig(?:\.[^.]+)?\.json$/;
const preservedRoots = [
  'extensions/pi-pstack/upstream/',
  'extensions/pi-pstack/upstream-team-kit/',
  'extensions/pi-pstack/skills/',
  'extensions/pi-caveman/vendor/',
  'parity/reference/',
  'parity/fixtures/',
  'parity/evidence/',
  'parity/private/',
  'parity/artifacts/',
  'parity/research/',
];
const helperConfig = 'extensions/pi-pstack/test/helpers/tsconfig.json';
// biome-ignore lint/security/noSecrets: Public TypeScript option names are not credentials.
const helperExceptions = new Set(['noPropertyAccessFromIndexSignature', 'erasableSyntaxOnly', 'noUncheckedIndexedAccess']);
const localPath = (root, path) => relative(root, path).replaceAll('\\', '/');
const isPreserved = (root, path) => preservedRoots.some((prefix) => localPath(root, path).startsWith(prefix));

async function discover(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return artifacts.has(entry.name) ? [] : discover(path);
      return sourcePattern.test(entry.name) || configPattern.test(entry.name) ? [path] : [];
    }),
  );
  return groups.flat().toSorted();
}

export async function inspectTypeScriptPolicy(root) {
  const paths = (await discover(root)).filter((path) => !isPreserved(root, path));
  const sources = paths.filter((path) => sourcePattern.test(path));
  const configs = paths.filter((path) => configPattern.test(basename(path)));
  const failures = [];
  const api = new API({ cwd: root });
  try {
    const authority = api.parseConfigFile(join(root, 'tsconfig.json'));
    const helper = configs.find((path) => localPath(root, path) === helperConfig);
    const helperPolicy = helper ? api.parseConfigFile(helper) : undefined;
    const helperSources = helperPolicy?.fileNames.filter((path) => localPath(root, path).startsWith('extensions/pi-pstack/test/helpers/')) ?? [];
    const selected = new Set([...authority.fileNames, ...helperSources].map((path) => localPath(root, path)));
    for (const path of sources) {
      if (!selected.has(relative(root, path).replaceAll('\\', '/'))) failures.push(`Root compiler does not select ${relative(root, path)}`);
    }
    for (const path of configs) {
      if (path === join(root, 'tsconfig.json')) continue;
      const config = api.parseConfigFile(path);
      const types = JSON.stringify(config.options.types);
      if (types !== JSON.stringify(['node']) && types !== JSON.stringify(['node', 'bun-types'])) {
        failures.push(`${relative(root, path)} has an unapproved runtime declaration set`);
      }
      const keys = new Set([...Object.keys(authority.options), ...Object.keys(config.options)]);
      for (const key of [...keys].toSorted()) {
        if (key === 'configFilePath' || key === 'types') continue;
        if (localPath(root, path) === helperConfig && helperExceptions.has(key) && config.options[key] === false) continue;
        if (JSON.stringify(authority.options[key]) !== JSON.stringify(config.options[key])) {
          failures.push(`${relative(root, path)} differs from root compiler policy for ${key}`);
        }
      }
    }
    return { sources, configs, failures };
  } finally {
    api.close();
  }
}

async function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const result = await inspectTypeScriptPolicy(root);
  process.stdout.write(`TypeScript policy accounts for ${result.sources.length} sources and ${result.configs.length} configurations.\n`);
  for (const failure of result.failures) process.stderr.write(`${failure}\n`);
  if (result.failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
