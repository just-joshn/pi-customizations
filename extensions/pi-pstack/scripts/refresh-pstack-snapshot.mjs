#!/usr/bin/env node
// Rewrites upstream/, docs/source-inventory.json and the pstack pin in docs/provenance.json
// from one commit of the authoritative plugins checkout. Run `bun run generate` afterwards.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeSource, relativeSourcePath } from './source-normalize.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [repoArg, commit] = process.argv.slice(2);
if (!repoArg || !/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('Usage: refresh-pstack-snapshot.mjs <plugins-checkout> <40-hex-commit>');
const repo = resolve(repoArg);
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { maxBuffer: 1 << 28 });
const entries = git('ls-tree', '-r', '-z', commit, '--', 'pstack')
  .toString('utf8')
  .split('\0')
  .filter(Boolean)
  .map((line) => {
    const [meta, path] = line.split('\t');
    return { path, executable: meta.startsWith('100755') };
  });
if (!entries.length) throw new Error('Commit has no pstack tree.');

await rm(join(root, 'upstream'), { recursive: true, force: true });
const inventory = [];
for (const { path, executable } of entries) {
  const relative = relativeSourcePath(path);
  const bytes = normalizeSource(relative, git('show', `${commit}:${path}`));
  const target = join(root, 'upstream', relative);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  if (executable) await chmod(target, 0o755);
  inventory.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(join(root, 'docs/source-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);

const version = JSON.parse(await readFile(join(root, 'upstream/plugin-metadata/plugin.json'), 'utf8')).version;
const provenancePath = join(root, 'docs/provenance.json');
const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
await writeFile(provenancePath, `${JSON.stringify({ ...provenance, pstack: { ...provenance.pstack, commit, version } }, null, 2)}\n`);
process.stdout.write(`Refreshed ${inventory.length} pstack files to ${version} at ${commit}.\n`);
