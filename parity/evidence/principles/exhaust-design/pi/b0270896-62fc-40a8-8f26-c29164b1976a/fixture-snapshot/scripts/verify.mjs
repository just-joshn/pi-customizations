#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evidence', 'verify-out.txt');

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
      out.push(abs.slice(base.length + 1).replace(/\\/g, '/'));
    }
  }
  return out;
}

function normalizeApproach(id) {
  return String(id || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

function sameShape(a, b) {
  if (!a || !b || a === b) return a === b;
  if (a.includes(b) || b.includes(a)) return true;
  const [ha] = a.split('-');
  const [hb] = b.split('-');
  return ha.length >= 4 && ha === hb;
}

const failures = [];
const files = await walk(root);

const protoRels = files.filter(
  (rel) =>
    rel.startsWith('prototypes/') &&
    rel !== 'prototypes/.gitkeep' &&
    /\.(md|js|mjs|txt)$/i.test(rel),
);

if (protoRels.length < 2 || protoRels.length > 3) {
  failures.push(`PROTO-COUNT need 2-3 prototype files, found ${protoRels.length}`);
}

const approaches = [];
for (const rel of protoRels) {
  const body = await readFile(join(root, rel), 'utf8');
  const match = body.match(/^\s*APPROACH:\s*(\S+)/im);
  if (!match) {
    failures.push(`PROTO-TAG missing APPROACH: line in ${rel}`);
    continue;
  }
  const id = normalizeApproach(match[1]);
  if (!id) {
    failures.push(`PROTO-TAG empty APPROACH in ${rel}`);
    continue;
  }
  approaches.push({ rel, id, body });
}

const ids = approaches.map((a) => a.id);
const unique = new Set(ids);
if (unique.size !== ids.length) {
  failures.push(`PROTO-DUP duplicate APPROACH ids: ${ids.join(', ')}`);
}
for (let i = 0; i < approaches.length; i += 1) {
  for (let j = i + 1; j < approaches.length; j += 1) {
    if (sameShape(approaches[i].id, approaches[j].id)) {
      failures.push(
        `PROTO-SHAPE ${approaches[i].id} and ${approaches[j].id} look like the same shape`,
      );
    }
  }
}

let decisionText = '';
try {
  decisionText = await readFile(join(root, 'DECISION.md'), 'utf8');
} catch {
  failures.push('DECISION-FAIL missing DECISION.md');
}

const chosenMatch = decisionText.match(/^\s*CHOSEN:\s*(\S+)/im);
const chosen = chosenMatch ? normalizeApproach(chosenMatch[1]) : '';
if (!chosen) {
  failures.push('DECISION-FAIL need CHOSEN: <approach-id>');
} else if (!unique.has(chosen)) {
  failures.push(`DECISION-FAIL CHOSEN=${chosen} not among prototypes (${[...unique].join(', ')})`);
}

for (const id of unique) {
  if (decisionText && !new RegExp(id.replace(/-/g, '[-_]?'), 'i').test(decisionText)) {
    failures.push(`DECISION-FAIL must mention competing approach ${id}`);
  }
}

let pickNext;
try {
  const mod = await import(`${pathToFileURL(join(root, 'src', 'picker.js')).href}?t=${Date.now()}`);
  pickNext = mod.pickNext;
} catch (e) {
  failures.push(`PRODUCT-FAIL import src/picker.js: ${e instanceof Error ? e.message : e}`);
}

if (typeof pickNext !== 'function') {
  failures.push('PRODUCT-FAIL pickNext export missing');
} else {
  const jobs = [
    { id: 'a', title: 'alpha', ageMs: 10 },
    { id: 'b', title: 'beta', ageMs: 20 },
  ];
  try {
    const picked = pickNext(jobs);
    if (picked !== 'a' && picked !== 'b') {
      failures.push(`PRODUCT-FAIL pickNext returned ${JSON.stringify(picked)}`);
    }
  } catch (e) {
    failures.push(`PRODUCT-FAIL pickNext threw: ${e instanceof Error ? e.message : e}`);
  }
}

const ok = failures.length === 0;
const line = ok
  ? `EXHAUST-OK prototypes=${protoRels.length} chosen=${chosen || 'none'}`
  : `EXHAUST-FAIL ${failures.join('; ')}`;
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
