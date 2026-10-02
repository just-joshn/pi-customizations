#!/usr/bin/env node
// Folds docs/parity-updates/*.tsv into docs/subagents-parity.tsv. An update row
// names an id and the columns it closes; `-` keeps the matrix cell. Run
// check-subagent-parity.mjs afterwards, it verifies every pointer.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const docs = new URL('../docs/', import.meta.url);
const parse = (text) => {
  const [header, ...rows] = text.trimEnd().split('\n');
  const columns = header.split('\t');
  return { columns, records: rows.map((row) => Object.fromEntries(row.split('\t').map((cell, index) => [columns[index], cell]))) };
};

const matrix = parse(readFileSync(new URL('subagents-parity.tsv', docs), 'utf8'));
const byId = new Map(matrix.records.map((record) => [record.id, record]));
const updateFiles = readdirSync(new URL('parity-updates/', docs))
  .filter((name) => name.endsWith('.tsv'))
  .toSorted();
const unknown = [];
for (const name of updateFiles) {
  for (const update of parse(readFileSync(new URL(`parity-updates/${name}`, docs), 'utf8')).records) {
    const record = byId.get(update.id);
    if (!record) {
      unknown.push(`${name}: ${update.id}`);
      continue;
    }
    for (const column of ['status', 'impl_pointer', 'test_pointer', 'gap', 'pi_native_approach']) if (update[column] !== undefined && update[column] !== '-') record[column] = update[column];
    if (update.status === 'done-tested' && update.gap === undefined) record.gap = '-';
  }
}
if (unknown.length > 0) throw new Error(`Unknown matrix ids: ${unknown.join(', ')}`);
const lines = [matrix.columns.join('\t'), ...matrix.records.map((record) => matrix.columns.map((column) => record[column] ?? '-').join('\t'))];
writeFileSync(new URL('subagents-parity.tsv', docs), `${lines.join('\n')}\n`);
