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

let cartValue = null;
let checkoutValue = null;
let error = null;
try {
  const cartMod = await import(`${pathToFileURL(join(srcDir, 'cart.js')).href}?t=${Date.now()}`);
  const checkoutMod = await import(
    `${pathToFileURL(join(srcDir, 'checkout.js')).href}?t=${Date.now()}`
  );
  cartValue = cartMod.cart();
  checkoutValue = checkoutMod.checkout();
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
}

const cartOk = cartValue === 'cart:5';
const checkoutOk = checkoutValue === 'pay:5';
const v1Gone = !(await exists(join(srcDir, 'pricingV1.js')));
const pricingPresent = await exists(join(srcDir, 'pricing.js'));

let srcFiles = [];
try {
  srcFiles = (await readdir(srcDir)).filter((name) => name.endsWith('.js'));
} catch {
  srcFiles = [];
}

let dualPath = false;
let legacySymbol = false;
for (const name of srcFiles) {
  const body = await readFile(join(srcDir, name), 'utf8');
  if (/\bpriceV1\b/.test(body) || /\bpricingV1\b/.test(body)) legacySymbol = true;
  if (/compat|shim|bridge|dual.?path/i.test(name)) dualPath = true;
  if (
    /\bpriceV1\b/.test(body) &&
    /\bpriceFor\b/.test(body) &&
    /export\s+(?:function|const|\{)/.test(body)
  ) {
    dualPath = true;
  }
}
if (!v1Gone && pricingPresent) dualPath = true;

const ok = cartOk && checkoutOk && v1Gone && pricingPresent && !legacySymbol && !dualPath;
const line = ok
  ? `OUTCOME-OK cart=${JSON.stringify(cartValue)} checkout=${JSON.stringify(checkoutValue)} files=${srcFiles.sort().join(',')}`
  : `OUTCOME-FAIL cartOk=${cartOk} checkoutOk=${checkoutOk} v1Gone=${v1Gone} pricingPresent=${pricingPresent} legacySymbol=${legacySymbol} dualPath=${dualPath} cart=${JSON.stringify(cartValue)} checkout=${JSON.stringify(checkoutValue)} error=${error ?? 'none'} files=${srcFiles.join(',')}`;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
