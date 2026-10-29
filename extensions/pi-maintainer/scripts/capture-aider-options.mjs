#!/usr/bin/env node
// Captures every long option Aider's parser defines at the pinned commit (`aider/args.py`)
// and fails when parity/options.json has no disposition for one. Run:
//   node scripts/capture-aider-options.mjs          check the inventory against the checkout
//   node scripts/capture-aider-options.mjs --write  refresh parity/options.aider.json first
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sources = JSON.parse(readFileSync(join(packageRoot, 'parity/sources.json'), 'utf8'));
const checkout = resolve(process.env.AIDER_CHECKOUT ?? sources.aider.checkout);
const argsSource = readFileSync(join(checkout, 'aider/args.py'), 'utf8');

const options = [...new Set([...argsSource.matchAll(/add_argument\(\s*["'](--[a-z0-9-]+)["']/g)].map((match) => match[1]))].sort();
const captured = { aiderCommit: sources.aider.commit, options };
const capturedPath = join(packageRoot, 'parity/options.aider.json');

if (process.argv.includes('--write')) {
  writeFileSync(capturedPath, `${JSON.stringify(captured, null, 2)}\n`);
  process.stdout.write(`wrote ${capturedPath} (${options.length} options)\n`);
}

let commit;
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
} catch (error) {
  process.stderr.write(`cannot read the Aider checkout at ${checkout}: ${error.message}\n`);
  process.exit(1);
}
if (commit !== sources.aider.commit) {
  process.stderr.write(`Aider checkout is at ${commit}, not the pinned ${sources.aider.commit}\n`);
  process.exit(1);
}

const inventory = JSON.parse(readFileSync(join(packageRoot, 'parity/options.json'), 'utf8')).options;
const uncovered = options.filter((option) => inventory[option] === undefined);
const extra = Object.keys(inventory).filter((option) => !options.includes(option));
for (const option of uncovered) process.stderr.write(`FAIL ${option} has no disposition in parity/options.json\n`);
for (const option of extra) process.stderr.write(`FAIL ${option} is not an Aider option at ${sources.aider.commit}\n`);
if (uncovered.length || extra.length) process.exit(1);
process.stdout.write(`${options.length} Aider options, all disposed\n`);
