#!/usr/bin/env node
// Usage: tree-diff.mjs <plugins-checkout> <pi-pstack-dir> <out.json>
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const [plugins, pi, out] = process.argv.slice(2);
const skip = new Set(['node_modules', '.git', 'coverage', '.DS_Store']);

function walk(root) {
  const files = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) visit(path);
      else files.push(relative(root, path));
    }
  };
  visit(root);
  return files.sort();
}

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const reference = [];
for (const plugin of ['pstack', 'cursor-team-kit']) {
  for (const file of walk(join(plugins, plugin))) reference.push({ plugin, file });
}

const piFiles = new Set(walk(pi));
const claimed = new Set();
const rows = reference.map(({ plugin, file }) => {
  const source = join(plugins, plugin, file);
  const target = piFiles.has(file) ? file : null;
  if (target) claimed.add(target);
  const status = target === null ? 'absent' : sha(source) === sha(join(pi, target)) ? 'identical' : 'changed';
  return { plugin, file, target, status };
});
const extra = [...piFiles].filter((file) => !claimed.has(file) && !file.startsWith('src/') && !file.startsWith('test/'));
const summary = {};
for (const row of rows) summary[`${row.plugin}:${row.status}`] = (summary[`${row.plugin}:${row.status}`] ?? 0) + 1;
writeFileSync(out, `${JSON.stringify({ summary, rows, extra }, null, 2)}\n`);
console.log(JSON.stringify(summary));
console.log(
  'absent:',
  rows
    .filter((r) => r.status === 'absent')
    .map((r) => `${r.plugin}/${r.file}`)
    .join('\n  '),
);
console.log(
  'changed:',
  rows
    .filter((r) => r.status === 'changed')
    .map((r) => `${r.plugin}/${r.file}`)
    .join('\n  '),
);
console.log('extra (non src/test):', extra.length);
