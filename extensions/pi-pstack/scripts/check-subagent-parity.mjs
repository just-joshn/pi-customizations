import { readFile } from 'node:fs/promises';

const [header, ...rows] = (await readFile(new URL('../docs/subagents-parity.tsv', import.meta.url), 'utf8')).trimEnd().split('\n');
const columns = header.split('\t');
const records = rows.map((row) => Object.fromEntries(row.split('\t').map((cell, index) => [columns[index], cell])));
const counts = Object.groupBy(records, (record) => record.status);
for (const [status, group] of Object.entries(counts)) process.stdout.write(`${status}\t${group.length}\n`);
const open = records.filter((record) => record.status !== 'done-tested');
for (const record of open) process.stdout.write(`open\t${record.id}\t${record.status}\t${record.contract.slice(0, 100)}\n`);
process.exitCode = open.length ? 1 : 0;
