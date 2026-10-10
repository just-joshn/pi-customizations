#!/usr/bin/env node
// Runs oracle cases through Aider's own Python at the pinned checkout and writes the goldens
// the TypeScript tests compare against.
// Usage: node scripts/capture-oracle.mjs [area ...] [--check]
//   area     a name such as editblock, matching test/oracle/<area>.cases.json; default all
//   --check  fail when a committed golden differs from a fresh oracle run instead of writing it
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { aiderCheckout } from './census.mjs';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sources = JSON.parse(readFileSync(join(packageRoot, 'parity/sources.json'), 'utf8'));
const oracleDir = join(packageRoot, 'test/oracle');
const args = process.argv.slice(2);
const check = args.includes('--check');
const requested = args.filter((arg) => !arg.startsWith('--'));

const head = execFileSync('git', ['-C', aiderCheckout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (head !== sources.aider.commit) {
  process.stderr.write(`Aider checkout ${aiderCheckout} is at ${head}, the oracle pins ${sources.aider.commit}\n`);
  process.exit(1);
}

const areas = requested.length > 0 ? requested : readdirSync(oracleDir).flatMap((name) => (name.endsWith('.cases.json') ? [name.slice(0, -'.cases.json'.length)] : []));
const env = {
  ...process.env,
  PYTHONPATH: [aiderCheckout, join(packageRoot, 'parity/oracle')].join(':'),
  PYTHONDONTWRITEBYTECODE: '1',
  PYTHONHASHSEED: '0',
  AIDER_ANALYTICS: 'false',
  LITELLM_LOCAL_MODEL_COST_MAP: 'True',
};
const drifted = [];
for (const area of areas) {
  const cases = join(oracleDir, `${area}.cases.json`);
  const goldenPath = join(oracleDir, `${area}.golden.json`);
  const output = execFileSync(join(aiderCheckout, sources.aider.python), [join(packageRoot, 'parity/oracle/aider_oracle.py'), cases], { env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (check) {
    let committed = '';
    try {
      committed = readFileSync(goldenPath, 'utf8');
    } catch {
      committed = '';
    }
    if (committed !== output) drifted.push(area);
    process.stdout.write(`${committed === output ? 'FRESH' : 'DRIFT'} ${area}\n`);
  } else {
    writeFileSync(goldenPath, output);
    process.stdout.write(`wrote ${goldenPath}\n`);
  }
}
if (drifted.length > 0) {
  process.stderr.write(`goldens differ from the oracle: ${drifted.join(', ')}\n`);
  process.exit(1);
}
