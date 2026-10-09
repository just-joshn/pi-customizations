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
const pipelineGone = !(await exists(join(srcDir, 'pipeline.js')));
const noStrategies = !(await exists(join(srcDir, 'strategies')));

let srcFiles = [];
try {
  srcFiles = (await readdir(srcDir)).filter((name) => name.endsWith('.js'));
} catch {
  srcFiles = [];
}
const layeredName = srcFiles.some((name) =>
  /strateg|adapter|registry|facade|middleware|pipeline/i.test(name),
);

const ok = greetOk && pipelineGone && noStrategies && !layeredName;
const line = ok
  ? `FLAT-OK path=delete files=${srcFiles.sort().join(',')}`
  : `FLAT-FAIL greet=${greetOk} pipelineGone=${pipelineGone} noStrategies=${noStrategies} layeredName=${layeredName} value=${JSON.stringify(value)} error=${error ?? 'none'} files=${srcFiles.join(',')}`;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
