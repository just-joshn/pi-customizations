#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compilerOptionsText } from './typescript-policy.mjs';

if (process.argv.slice(2).some((arg) => arg !== '--write')) throw new Error('Usage: sync-typescript-policy.mjs [--write]');
const root = fileURLToPath(new URL('..', import.meta.url));
const target = join(root, 'extensions/pi-pstack/tsconfig.policy.json');
const authority = compilerOptionsText(await readFile(join(root, 'tsconfig.json'), 'utf8'));
const output = execFileSync(join(root, 'node_modules/.bin/biome'), ['format', '--stdin-file-path', target], { cwd: root, input: `{\n"compilerOptions": ${authority}\n}\n`, encoding: 'utf8' });
if (process.argv.includes('--write')) {
  await writeFile(target, output);
  process.stdout.write('Projected root compiler policy for the standalone pi-pstack package.\n');
} else if ((await readFile(target, 'utf8')) !== output) {
  throw new Error('Standalone package compiler policy differs from root. Run bun run sync:types-policy.');
} else {
  process.stdout.write('Standalone package compiler policy matches root.\n');
}
