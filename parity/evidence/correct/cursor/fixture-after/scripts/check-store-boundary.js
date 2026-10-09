#!/usr/bin/env node
/**
 * Lint: feature modules must not import src/db.js.
 * Only src/store.js may import the low-level db. Use store APIs instead.
 *
 * Usage:
 *   node scripts/check-store-boundary.js              # scan src/ (CI)
 *   node scripts/check-store-boundary.js <files...>    # scan named files (proof)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowedImporter = resolve(root, 'src/store.js');

const importRe =
  /(?:import\s+[^'";]*from\s+|require\s*\(\s*)['"]([^'"]*db\.js)['"]/g;

function listJsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...listJsFiles(path));
    else if (name.endsWith('.js')) out.push(path);
  }
  return out;
}

function targetsFromArgs(argv) {
  if (argv.length > 0) {
    return argv.map((a) => resolve(process.cwd(), a));
  }
  return listJsFiles(resolve(root, 'src'));
}

function isDbImport(specifier, importerPath) {
  if (!specifier.endsWith('db.js')) return false;
  if (specifier.includes('node_modules')) return false;
  const resolved = resolve(dirname(importerPath), specifier);
  const rel = relative(root, resolved).replaceAll('\\', '/');
  return rel === 'src/db.js' || rel.endsWith('/src/db.js');
}

const files = targetsFromArgs(process.argv.slice(2));
const violations = [];

for (const file of files) {
  if (resolve(file) === allowedImporter) continue;
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    console.error(`check-store-boundary: cannot read ${file}`);
    process.exit(2);
  }
  importRe.lastIndex = 0;
  let match;
  while ((match = importRe.exec(source)) !== null) {
    const specifier = match[1];
    if (isDbImport(specifier, file)) {
      violations.push({
        file: relative(root, file).replaceAll('\\', '/') || file,
        specifier,
      });
    }
  }
}

if (violations.length > 0) {
  console.error(
    'store-boundary: do not import src/db.js from feature modules; use src/store.js (e.g. getUser) instead.',
  );
  for (const v of violations) {
    console.error(`  ${v.file}: imports '${v.specifier}'`);
  }
  process.exit(1);
}

console.log('store-boundary: ok');
