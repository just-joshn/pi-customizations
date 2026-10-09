#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(root, 'src');
const banned = /ALLOW_DEBUG\s*[:=]\s*true/;

async function walk(dir) {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      out.push(...(await walk(abs)));
    } else if (entry.isFile() && /\.(js|mjs|cjs|ts)$/i.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

const files = await walk(srcRoot);
const hits = [];
for (const abs of files) {
  const text = await readFile(abs, 'utf8');
  if (banned.test(text)) {
    hits.push(abs.slice(srcRoot.length + 1));
  }
}

if (hits.length > 0) {
  console.error(`ALLOW_DEBUG must not be true in shipped modules: ${hits.join(', ')}`);
  process.exit(1);
}
