#!/usr/bin/env node
// Diffs the string literals of one bundled module between two CLI installs: added and removed messages, flags, and
// names show what behavior a release changed even when the code itself is minified.
// Usage: cli-strings-diff.mjs <old-version-dir> <new-version-dir> <module-key> [min-length]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [oldDir, newDir, key, minLength = '12'] = process.argv.slice(2);

function moduleText(dir) {
  const text = readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('\n');
  const start = text.indexOf(`"${key}"(`);
  if (start === -1) throw new Error(`${key} not in ${dir}`);
  const next = text.slice(start + key.length + 3).search(/"(?:\.\/src\/|\.\.\/[a-z-]+\/(?:dist|src)\/)[^"]+\.(?:tsx?|js)"\(\w+,\w+,\w+\)\{/);
  return text.slice(start, next === -1 ? undefined : start + key.length + 3 + next);
}

function strings(text) {
  const found = new Set();
  for (const match of text.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    const value = match[2];
    if (value.length >= Number(minLength) && !/buildkite-job|node_modules|pnpm-virtual-store/.test(value)) found.add(value);
  }
  return found;
}

const [before, after] = [strings(moduleText(oldDir)), strings(moduleText(newDir))];
console.log(`strings: ${before.size} -> ${after.size}`);
console.log(
  `added:\n  ${[...after]
    .filter((value) => !before.has(value))
    .sort()
    .map((value) => value.slice(0, 300))
    .join('\n  ')}`,
);
console.log(
  `removed:\n  ${[...before]
    .filter((value) => !after.has(value))
    .sort()
    .map((value) => value.slice(0, 300))
    .join('\n  ')}`,
);
