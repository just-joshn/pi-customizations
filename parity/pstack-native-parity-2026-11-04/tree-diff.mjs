#!/usr/bin/env node
// Deterministic file-level comparison of the reference pstack + cursor-team-kit trees
// against the pi-pstack package tree. Usage: node tree-diff.mjs <plugins-checkout> <pi-pstack-dir>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const [plugins, pkg] = process.argv.slice(2);
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const tracked = (dir) => execFileSync('git', ['-C', plugins, 'ls-files', dir], { encoding: 'utf8' }).split('\n').filter(Boolean);

const mapPath = (file) => {
  const rules = [
    [/^pstack\/(skills|agents|automations)\//, (f) => f.replace(/^pstack\//, '')],
    [/^pstack\/docs\/guide\//, (f) => f.replace(/^pstack\//, '')],
    [/^pstack\/assets\//, (f) => f.replace(/^pstack\//, '')],
    [/^pstack\/LICENSE$/, () => 'licenses/pstack.LICENSE'],
    [/^pstack\/README\.md$/, () => 'README.md'],
    [/^cursor-team-kit\/(skills|agents)\//, (f) => f.replace(/^cursor-team-kit\//, '')],
    [/^cursor-team-kit\/LICENSE$/, () => 'licenses/cursor-team-kit.LICENSE'],
  ];
  for (const [re, fn] of rules) if (re.test(file)) return fn(file);
  return null;
};

const walk = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
};

const rows = [];
const mapped = new Set();
for (const file of [...tracked('pstack'), ...tracked('cursor-team-kit')]) {
  const target = mapPath(file);
  if (!target) {
    rows.push({ file, status: 'unmapped' });
    continue;
  }
  mapped.add(target);
  const tp = join(pkg, target);
  if (!existsSync(tp)) {
    rows.push({ file, target, status: 'missing' });
    continue;
  }
  const same = sha(join(plugins, file)) === sha(tp);
  let added = 0,
    removed = 0;
  if (!same) {
    try {
      execFileSync('git', ['diff', '--no-index', '--numstat', join(plugins, file), tp], { encoding: 'utf8' });
    } catch (e) {
      const [a, r] = String(e.stdout).trim().split(/\s+/);
      added = Number(a);
      removed = Number(r);
    }
  }
  rows.push({ file, target, status: same ? 'identical' : 'modified', added, removed });
}
const extras = [];
for (const top of ['skills', 'agents', 'automations', 'docs', 'assets', 'licenses']) {
  const d = join(pkg, top);
  if (!existsSync(d)) continue;
  for (const p of walk(d)) {
    const rel = relative(pkg, p);
    if (!mapped.has(rel)) extras.push(rel);
  }
}
const count = (s) => rows.filter((r) => r.status === s).length;
console.log(
  JSON.stringify(
    {
      summary: { reference: rows.length, identical: count('identical'), modified: count('modified'), missing: count('missing'), unmapped: count('unmapped'), extras: extras.length },
      modified: rows.filter((r) => r.status === 'modified').map((r) => `${r.file} +${r.added} -${r.removed}`),
      missing: rows.filter((r) => r.status === 'missing').map((r) => r.file),
      unmapped: rows.filter((r) => r.status === 'unmapped').map((r) => r.file),
      extras,
    },
    null,
    2,
  ),
);
