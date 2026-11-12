#!/usr/bin/env node
// Import closure of the native runtime. Prints the src files it reaches, the src files it does not
// (deletion candidates), and every candidate a reached file still names as a string path.
// Usage: node parity/pi-native-tmux-2026-11-11/closure.mjs [--why] [--json]. --why prints each kept file's import chain from an entry.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const pkg = resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(), 'extensions/pi-pstack');
const rel = (path) => relative(pkg, path);

const walk = (dir) => (existsSync(join(pkg, dir)) ? readdirSync(join(pkg, dir), { recursive: true, withFileTypes: true }) : [])
  .filter((entry) => entry.isFile() && !entry.parentPath.includes('node_modules'))
  .map((entry) => join(entry.parentPath, entry.name));
const code = /\.(?:ts|mts|cts|mjs|js|cjs)$/;

const helperEntries = [...readFileSync(join(pkg, 'scripts/build-helpers.mjs'), 'utf8').matchAll(/\['([^']+)', '[^']+'\]/g)].map((m) => join(pkg, m[1]));
// The readonly shell is the bash_readonly tool readonly workers get (contract, Worker process); U04a6 wires it.
const declaredKeepers = ['src/readonly-shell.ts'];
const entries = [
  join(pkg, 'src/extension.ts'),
  ...declaredKeepers.map((file) => join(pkg, file)),
  join(pkg, 'src/worker-host.ts'),
  ...walk('scripts').filter((file) => file.endsWith('.mjs')),
  ...helperEntries,
  ...walk('tests').filter((file) => code.test(file)),
];

const specifiers = (source) => [
  ...source.matchAll(/(?:^|[\s;}])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]/gm),
  ...source.matchAll(/(?:^|[\s;])import\s*['"]([^'"]+)['"]/gm),
  ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
  ...source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
  ...source.matchAll(/\bvi\.mock\s*\(\s*['"]([^'"]+)['"]/g),
].map((m) => m[1]);

const resolveSpecifier = (from, specifier) => {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(from), specifier);
  const stem = base.replace(/\.(?:js|mjs|cjs|ts|mts)$/, '');
  for (const candidate of [base, `${stem}.ts`, `${stem}.mts`, `${stem}.d.ts`, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
};

const reached = new Set();
const parent = new Map();
const unresolved = [];
const queue = entries.filter((file) => existsSync(file));
while (queue.length > 0) {
  const file = queue.shift();
  if (reached.has(file)) continue;
  reached.add(file);
  if (!code.test(file)) continue;
  for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
    const target = resolveSpecifier(file, specifier);
    if (target && !parent.has(target) && !entries.includes(target)) parent.set(target, file);
    if (target) queue.push(target);
    else if (specifier.startsWith('.')) unresolved.push(`${rel(file)} -> ${specifier}`);
  }
}

const srcFiles = walk('src').sort();
const chain = (file) => {
  const steps = [rel(file)];
  for (let at = parent.get(file); at; at = parent.get(at)) steps.push(rel(at));
  return steps.reverse().join(' <- '.replace('<-', '->'));
};
const kept = srcFiles.filter((file) => reached.has(file)).map((file) => (process.argv.includes('--why') ? chain(file) : rel(file)));
const candidates = srcFiles.filter((file) => !reached.has(file)).map(rel);
const outsideSrc = [...reached].map(rel).filter((file) => !file.startsWith('src/') && !file.startsWith('tests/') && !file.startsWith('scripts/')).sort();

const stringRefs = [];
for (const file of reached) {
  if (!code.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const candidate of candidates) {
    const needle = new RegExp(`${candidate.replace(/\.ts$/, '').replaceAll('.', '\\.')}(?![\\w-])`);
    if (needle.test(text)) stringRefs.push(`${rel(file)} names ${candidate}`);
  }
}

const report = { entries: entries.map(rel), kept, candidates, outsideSrc, unresolved, stringRefs };
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`entries: ${entries.length} (src/extension.ts, src/worker-host.ts, ${declaredKeepers.join(', ')}, ${helperEntries.length} build-helpers entries, scripts/*.mjs, tests/**)`);
  console.log(`\nkept src (${kept.length}):\n  ${kept.join('\n  ')}`);
  console.log(`\nreached outside src, scripts, tests (${outsideSrc.length}):\n  ${outsideSrc.join('\n  ')}`);
  console.log(`\ndeletion candidates (${candidates.length}):\n  ${candidates.join('\n  ')}`);
  console.log(`\nstring references from reached files to candidates (${stringRefs.length}):\n  ${stringRefs.join('\n  ')}`);
  console.log(`\nunresolved relative imports (${unresolved.length}):\n  ${unresolved.join('\n  ')}`);
}
