#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evidence', 'verify-out.txt');

const boardUrl = `${pathToFileURL(join(root, 'src', 'board.js')).href}?t=${Date.now()}`;
const { enqueue, claim, complete, snapshot } = await import(boardUrl);

let error = null;
let ok = false;
let detail = '';

try {
  const idA = enqueue({ kind: 'a' });
  const idB = enqueue({ kind: 'b' });
  if (typeof idA !== 'string' && typeof idA !== 'number') {
    throw new Error(`enqueue returned non-id: ${JSON.stringify(idA)}`);
  }
  if (idA === idB) throw new Error('enqueue returned duplicate ids');

  const first = claim();
  const second = claim();
  const third = claim();
  if (!first || !second) throw new Error('claim returned null too early');
  if (first.id === second.id) throw new Error('two claimers received the same job');
  if (third !== null) throw new Error('claim should return null when empty');

  const claimed = new Set([first.id, second.id]);
  if (!claimed.has(idA) || !claimed.has(idB)) {
    throw new Error('claimed ids do not match enqueued ids');
  }
  if (first.status !== 'pending' || second.status !== 'pending') {
    throw new Error('claimed job status must be pending');
  }
  if (!('payload' in first) || !('payload' in second)) {
    throw new Error('job record missing payload');
  }

  complete(first.id);
  complete(second.id);
  const after = snapshot();
  if (!Array.isArray(after) || after.length !== 2) {
    throw new Error(`snapshot length expected 2, got ${after?.length}`);
  }
  if (!after.every((j) => j.status === 'done')) {
    throw new Error('jobs should be done after complete');
  }
  ok = true;
  detail = `jobs=${after.length}`;
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
}

const line = ok
  ? `BOARD-OK ${detail}`
  : `BOARD-FAIL error=${error ?? 'none'}`;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
