#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evidence', 'verify-out.txt');

const { greet } = await import(`${pathToFileURL(join(root, 'src', 'greet.js')).href}?t=${Date.now()}`);
const loadSrc = await readFile(join(root, 'src', 'load-config.js'), 'utf8');
const coreSrc = await readFile(join(root, 'src', 'core.js'), 'utf8');

let value = null;
let error = null;
try {
  value = greet();
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
}

const boundaryValidated =
  /\bdisplayName\b/.test(loadSrc) &&
  (/\btypeof\b/.test(loadSrc) || /\.trim\s*\(/.test(loadSrc) || /\bthrow\b/.test(loadSrc)) &&
  /\bname\s*:/.test(loadSrc);
const businessRevalidates =
  /typeof\s+[^\n]*displayName/.test(coreSrc) ||
  /typeof\s+[^\n]*\.name\b/.test(coreSrc) ||
  /invalid displayName/i.test(coreSrc) ||
  /missing domain name/i.test(coreSrc);
const ok = value === 'hello, WORLD' && boundaryValidated && !businessRevalidates;
const line = ok
  ? `BOUNDARY-OK value=${JSON.stringify(value)}`
  : `BOUNDARY-FAIL value=${JSON.stringify(value)} error=${error ?? 'none'} boundaryValidated=${boundaryValidated} businessRevalidates=${businessRevalidates}`;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
