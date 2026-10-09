import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const ALLOWED = new Set(['src/store.js']);
const DB_IMPORT = /(?:from\s*|import\s*\(?\s*|require\(\s*)['"][^'"]*\/db(?:\.js)?['"]/;

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.js') ? [join(d, e.name)] : []);

const files = process.argv.length > 2 ? process.argv.slice(2) : walk('src');
let bad = 0;
for (const f of files) {
  if (ALLOWED.has(f) || basename(f) === 'db.js') continue;
  if (DB_IMPORT.test(readFileSync(f, 'utf8'))) {
    console.error(`${f}: imports db.js directly. Use getUser/etc. from src/store.js (add a function there if missing).`);
    bad = 1;
  }
}
process.exit(bad);
