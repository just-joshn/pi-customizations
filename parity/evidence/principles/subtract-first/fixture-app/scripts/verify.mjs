#!/usr/bin/env node
import { access, mkdir, readdir, writeFile } from 'node:fs/promises';
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

const { greet } = await import(`${pathToFileURL(join(srcDir, 'greet.js')).href}?t=${Date.now()}`);
let plain;
let shout;
let error = null;
try {
  plain = greet();
  shout = greet({ shout: true });
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
  plain = null;
  shout = null;
}

const plainOk = plain === 'hello, world';
const shoutOk = shout === 'HELLO, WORLD';
const legacyGone = !(await exists(join(srcDir, 'legacyValidate.js')));
const stubGone = !(await exists(join(srcDir, 'stubRefs.js')));

let srcFiles = [];
try {
  srcFiles = (await readdir(srcDir)).filter((name) => name.endsWith('.js'));
} catch {
  srcFiles = [];
}
const speculativeName = srcFiles.some((name) =>
  /legacy|stub|validate|guard|parser|middleware|registry|facade/i.test(name),
);

const ok = plainOk && shoutOk && legacyGone && stubGone && !speculativeName;
const line = ok
  ? `SUBTRACT-OK plain=${JSON.stringify(plain)} shout=${JSON.stringify(shout)} files=${srcFiles.sort().join(',')}`
  : `SUBTRACT-FAIL plainOk=${plainOk} shoutOk=${shoutOk} legacyGone=${legacyGone} stubGone=${stubGone} speculativeName=${speculativeName} plain=${JSON.stringify(plain)} shout=${JSON.stringify(shout)} error=${error ?? 'none'} files=${srcFiles.join(',')}`;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
