#!/usr/bin/env node
// Usage: word-changes.mjs <plugins-checkout> <pi-pstack-dir> <tree-map.json> [filter-regex]
// Prints each changed span between a reference file and its pi-pstack copy as [-removed-]{+added+} with a few words of context.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// diff-match-patch is pi-maintainer's dependency; this audit script borrows it from that workspace package.
const require = createRequire(join(process.cwd(), 'extensions/pi-maintainer/package.json'));
const DiffMatchPatch = require(['diff', 'match', 'patch'].join('-'));
const [plugins, pi, mapPath, filter] = process.argv.slice(2);
const map = JSON.parse(readFileSync(mapPath, 'utf8'));
const pattern = filter ? new RegExp(filter) : null;
const dmp = new DiffMatchPatch();
const CONTEXT = 60;

for (const row of map.rows) {
  if (row.status !== 'changed' || /\.(png|jpg|lock)$/.test(row.file)) continue;
  const name = `${row.plugin}/${row.file}`;
  if (pattern && !pattern.test(name)) continue;
  const before = readFileSync(join(plugins, row.plugin, row.file), 'utf8');
  const after = readFileSync(join(pi, row.file), 'utf8');
  const diffs = dmp.diff_main(before, after);
  dmp.diff_cleanupSemantic(diffs);
  const out = [];
  let line = 1;
  for (let i = 0; i < diffs.length; i++) {
    const [op, text] = diffs[i];
    if (op === 0) {
      line += (text.match(/\n/g) ?? []).length;
      continue;
    }
    const prev = diffs[i - 1]?.[0] === 0 ? diffs[i - 1][1] : '';
    let removed = '';
    let added = '';
    let j = i;
    while (j < diffs.length && diffs[j][0] !== 0) {
      if (diffs[j][0] === -1) removed += diffs[j][1];
      else added += diffs[j][1];
      j++;
    }
    const next = diffs[j]?.[0] === 0 ? diffs[j][1] : '';
    const flat = (s) => s.replace(/\n/g, '⏎');
    out.push(`  L${line}: …${flat(prev.slice(-CONTEXT))}${removed ? `[-${flat(removed)}-]` : ''}${added ? `{+${flat(added)}+}` : ''}${flat(next.slice(0, CONTEXT))}…`);
    line += (removed.match(/\n/g) ?? []).length;
    i = j - 1;
  }
  console.log(`### ${name} (${out.length} spans)`);
  console.log(out.join('\n'));
}
