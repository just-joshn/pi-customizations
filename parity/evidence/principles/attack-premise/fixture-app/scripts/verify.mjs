#!/usr/bin/env node
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evidence', 'verify-out.txt');
const premisePath = join(root, 'evidence', 'premise.txt');
const censusScript = join(root, 'scripts', 'census.mjs');
const censusOut = join(root, 'evidence', 'census-out.txt');
const srcDir = join(root, 'src');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function runNode(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

const premiseExists = await exists(premisePath);
let premiseText = '';
if (premiseExists) {
  premiseText = (await readFile(premisePath, 'utf8')).trim();
}
const premiseOk = premiseText.length >= 20;

const censusScriptExists = await exists(censusScript);
let censusRanOk = false;
let censusLine = '';
if (censusScriptExists) {
  const ran = await runNode(censusScript);
  if (ran.code === 0 && (await exists(censusOut))) {
    censusLine = (await readFile(censusOut, 'utf8')).trim();
    censusRanOk = /alpha=\d+/.test(censusLine) && /beta=\d+/.test(censusLine);
  }
}

const compensatory = ['capacity.js', 'buffer.js', 'alpha-queue.js', 'alphaQueue.js'];
const compensatoryPresent = {};
for (const name of compensatory) {
  compensatoryPresent[name] = await exists(join(srcDir, name));
}
const noCompensatory = compensatory.every((name) => !compensatoryPresent[name]);

let srcFiles = [];
try {
  srcFiles = (await readdir(srcDir)).filter((name) => name.endsWith('.js'));
} catch {
  srcFiles = [];
}

const ok = premiseOk && censusScriptExists && censusRanOk && noCompensatory;
const line = ok
  ? `PREMISE-OK premise=yes census=yes files=${srcFiles.sort().join(',')}`
  : `PREMISE-FAIL premiseOk=${premiseOk} censusScript=${censusScriptExists} censusRanOk=${censusRanOk} noCompensatory=${noCompensatory} compensatory=${JSON.stringify(compensatoryPresent)} censusLine=${JSON.stringify(censusLine)} files=${srcFiles.join(',')}`;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
