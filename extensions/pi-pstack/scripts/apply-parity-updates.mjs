import { readdir, readFile, writeFile } from 'node:fs/promises';

const docs = new URL('../docs/', import.meta.url);
const parse = (text) => {
  const [header, ...rows] = text.trimEnd().split('\n');
  const columns = header.split('\t');
  return { columns, records: rows.map((row) => Object.fromEntries(row.split('\t').map((cell, index) => [columns[index], cell]))) };
};

const matrix = parse(await readFile(new URL('subagents-parity.tsv', docs), 'utf8'));
const byId = new Map(matrix.records.map((record) => [record.id, record]));
const updates = (await readdir(new URL('parity-updates/', docs))).filter((name) => name.endsWith('.tsv')).toSorted();
for (const name of updates) {
  for (const update of parse(await readFile(new URL(`parity-updates/${name}`, docs), 'utf8')).records) {
    const record = byId.get(update.id);
    if (!record) continue;
    record.status = update.status;
    if (update.impl_pointer && update.impl_pointer !== '-') record.impl_pointer = update.impl_pointer;
    if (update.test_pointer && update.test_pointer !== '-') record.test_pointer = update.test_pointer;
    record.gap = update.status === 'done-tested' ? '-' : update.note;
  }
}
const lines = [matrix.columns.join('\t'), ...matrix.records.map((record) => matrix.columns.map((column) => record[column] ?? '-').join('\t'))];
await writeFile(new URL('subagents-parity.tsv', docs), `${lines.join('\n')}\n`);
