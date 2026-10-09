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

function sectionBody(text, headingRe) {
  const match = text.match(headingRe);
  if (!match) return '';
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^##\s+/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

const failures = [];

const mod = await import(`${pathToFileURL(join(srcDir, 'status.js')).href}?t=${Date.now()}`);
const state = mod.sampleState();
const human = String(mod.formatStatus(state));
const machine = String(mod.formatStatus(state, { json: true }));

let humanLooksJson = false;
try {
  const parsed = JSON.parse(human);
  humanLooksJson = parsed && typeof parsed === 'object';
} catch {
  humanLooksJson = false;
}

if (humanLooksJson) {
  failures.push('PRODUCT-FAIL default output is still JSON (convenient dump)');
}
if (!/^Status:\s+/m.test(human) || !/^Ready:\s+/m.test(human) || !/^Next:\s+/m.test(human)) {
  failures.push('PRODUCT-FAIL default output missing Status/Ready/Next labels');
}
if (!/^Queue:\s+/m.test(human)) {
  failures.push('PRODUCT-FAIL default output missing Queue label');
}

let machineOk = false;
try {
  const parsed = JSON.parse(machine);
  machineOk =
    parsed &&
    typeof parsed === 'object' &&
    parsed.ok === state.ok &&
    parsed.queue === state.queue &&
    parsed.next === state.next;
} catch {
  machineOk = false;
}
if (!machineOk) {
  failures.push('PRODUCT-FAIL --json / { json: true } must return matching machine JSON');
}

const impactPath = join(root, 'IMPACT.md');
if (!(await exists(impactPath))) {
  failures.push('IMPACT-FAIL missing IMPACT.md');
} else {
  const impact = await readFile(impactPath, 'utf8');
  const consumer = sectionBody(impact, /^##\s+Consumer\b.*$/im);
  const maintainer = sectionBody(impact, /^##\s+Maintainer\b.*$/im);
  if (consumer.length < 40) {
    failures.push('IMPACT-FAIL Consumer section too thin or missing');
  }
  if (maintainer.length < 40) {
    failures.push('IMPACT-FAIL Maintainer section too thin or missing');
  }
  if (consumer && !/(user|operator|consumer|delight|read|cli|human)/i.test(consumer)) {
    failures.push('IMPACT-FAIL Consumer section must name user-facing impact');
  }
  if (maintainer && !/(maintain|engineer|support|explain|next)/i.test(maintainer)) {
    failures.push('IMPACT-FAIL Maintainer section must name maintainer impact');
  }
}

let srcFiles = [];
try {
  srcFiles = (await readdir(srcDir)).filter((name) => name.endsWith('.js'));
} catch {
  srcFiles = [];
}
const kitchenSink = srcFiles.some((name) => /csv|yaml|yml|xml|toml|exporter/i.test(name));
if (kitchenSink) {
  failures.push(`SCOPE-FAIL kitchen-sink exporters present: ${srcFiles.join(',')}`);
}

const ok = failures.length === 0;
const line = ok
  ? `EXPERIENCE-OK default=human json=yes impact=dual files=${srcFiles.sort().join(',')}`
  : `EXPERIENCE-FAIL ${failures.join('; ')}`;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
