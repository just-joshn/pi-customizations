#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evidence', 'verify-out.txt');
const stateDir = join(root, 'state');

async function loadApply() {
  return import(`${pathToFileURL(join(root, 'src', 'apply.js')).href}?t=${Date.now()}`);
}

async function cleanState() {
  await rm(stateDir, { force: true, recursive: true });
  await mkdir(stateDir, { recursive: true });
}

async function finalDigest() {
  const body = await readFile(join(stateDir, 'final.json'));
  return createHash('sha256').update(body).digest('hex');
}

async function readFinal() {
  return JSON.parse(await readFile(join(stateDir, 'final.json'), 'utf8'));
}

let line = 'APPLY-FAIL reason=unknown';
let ok = false;

try {
  const { apply } = await loadApply();

  await cleanState();
  await apply(root, {});
  const cleanFinal = await readFinal();
  const cleanDigest = await finalDigest();

  await cleanState();
  try {
    await apply(root, { crashAfter: 1 });
    line = 'APPLY-FAIL reason=expected-crash-missing';
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? e.code : null;
    if (code !== 'CRASH_AFTER_STEP_1') {
      line = `APPLY-FAIL reason=wrong-crash code=${code ?? 'none'}`;
    } else {
      const { apply: applyAgain } = await loadApply();
      await applyAgain(root, {});
      const afterCrashFinal = await readFinal();
      const afterCrashDigest = await finalDigest();
      const sameDigest = afterCrashDigest === cleanDigest;
      const samePayload =
        afterCrashFinal.status === cleanFinal.status &&
        afterCrashFinal.payload === cleanFinal.payload &&
        JSON.stringify(afterCrashFinal) === JSON.stringify(cleanFinal);

      if (sameDigest && samePayload) {
        ok = true;
        line = `APPLY-OK converge=yes digest=${cleanDigest}`;
      } else {
        line = `APPLY-FAIL converge=no clean=${cleanDigest} after=${afterCrashDigest} cleanFinal=${JSON.stringify(cleanFinal)} afterFinal=${JSON.stringify(afterCrashFinal)}`;
      }
    }
  }
} catch (e) {
  line = `APPLY-FAIL reason=exception error=${e instanceof Error ? e.message : String(e)}`;
}

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
