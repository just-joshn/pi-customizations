#!/usr/bin/env node
// Derives every requirement's status from a Vitest JSON report and writes generated/parity-manifest.json and the
// generated section of docs/parity-status.md. Status is never taken from the requirements source.
//   node scripts/build-parity-manifest.mjs                 runs `npx vitest run --reporter=json` first
//   node scripts/build-parity-manifest.mjs --results r.json  uses a report you already have
//   node scripts/build-parity-manifest.mjs --results local.json --results ci.json  merges several reports per test
// A report with a sibling <name>.identity.json (platform, commit, sourceDigest, runUrl) is a CI result recorded elsewhere.
// A report without one is attributed to this checkout and this host.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { buildRecords, evaluate, loadInputs, renderStatusSection, requirementsDigest, runIdentity, sidecarIdentity, spliceStatusSection, tally } from './parity-lib.mjs';

const { values } = parseArgs({ options: { root: { type: 'string' }, results: { type: 'string', multiple: true }, out: { type: 'string' }, docs: { type: 'string' }, 'no-docs': { type: 'boolean' } } });
const root = resolve(values.root ?? join(dirname(fileURLToPath(import.meta.url)), '..'));

const inputs = loadInputs(root);
const { records, problems } = buildRecords(root, inputs);
if (problems.length) {
  for (const p of problems) console.error(p);
  console.error(`parity manifest: ${problems.length} problem(s) in the requirements; nothing written`);
  process.exit(1);
}

const loaded = [];
const resultFiles = (values.results ?? []).map((p) => resolve(p));
if (!resultFiles.length) {
  const temp = mkdtempSync(join(tmpdir(), 'pstack-vitest-'));
  const path = join(temp, 'report.json');
  spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${path}`], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  if (!existsSync(path)) {
    console.error('parity manifest: the Vitest run wrote no JSON report; nothing written');
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(path, 'utf8'));
  rmSync(temp, { recursive: true, force: true });
  loaded.push({ report, identity: runIdentity(root, report, 'vitest run') });
}
for (const path of resultFiles) {
  if (!existsSync(path)) {
    console.error(`parity manifest: ${path} does not exist; nothing written`);
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const sidecarPath = path.replace(/\.json$/, '.identity.json');
  if (!existsSync(sidecarPath)) {
    loaded.push({ report, identity: runIdentity(root, report, 'file') });
    continue;
  }
  const { identity, problem } = sidecarIdentity(JSON.parse(readFileSync(sidecarPath, 'utf8')));
  if (problem) {
    console.error(`parity manifest: ${sidecarPath}: ${problem}; nothing written`);
    process.exit(1);
  }
  loaded.push({ report, identity: runIdentity(root, report, 'ci', identity) });
}

const requirements = evaluate(records, loaded, root);
const manifest = {
  schemaVersion: 1,
  upstream: { repository: inputs.lock.repository, revision: inputs.lock.revision },
  requirementsDigest: requirementsDigest(inputs),
  run: loaded[0].identity,
  runs: loaded.map((l) => l.identity),
  counts: tally(requirements),
  requirements,
};
writeFileSync(resolve(root, values.out ?? 'generated/parity-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
if (!values['no-docs']) {
  const docsPath = resolve(root, values.docs ?? 'docs/parity-status.md');
  writeFileSync(docsPath, spliceStatusSection(readFileSync(docsPath, 'utf8'), renderStatusSection(manifest)));
}
console.log(JSON.stringify(manifest.counts));
