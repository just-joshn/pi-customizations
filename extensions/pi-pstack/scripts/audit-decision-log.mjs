import { createReadStream } from 'node:fs';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const [log, transcript, output] = process.argv.slice(2);
if (!log || !transcript || !output || process.argv.length !== 5) throw new Error('Usage: node audit-decision-log.mjs <trail.tsv> <current-workspace-transcript.jsonl> <fresh-output-directory>');
const source = (await readFile(log, 'utf8')).trimEnd().split('\n');
if (source[0] !== ['ts', 'phase', 'decision', 'why', 'evidence', 'result'].join('\t')) throw new Error('Unexpected trail header');
const pointers = source.slice(1).map((line, index) => {
  const cells = line.split('\t');
  if (cells.length !== 6 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(cells[0])) throw new Error(`Malformed decision row ${index + 2}`);
  return { line: index + 2, timestamp: cells[0], phase: cells[1], evidence: cells[4], mentions: [] };
});
function recordToolCalls(entry, pointers) {
  if (entry.type !== 'message' || entry.message?.role !== 'assistant') return 0;
  let count = 0;
  for (const block of entry.message.content ?? []) {
    if (block.type !== 'toolCall') continue;
    count++;
    if (block.name === 'read') continue;
    const args = JSON.stringify(block.arguments);
    if (args.includes('log.sh') && args.includes(log)) continue;
    for (const pointer of pointers) {
      if (args.includes(pointer.evidence) || args.includes(basename(pointer.evidence))) pointer.mentions.push({ entry: entry.id, tool: block.name });
    }
  }
  return count;
}
const lines = createInterface({ input: createReadStream(transcript), crlfDelay: Infinity });
let header;
let entries = 0;
let toolCalls = 0;
try {
  for await (const line of lines) {
    const entry = JSON.parse(line);
    if (!header) {
      if (entry.type !== 'session' || typeof entry.cwd !== 'string' || (await realpath(entry.cwd).catch(() => resolve(entry.cwd))) !== process.cwd()) throw new Error('Transcript does not belong to the current workspace');
      header = { id: entry.id, cwd: entry.cwd };
      continue;
    }
    entries++;
    toolCalls += recordToolCalls(entry, pointers);
  }
} finally {
  lines.close();
}
if (!header) throw new Error('Empty transcript');
const rows = await Promise.all(
  pointers.map(async (pointer) => ({
    ...pointer,
    exists: await stat(pointer.evidence).then(
      () => true,
      () => false,
    ),
  })),
);
await mkdir(resolve(output));
await writeFile(
  join(resolve(output), 'results.json'),
  `${JSON.stringify({ verdict: 'PARTIAL MECHANISTIC AUDIT', header, entries, toolCalls, rows, unresolved: rows.filter((row) => !row.exists).map(({ line }) => line), unmatched: rows.filter((row) => !row.mentions.length).map(({ line }) => line), scope: 'Current workspace transcript only. Validated row structure and evidence existence; non-read tool argument mentions are candidates, not proof an artifact supports its claim. This does not audit substantive truth, isolate run stretches, or substitute for independent cross-model review. No workflows enforced.' }, null, 2)}\n`,
);
