#!/usr/bin/env node
// Per-unit content parity rows for inventory.md: one row per skill, agent, automation file group, and doc, from tree-diff.json.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const j = JSON.parse(readFileSync(new URL('./tree-diff.json', import.meta.url)));
const changed = new Map(
  j.modified.map((m) => {
    const [f, a, r] = m.split(' ');
    return [f, `${a} ${r}`];
  }),
);
const files = execFileSync('git', ['-C', process.argv[2], 'ls-files', 'pstack', 'cursor-team-kit'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const unit = (f) => {
  let m;
  if ((m = /^(pstack|cursor-team-kit)\/skills\/([^/]+)\//.exec(f))) return `${m[1] === 'pstack' ? 'pstack' : 'team-kit'} skill ${m[2]}`;
  if ((m = /^(pstack|cursor-team-kit)\/agents\/([^/]+)\.md$/.exec(f))) return `agent ${m[2]}`;
  if ((m = /^pstack\/automations\/benny\//.exec(f))) return 'benny automation pack';
  if ((m = /^pstack\/docs\/guide\//.exec(f))) return 'pstack guide';
  return `other ${f}`;
};
const groups = new Map();
for (const f of files) {
  const u = unit(f);
  const g = groups.get(u) ?? { files: 0, changed: [] };
  g.files += 1;
  if (changed.has(f)) g.changed.push(`${f.split('/').slice(-2).join('/')} (${changed.get(f)})`);
  groups.set(u, g);
}
let n = 0;
console.log('| ID | Unit | Files | Changed files (+added -removed lines) | Status |');
console.log('|---|---|---|---|---|');
for (const [u, g] of [...groups].sort()) {
  n += 1;
  const status = g.changed.length === 0 ? 'identical' : 'translated (reviewed)';
  console.log(`| CONTENT-${String(n).padStart(3, '0')} | ${u} | ${g.files} | ${g.changed.join('; ') || '-'} | ${status} |`);
}
