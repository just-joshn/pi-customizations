/**
 * Parity gate (framing.md P1): every inventory row needs exactly one matrix
 * row with a known status, evidence rules per status, and a real test file
 * behind every `implemented` row. Exits 1 printing each problem, else prints
 * status counts and exits 0.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY_PATH = join(ROOT, '..', '..', '.audit', 'pi-tui-parity', 'inventory.tsv');
const MATRIX_PATH = join(ROOT, 'parity', 'matrix.tsv');
const SEP = '⇥';
const STATUSES = new Set(['implemented', 'mapped', 'deviation', 'unmet']);

function readRows(path, separator) {
  const text = readFileSync(path, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split(separator));
}

const inventory = readRows(INVENTORY_PATH, '\t').slice(1);
const inventoryIds = inventory.map((fields) => fields[0]);

const problems = [];
const matrixRows = readRows(MATRIX_PATH, SEP);
const matrixIds = new Set();
const statusCounts = { implemented: 0, mapped: 0, deviation: 0, unmet: 0 };

matrixRows.forEach((fields, index) => {
  const lineNo = index + 1;
  if (fields.some((field) => field.includes('\t'))) {
    problems.push(`matrix line ${lineNo}: raw tab inside row (separator must be ⇥ U+21E5)`);
  }
  const [id, status, evidence] = fields;
  if (fields.length !== 4) {
    problems.push(`matrix line ${lineNo}: expected 4 ⇥-separated fields, found ${fields.length}`);
    return;
  }
  if (matrixIds.has(id)) problems.push(`matrix line ${lineNo}: duplicate id ${id}`);
  matrixIds.add(id);
  if (!STATUSES.has(status)) {
    problems.push(`matrix line ${lineNo} (${id}): unknown status "${status}"`);
    return;
  }
  statusCounts[status] += 1;
  if (status === 'implemented' || status === 'mapped') {
    if (evidence.length === 0) problems.push(`matrix row ${id}: ${status} rows need evidence`);
  }
  if (status === 'implemented' && evidence.length > 0 && !existsSync(join(ROOT, evidence))) {
    problems.push(`matrix row ${id}: evidence test path does not exist: ${evidence}`);
  }
  if (!inventoryIds.includes(id)) problems.push(`matrix row ${id}: not present in the inventory`);
});

for (const id of inventoryIds) {
  if (!matrixIds.has(id)) problems.push(`inventory id ${id} has no matrix row`);
}

if (problems.length > 0) {
  process.stderr.write(`check:parity failed with ${problems.length} problem(s):\n`);
  for (const problem of problems) process.stderr.write(`- ${problem}\n`);
  process.exit(1);
}

process.stdout.write(`parity matrix OK: ${matrixRows.length} rows for ${inventoryIds.length} inventory ids\n`);
process.stdout.write(`counts: ${JSON.stringify(statusCounts)}\n`);
