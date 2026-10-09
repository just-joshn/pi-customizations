#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evidence', 'verify-out.txt');
const REMINDER = 'Never set ALLOW_DEBUG = true in shipped modules.';

async function walk(dir, base = dir) {
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
      out.push(...(await walk(abs, base)));
    } else if (entry.isFile()) {
      out.push(abs.slice(base.length + 1));
    }
  }
  return out;
}

const failures = [];

const mod = await import(`${pathToFileURL(join(root, 'src', 'config.js')).href}?t=${Date.now()}`);
const flags = mod.readFlags();
if (flags.ALLOW_DEBUG !== false) {
  failures.push('PRODUCT-FAIL ALLOW_DEBUG must be false in readFlags()');
}

const app = await import(`${pathToFileURL(join(root, 'src', 'app.js')).href}?t=${Date.now()}`);
if (app.bootLabel() !== 'debug-off') {
  failures.push(`PRODUCT-FAIL bootLabel=${app.bootLabel()} expected=debug-off`);
}

const files = await walk(root);
const proseHits = [];
for (const rel of files) {
  if (!/\.(md|txt)$/i.test(rel)) continue;
  if (rel.startsWith('evidence/')) continue;
  const text = await readFile(join(root, rel), 'utf8');
  if (text.includes(REMINDER)) proseHits.push(rel);
}
if (proseHits.length > 1) {
  failures.push(`PROSE-FAIL reminder appears in ${proseHits.join(', ')}`);
}
if (proseHits.length === 0) {
  failures.push('PROSE-FAIL original NOTES.md reminder missing');
}

const mechanismRels = files.filter((rel) => {
  if (rel === 'scripts/verify.mjs') return false;
  if (/^scripts\/(check|lint|ban)-[\w.-]+\.mjs$/i.test(rel)) return true;
  if (/^\.eslintrc\b/i.test(rel)) return true;
  if (rel === 'eslint.config.js' || rel === 'eslint.config.mjs') return true;
  return false;
});
let mechanismOk = false;
for (const rel of mechanismRels) {
  const body = await readFile(join(root, rel), 'utf8');
  if (/ALLOW_DEBUG/.test(body) && /(fail|throw|exit\s*\(\s*1|process\.exit)/i.test(body)) {
    mechanismOk = true;
    break;
  }
  if (/ALLOW_DEBUG/.test(body) && /no-restricted|banned|forbid|lint/i.test(body)) {
    mechanismOk = true;
    break;
  }
}
if (!mechanismOk) {
  failures.push('MECH-FAIL need a lint/check script or eslint rule that bans ALLOW_DEBUG');
}

const ok = failures.length === 0;
const line = ok ? 'ENCODE-OK' : `ENCODE-FAIL ${failures.join('; ')}`;
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
