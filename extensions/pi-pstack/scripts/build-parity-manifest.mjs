#!/usr/bin/env node
// Derives every requirement's status from a Vitest JSON report and writes generated/parity-manifest.json and the
// generated section of docs/parity-status.md. Status is never taken from the requirements source.
//   node scripts/build-parity-manifest.mjs                 runs `npx vitest run --reporter=json` first
//   node scripts/build-parity-manifest.mjs --results r.json  uses a report you already have
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { buildRecords, evaluate, loadInputs, renderStatusSection, requirementsDigest, runIdentity, spliceStatusSection, tally } from './parity-lib.mjs';

const { values } = parseArgs({ options: { root: { type: 'string' }, results: { type: 'string' }, out: { type: 'string' }, docs: { type: 'string' }, 'no-docs': { type: 'boolean' } } });
const root = resolve(values.root ?? join(dirname(fileURLToPath(import.meta.url)), '..'));

const inputs = loadInputs(root);
const { records, problems } = buildRecords(root, inputs);
if (problems.length) {
  for (const p of problems) console.error(p);
  console.error(`parity manifest: ${problems.length} problem(s) in the requirements; nothing written`);
  process.exit(1);
}

let resultsPath = values.results && resolve(values.results);
let temp;
if (!resultsPath) {
  temp = mkdtempSync(join(tmpdir(), 'pstack-vitest-'));
  resultsPath = join(temp, 'report.json');
  spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${resultsPath}`], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
}
if (!existsSync(resultsPath)) {
  console.error('parity manifest: the Vitest run wrote no JSON report; nothing written');
  process.exit(1);
}
const report = JSON.parse(readFileSync(resultsPath, 'utf8'));
if (temp) rmSync(temp, { recursive: true, force: true });

const requirements = evaluate(records, report, root);
const manifest = {
  schemaVersion: 1,
  upstream: { repository: inputs.lock.repository, revision: inputs.lock.revision },
  requirementsDigest: requirementsDigest(inputs),
  run: runIdentity(root, report, values.results ? 'file' : 'vitest run'),
  counts: tally(requirements),
  requirements,
};
writeFileSync(resolve(root, values.out ?? 'generated/parity-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
if (!values['no-docs']) {
  const docsPath = resolve(root, values.docs ?? 'docs/parity-status.md');
  writeFileSync(docsPath, spliceStatusSection(readFileSync(docsPath, 'utf8'), renderStatusSection(manifest)));
}
console.log(JSON.stringify(manifest.counts));
