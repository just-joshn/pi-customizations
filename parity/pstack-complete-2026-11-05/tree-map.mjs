#!/usr/bin/env node
// Usage: tree-map.mjs <plugins-checkout> <pi-pstack-dir> <out-dir>
// Maps every tracked pstack and cursor-team-kit file to the pi-pstack tree and writes a unified diff per changed text file.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [plugins, pi, out] = process.argv.slice(2);
if (!plugins || !pi || !out) throw new Error('usage: tree-map.mjs <plugins-checkout> <pi-pstack-dir> <out-dir>');

const tracked = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\n')
    .filter(Boolean);
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const binary = /\.(png|jpg|jpeg|gif|webp|mp4|webm|lock)$/;

const reference = tracked(['ls-files', 'pstack', 'cursor-team-kit'], plugins).map((path) => {
  const [plugin, ...rest] = path.split('/');
  return { plugin, file: rest.join('/') };
});
const piFiles = new Set(tracked(['ls-files', '.'], pi));
const rows = [];
for (const { plugin, file } of reference) {
  const source = join(plugins, plugin, file);
  const present = piFiles.has(file) && existsSync(join(pi, file));
  let status = 'absent';
  let diffLines = 0;
  if (present) {
    status = sha(source) === sha(join(pi, file)) ? 'identical' : 'changed';
    if (status === 'changed' && !binary.test(file)) {
      let diff = '';
      try {
        execFileSync('diff', ['-u', source, join(pi, file)], { encoding: 'utf8', maxBuffer: 64 << 20 });
      } catch (error) {
        diff = error.stdout;
      }
      diffLines = diff.split('\n').filter((line) => /^[+-][^+-]/.test(line) || /^[+-]$/.test(line)).length;
      const target = join(out, 'diffs', plugin, `${file}.diff`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, diff);
    }
  }
  rows.push({ plugin, file, status, diffLines });
}
const referenced = new Set(rows.filter((row) => row.status !== 'absent').map((row) => row.file));
const extra = [...piFiles].filter((file) => !referenced.has(file) && !/^(src|test|coverage|node_modules)\//.test(file)).sort();
const summary = {};
for (const row of rows) summary[`${row.plugin}:${row.status}`] = (summary[`${row.plugin}:${row.status}`] ?? 0) + 1;
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'tree-map.json'), `${JSON.stringify({ summary, rows, extra }, null, 2)}\n`);
console.log(JSON.stringify(summary));
for (const row of rows.filter((r) => r.status !== 'identical')) console.log(`${row.status}\t${row.diffLines}\t${row.plugin}/${row.file}`);
console.log(`extra (${extra.length}):\n  ${extra.join('\n  ')}`);
