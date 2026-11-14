#!/usr/bin/env node
// The release gate. Exits non-zero unless every mandatory requirement is PASS. It never reports a percentage.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { buildRecords, checkRuns, deriveStatus, loadInputs, mergeOutcomes, requirementsDigest, sourceDigest, sourceLabel, toolchain, toolchainNotes } from './parity-lib.mjs';
import { evaluateZip } from './zip-contract.mjs';

const { values } = parseArgs({ options: { root: { type: 'string' }, manifest: { type: 'string' }, 'zip-evidence': { type: 'string' } } });
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
  const definitions = new Map(built.records.map((r) => [r.id, r]));
  for (const r of manifest.requirements) {
    const { results, status, reason, ...definition } = r;
    if (JSON.stringify(definition) !== JSON.stringify(definitions.get(r.id))) problems.push(`${r.id}: requirement definition was edited by hand; rebuild it`);
    for (const t of r.results ?? [])
      if (mergeOutcomes(r, t.byRun ?? []) !== t.outcome) problems.push(`${r.id}: ${t.file}::${t.name} is recorded as ${t.outcome} but its per-platform results merge to ${mergeOutcomes(r, t.byRun ?? [])}; the outcome was edited by hand`);
    const recomputed = deriveStatus(r, r.results ?? []);
    if (recomputed.status !== r.status) problems.push(`${r.id}: manifest says ${r.status} but its recorded test results derive ${recomputed.status}; the status was edited by hand`);
  }
  problems.push(...checkRuns(manifest, sourceDigest(root)));
}

const open = (manifest?.requirements ?? []).filter((r) => r.applicability.mandatory && r.status !== 'PASS');
const mandatory = (manifest?.requirements ?? []).filter((r) => r.applicability.mandatory);
for (const note of toolchainNotes(manifest?.runs ?? [])) console.error(note);
if (open.length) {
  console.error(`\n${open.length} mandatory requirement(s) are not PASS:`);
  for (const r of open) console.error(`  ${r.status.padEnd(12)} ${r.id}  [${sourceLabel(r)}]\n               ${r.reason}`);
}
const zip = evaluateZip(root, inputs, values['zip-evidence'] ?? manifest?.zip?.evidence?.path ?? null, toolchain().piVersion);
if (manifest?.zip && JSON.stringify(manifest.zip) !== JSON.stringify(zip)) problems.push('ZIP: manifest acceptance was edited or its evidence is stale; rebuild it');
for (const p of problems) console.error(p);
for (const problem of zip.problems) console.error(problem);
for (const r of zip.requirements.filter((r) => r.status !== 'PASS')) console.error(`  ZIP ${r.status} ${r.id} [${r.source?.document}:${r.source?.lines?.join('-')}] ${r.reason}`);
const released = open.length === 0 && problems.length === 0 && zip.status === 'ACCEPTED';
console.log(JSON.stringify({ release: released ? 'RELEASED' : 'NOT RELEASED', legacyGate: open.length || problems.length ? 'CLOSED' : 'OPEN', zip }));
const by = (s) => mandatory.filter((r) => r.status === s).length;
console.error(`\nrelease gate: ${open.length === 0 && problems.length === 0 ? 'OPEN' : 'CLOSED'} (${mandatory.length} mandatory: ${by('PASS')} PASS, ${by('FAIL')} FAIL, ${by('INCONCLUSIVE')} INCONCLUSIVE; ${problems.length} problem(s))`);
console.error(`ZIP acceptance: ${zip.status}; release: ${released ? 'RELEASED' : 'NOT RELEASED'}`);
process.exit(released ? 0 : 1);
