#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const supported = /\.(?:[cm]?[jt]sx?|jsonc?|css|graphql|gql|html|vue|svelte|astro)$/;

export function writableSources(paths) {
  const preserved = ['extensions/pi-pstack/upstream/', 'extensions/pi-pstack/upstream-team-kit/', 'extensions/pi-pstack/skills/', 'extensions/pi-pstack/docs/parity/clauses/'];
  return [...new Set(paths)].filter(
    (path) => basename(path) !== 'vitest.config.ts' && path !== 'extensions/pi-pstack/docs/resource-map.json' && !preserved.some((prefix) => path.replaceAll('\\', '/').startsWith(prefix)) && supported.test(path),
  );
}

async function protectedHashes(root, paths) {
  return Promise.all(
    paths
      .filter((path) => basename(path) === 'vitest.config.ts')
      .map(async (path) => {
        const bytes = await readFile(join(root, path));
        return [path, createHash('sha256').update(bytes).digest('hex')];
      }),
  );
}

async function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const paths = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).toSorted();
  const before = await protectedHashes(root, paths);
  const errors = await (async () => {
    try {
      const resolved = await Promise.all(
        writableSources(paths).map(async (path) => {
          try {
            const target = await realpath(join(root, path));
            const local = relative(root, target);
            if (local === '..' || local.startsWith('../') || local.startsWith('..\\') || isAbsolute(local)) throw new Error(`Format input resolves outside the repository: ${path}`);
            return local;
          } catch (error) {
            if (error.code === 'ENOENT') return null;
            throw error;
          }
        }),
      );
      const writable = writableSources(resolved.filter(Boolean));
      if (writable.length > 0) execFileSync(join(root, 'node_modules/.bin/biome'), ['check', '--write', ...writable.map((path) => `./${path}`)], { cwd: root, stdio: 'inherit' });
    } catch (error) {
      return [error];
    }
    return [];
  })();
  const after = await protectedHashes(root, paths);
  const failures = JSON.stringify(before) === JSON.stringify(after) ? errors : [...errors, new Error('Protected Vitest config bytes changed during formatting. No restoration was attempted.')];
  if (failures.length > 0) throw new AggregateError(failures, 'Protected-safe formatting failed.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
