#!/usr/bin/env node
// The release gate. Exits non-zero unless every mandatory requirement is PASS. It never reports a percentage.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { buildRecords, checkRuns, deriveStatus, loadInputs, mergeOutcomes, requirementsDigest, sourceDigest, sourceLabel } from './parity-lib.mjs';

const { values } = parseArgs({ options: { root: { type: 'string' }, manifest: { type: 'string' } } });
const root = resolve(values.root ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const manifestPath = resolve(root, values.manifest ?? 'generated/parity-manifest.json');
const problems = [];

const inputs = loadInputs(root);
const built = buildRecords(root, inputs);
problems.push(...built.problems);

let manifest = null;
if (!existsSync(manifestPath)) problems.push(`${manifestPath}: no parity manifest; run node scripts/build-parity-manifest.mjs`);
else {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.upstream?.revision !== inputs.lock.revision) problems.push(`manifest is for upstream ${manifest.upstream?.revision}, the lock is ${inputs.lock.revision}; rebuild it`);
  if (manifest.requirementsDigest !== requirementsDigest(inputs)) problems.push('manifest is stale: the requirements or the upstream lock changed since it was built; rebuild it');
  const have = new Set(manifest.requirements.map((r) => r.id));
  for (const r of built.records) if (!have.has(r.id)) problems.push(`${r.id}: requirement missing from the manifest; rebuild it`);
  for (const r of manifest.requirements) {
    for (const t of r.results ?? []) if (mergeOutcomes(r, t.byRun ?? []) !== t.outcome) problems.push(`${r.id}: ${t.file}::${t.name} is recorded as ${t.outcome} but its per-platform results merge to ${mergeOutcomes(r, t.byRun ?? [])}; the outcome was edited by hand`);
    const recomputed = deriveStatus(r, r.results ?? []);
    if (recomputed.status !== r.status) problems.push(`${r.id}: manifest says ${r.status} but its recorded test results derive ${recomputed.status}; the status was edited by hand`);
  }
  problems.push(...checkRuns(manifest, sourceDigest(root)));
}

const open = (manifest?.requirements ?? []).filter((r) => r.applicability.mandatory && r.status !== 'PASS');
const mandatory = (manifest?.requirements ?? []).filter((r) => r.applicability.mandatory);
for (const p of problems) console.error(p);
if (open.length) {
  console.error(`\n${open.length} mandatory requirement(s) are not PASS:`);
  for (const r of open) console.error(`  ${r.status.padEnd(12)} ${r.id}  [${sourceLabel(r)}]\n               ${r.reason}`);
}
const by = (s) => mandatory.filter((r) => r.status === s).length;
console.error(`\nrelease gate: ${open.length === 0 && problems.length === 0 ? 'OPEN' : 'CLOSED'} (${mandatory.length} mandatory: ${by('PASS')} PASS, ${by('FAIL')} FAIL, ${by('INCONCLUSIVE')} INCONCLUSIVE; ${problems.length} problem(s))`);
process.exit(open.length || problems.length ? 1 : 0);
