#!/usr/bin/env node
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evidence', 'verify-out.txt');
const srcDir = join(root, 'src');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

let greetValue = null;
let bannerValue = null;
let error = null;
try {
  const greetMod = await import(`${pathToFileURL(join(srcDir, 'greet.js')).href}?t=${Date.now()}`);
  const bannerMod = await import(`${pathToFileURL(join(srcDir, 'banner.js')).href}?t=${Date.now()}`);
  greetValue = greetMod.greet();
  bannerValue = bannerMod.banner();
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
}

const greetOk = greetValue === 'hello, WORLD';
const bannerOk = bannerValue === 'BANNER:TEAM';
const legacyGone = !(await exists(join(srcDir, 'legacyFormat.js')));
const formatPresent = await exists(join(srcDir, 'format.js'));

let srcFiles = [];
try {
  srcFiles = (await readdir(srcDir)).filter((name) => name.endsWith('.js'));
} catch {
  srcFiles = [];
}

let legacySymbol = false;
let compatShim = false;
for (const name of srcFiles) {
  const body = await readFile(join(srcDir, name), 'utf8');
  if (/\bformatNameLegacy\b/.test(body)) legacySymbol = true;
  if (/\blegacyFormat\b/.test(body)) legacySymbol = true;
  if (
    /\bformatNameLegacy\b/.test(body) &&
    /\bformatName\b/.test(body) &&
    /export\s+(?:function|const|\{)/.test(body)
  ) {
    compatShim = true;
  }
  if (/compat|shim|adapter/i.test(name)) compatShim = true;
}

const ok = greetOk && bannerOk && legacyGone && formatPresent && !legacySymbol && !compatShim;
const line = ok
  ? `MIGRATE-OK greet=${JSON.stringify(greetValue)} banner=${JSON.stringify(bannerValue)} files=${srcFiles.sort().join(',')}`
  : `MIGRATE-FAIL greetOk=${greetOk} bannerOk=${bannerOk} legacyGone=${legacyGone} formatPresent=${formatPresent} legacySymbol=${legacySymbol} compatShim=${compatShim} greet=${JSON.stringify(greetValue)} banner=${JSON.stringify(bannerValue)} error=${error ?? 'none'} files=${srcFiles.join(',')}`;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
