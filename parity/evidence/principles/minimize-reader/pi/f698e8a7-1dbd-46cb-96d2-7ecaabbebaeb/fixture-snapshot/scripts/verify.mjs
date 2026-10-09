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
let value;
let error = null;
try {
  value = greet();
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
  value = null;
}

const greetOk = value === 'hello, world';
const wrappers = ['greeting-loader.js', 'greeting-fetch.js', 'greeting-resolve.js'];
const wrapperGone = Object.fromEntries(
  await Promise.all(wrappers.map(async (name) => [name, !(await exists(join(srcDir, name)))])),
);
const allWrappersGone = wrappers.every((name) => wrapperGone[name]);
const noFacade = !(await exists(join(srcDir, 'facade')));

let srcFiles = [];
try {
  srcFiles = (await readdir(srcDir)).filter((name) => name.endsWith('.js'));
} catch {
  srcFiles = [];
}
const layeredName = srcFiles.some((name) =>
  /facade|adapter|registry|service|middleware|loader|fetch|resolve|pipeline|strateg/i.test(name),
);

const ok = greetOk && allWrappersGone && noFacade && !layeredName;
const line = ok
  ? `TRACE-OK path=collapse files=${srcFiles.sort().join(',')}`
  : `TRACE-FAIL greet=${greetOk} wrappersGone=${JSON.stringify(wrapperGone)} noFacade=${noFacade} layeredName=${layeredName} value=${JSON.stringify(value)} error=${error ?? 'none'} files=${srcFiles.join(',')}`;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
