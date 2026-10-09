import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRounds } from '../src/run.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const counts = runRounds(30);
const line = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ');
await mkdir(join(root, 'evidence'), { recursive: true });
await writeFile(join(root, 'evidence', 'census-out.txt'), `${line}\n`);
console.log(line);
