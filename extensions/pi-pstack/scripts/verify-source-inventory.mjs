#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { checkout: { type: 'string' }, root: { type: 'string' } } });
if (!values.checkout) throw new Error('Pass --checkout <cursor/plugins checkout at the locked revision>');
const root = resolve(values.root ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const checkout = resolve(values.checkout);
const inventory = JSON.parse(readFileSync(join(root, 'generated/upstream-inventory.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'generated/upstream-lock.json'), 'utf8'));
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim();
const revision = git('rev-parse', 'HEAD');
if (revision !== lock.revision || inventory.revision !== revision) throw new Error('Checkout, source lock and inventory revisions must match exactly');
const records = git('ls-tree', '-r', '-z', revision, '--', ...inventory.sources.map((source) => source.path))
  .split('\0')
  .filter(Boolean);
const paths = records.map((record) => record.split('\t')[1]);
if (paths.sort().join('\n') !== Object.keys(inventory.files).sort().join('\n')) throw new Error('Fetched source inventory differs from the recorded paths');
let vendored = 0;
for (const record of records) {
  const [header, path] = record.split('\t');
  const blob = header.split(' ')[2];
  const entry = inventory.files[path];
  const bytes = readFileSync(join(checkout, path));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const actualBlob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (entry.blob !== blob || actualBlob !== blob || entry.sha256 !== sha256) throw new Error(`${path}: fetched bytes or recorded hash differ from the pinned Git blob`);
  if (!entry.vendorPath) continue;
  if (!bytes.equals(readFileSync(join(root, entry.vendorPath))) || lock.files[entry.vendorPath] !== sha256) throw new Error(`${entry.vendorPath}: vendor bytes or lock differ from the fetched source`);
  vendored++;
}
for (const source of inventory.sources) {
  if (source.revision !== revision || source.tree !== git('rev-parse', `${revision}:${source.path}`) || source.files !== paths.filter((path) => path.startsWith(`${source.path}/`)).length)
    throw new Error(`${source.path}: source revision, tree or file count mismatch`);
}
if (vendored !== Object.keys(lock.files).length) throw new Error('Source lock contains files absent from the fetched inventory');
console.log(
  JSON.stringify(
    {
      revision,
      sources: inventory.sources,
      fetchedFiles: paths.length,
      verifiedVendorFiles: vendored,
      inventoryOnlyFiles: paths.filter((path) => !inventory.files[path].vendorPath),
      scope: 'Source inventory and byte identity only. No runtime parity claim.',
    },
    null,
    2,
  ),
);
