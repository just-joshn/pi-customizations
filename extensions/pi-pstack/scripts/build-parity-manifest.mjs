#!/usr/bin/env node
// Derives legacy statuses from Vitest and evaluates the separate ZIP experiment receipts. Writes generated/parity-manifest.json
// and the generated section of docs/parity-status.md. Missing ZIP evidence retains explicit unresolved verdicts.
//   node scripts/build-parity-manifest.mjs                 runs `npx vitest run --reporter=json` first
//   node scripts/build-parity-manifest.mjs --save parity-results/local/vitest-darwin.json   runs Vitest and keeps the report and its sidecar
//   node scripts/build-parity-manifest.mjs --results r.json  uses a report you already have
//   node scripts/build-parity-manifest.mjs --results local.json --results ci.json  merges several reports per test
// A report with a sibling <name>.identity.json is attributed to what that file says: a CI result (platform, commit, sourceDigest,
// runUrl, root) or a local one (resultsSource "local", with the commit, dirty flag and sourceDigest taken around its own run).
// A report without one has no known commit, platform or digest, so the release gate stays closed until it is rerun with --save.
// A run is accepted when Vitest exits 0, or 1 with a complete report whose failures then close the gate; the checkout's source digest
// must be the same before and after it, and a dirty tree is recorded so the gate rejects it.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  absentLinkedTests,
  buildRecords,
  evaluate,
  loadInputs,
  renderStatusSection,
  requirementsDigest,
  runIdentity,
  sidecarIdentity,
  sourceState,
  spliceStatusSection,
  tally,
  toolchain,
  UNATTRIBUTED,
  vitestRunOutcome,
} from './parity-lib.mjs';
import { evaluateZip } from './zip-contract.mjs';

const { values } = parseArgs({
  options: { root: { type: 'string' }, results: { type: 'string', multiple: true }, save: { type: 'string' }, out: { type: 'string' }, docs: { type: 'string' }, 'zip-evidence': { type: 'string' }, 'no-docs': { type: 'boolean' } },
});
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
if (!resultFiles.length || values.save) {
  const temp = mkdtempSync(join(tmpdir(), 'pstack-vitest-'));
  const path = join(temp, 'report.json');
  const before = sourceState(root);
  const run = spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${path}`], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const reportText = existsSync(path) ? readFileSync(path, 'utf8') : null;
  rmSync(temp, { recursive: true, force: true });
  const { report, problem } = vitestRunOutcome(run, reportText);
  if (problem) {
    console.error(`parity manifest: ${problem}; nothing written`);
    process.exit(1);
  }
  const after = sourceState(root);
  if (before.sourceDigest !== after.sourceDigest || before.commit !== after.commit) {
    console.error('parity manifest: the code changed while Vitest ran, so the report cannot be attributed to one revision; nothing written');
    process.exit(1);
  }
  const appeared = (after.changes ?? []).filter((path) => !(before.changes ?? []).includes(path));
  if (before.changes === null || after.changes === null || appeared.length) {
    console.error(`parity manifest: ${appeared.length ? `files changed while Vitest ran (${appeared.join(', ')})` : 'git status failed'}, so the report cannot be attributed to the committed tree; nothing written`);
    process.exit(1);
  }
  const identity = runIdentity(root, report, 'local', { root, commit: before.commit, dirty: before.dirty, sourceDigest: before.sourceDigest, ...toolchain() });
  if (values.save) {
    const target = resolve(values.save);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, reportText);
    const { platform, commit, dirty, sourceDigest, piPath, piVersion, nodeVersion } = identity;
    writeFileSync(target.replace(/\.json$/, '.identity.json'), `${JSON.stringify({ resultsSource: 'local', root, platform, commit, dirty, sourceDigest, piPath, piVersion, nodeVersion }, null, 2)}\n`);
  }
  loaded.push({ report, identity });
}
for (const path of resultFiles) {
  if (!existsSync(path)) {
    console.error(`parity manifest: ${path} does not exist; nothing written`);
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const sidecarPath = path.replace(/\.json$/, '.identity.json');
  if (!existsSync(sidecarPath)) {
    loaded.push({ report, identity: runIdentity(root, report, 'file', UNATTRIBUTED) });
    continue;
  }
  const { identity, problem } = sidecarIdentity(JSON.parse(readFileSync(sidecarPath, 'utf8')));
  if (problem) {
    console.error(`parity manifest: ${sidecarPath}: ${problem}; nothing written`);
    process.exit(1);
  }
  loaded.push({ report, identity: runIdentity(root, report, identity.resultsSource ?? 'ci', { dirty: false, ...identity }) });
}

const stale = absentLinkedTests(records, loaded, root);
if (stale.length) {
  for (const p of stale) console.error(p);
  console.error(`parity manifest: ${stale.length} linked test(s) are not in the suite; nothing written`);
  process.exit(1);
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
  zip: evaluateZip(root, inputs, values['zip-evidence'] ?? null, toolchain().piVersion),
};
writeFileSync(resolve(root, values.out ?? 'generated/parity-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
if (!values['no-docs']) {
  const docsPath = resolve(root, values.docs ?? 'docs/parity-status.md');
  writeFileSync(docsPath, spliceStatusSection(readFileSync(docsPath, 'utf8'), renderStatusSection(manifest)));
}
console.log(JSON.stringify(manifest.counts));
