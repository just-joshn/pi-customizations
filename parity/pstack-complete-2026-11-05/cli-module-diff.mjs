#!/usr/bin/env node
// Lists the CLI source modules whose bundled code changed between two installs, by hashing each module's body with
// minifier-chosen identifiers blanked out, so a rebuild that only renames variables does not count as a change.
// Usage: cli-module-diff.mjs <old-version-dir> <new-version-dir> [name-filter-regex]
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [oldDir, newDir, filter] = process.argv.slice(2);
const pattern = filter === undefined ? undefined : new RegExp(filter);

function bodies(dir) {
  const text = readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('\n');
  const keys = [...text.matchAll(/"((?:\.\/src\/|\.\.\/[a-z-]+\/(?:dist|src)\/)[^"]+\.(?:tsx?|js))"\(\w+,\w+,\w+\)\{/g)];
  const map = new Map();
  keys.forEach((match, index) => {
    const end = keys[index + 1]?.index ?? text.length;
    const body = text.slice(match.index, end);
    const normalized = body
      .replace(/buildkite-job-[0-9a-f-]+\/[^/"]+/g, 'BK')
      .replace(/\b[A-Za-z_$][A-Za-z0-9_$]{0,2}\b/g, '_')
      .replace(/\d+/g, '0');
    map.set(match[1], { hash: createHash('sha256').update(normalized).digest('hex'), size: body.length });
  });
  return map;
}

const [before, after] = [bodies(oldDir), bodies(newDir)];
const changed = [...after.keys()].filter((name) => before.has(name) && before.get(name).hash !== after.get(name).hash && (pattern === undefined || pattern.test(name))).sort();
console.log(`modules with a body in both: ${[...after.keys()].filter((name) => before.has(name)).length}; changed: ${changed.length}`);
for (const name of changed) console.log(`  ${name} (${before.get(name).size} -> ${after.get(name).size} bytes)`);
