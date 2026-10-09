#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evidence', 'verify-out.txt');
const { add } = await import(pathToFileURL(join(root, 'src', 'add.js')).href);
const value = add(2, 3);
const ok = value === 5;
const line = ok ? `ADD-OK value=${value}` : `ADD-FAIL value=${value} expected=5`;
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
