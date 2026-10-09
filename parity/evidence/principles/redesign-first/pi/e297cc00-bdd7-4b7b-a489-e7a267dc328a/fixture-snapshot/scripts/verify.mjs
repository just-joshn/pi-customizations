#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evidence', 'verify-out.txt');
const failures = [];

const mod = await import(`${pathToFileURL(join(root, 'src', 'product.js')).href}?t=${Date.now()}`);

let bareRejected = false;
try {
  mod.createProduct({ id: 'x', name: 'X', price: 12 });
} catch {
  bareRejected = true;
}
if (!bareRejected) {
  failures.push('BOLT-FAIL createProduct still accepts bare-number price');
}

let shaped;
try {
  shaped = mod.createProduct({
    id: 'mug',
    name: 'Mug',
    price: { amount: 12, currency: 'EUR' },
  });
} catch (error) {
  failures.push(`SHAPE-FAIL createProduct rejected core Price object (${error.message})`);
  shaped = null;
}

if (shaped) {
  const price = shaped.price;
  if (
    !price ||
    typeof price !== 'object' ||
    price.amount !== 12 ||
    price.currency !== 'EUR'
  ) {
    failures.push('SHAPE-FAIL product.price must be { amount, currency }');
  }
  let label;
  try {
    label = mod.formatPrice(price);
  } catch (error) {
    failures.push(`FORMAT-FAIL formatPrice threw (${error.message})`);
    label = '';
  }
  if (!/12/.test(String(label)) || !/EUR/i.test(String(label))) {
    failures.push(`FORMAT-FAIL formatPrice=${label} expected amount and currency`);
  }
}

const priceDoc = await readFile(join(root, 'docs', 'price.md'), 'utf8');
const readme = await readFile(join(root, 'README.md'), 'utf8');
const coreDoc =
  /amount\s*,\s*currency|currency\s*,\s*amount|\{[^}]*amount[^}]*currency[^}]*\}/i.test(
    priceDoc,
  );
const oldDoc = /bare number|currency is implied/i.test(priceDoc);
if (!coreDoc) {
  failures.push('DOC-FAIL docs/price.md must describe Price as amount+currency');
}
if (oldDoc) {
  failures.push('DOC-FAIL docs/price.md still describes bare-number / implied currency');
}
if (!/currency/i.test(readme) || /USD implied|bare number/i.test(readme)) {
  failures.push('DOC-FAIL README.md must treat currency as part of the core price shape');
}

const ok = failures.length === 0;
const line = ok ? 'REDESIGN-OK' : `REDESIGN-FAIL ${failures.join('; ')}`;
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
