import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const [evidenceArg, destinationArg] = process.argv.slice(2);
if (!evidenceArg || !destinationArg) throw new Error('Usage: node fact-check.mjs <reference-evidence-directory> <output.json>');
const audit = resolve('parity/pstack-full-parity-2026-11-04');
const evidence = resolve(evidenceArg);
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const jsonl = (path) =>
  readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const baseline = json(join(audit, 'baseline.json'));
const sources = jsonl(join(audit, 'source-inventory.jsonl'));
const dependencies = jsonl(join(audit, 'dependency-candidates.jsonl'));
const modules = jsonl(join(audit, 'host-modules.jsonl'));
assert.equal(sources.length, baseline.counts.capturedSourceFiles);
assert.equal(dependencies.length, baseline.counts.dependencyCandidates);
assert.equal(modules.length, baseline.counts.capturedHostFactories);
for (const rows of [sources, dependencies, modules]) assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
assert.equal(sha256(readFileSync(join(evidence, 'plugins.tar.gz'))), baseline.archive.sha256);
const archive = join(evidence, `plugins-${baseline.archive.revision}`);
const installed = join(homedir(), '.cursor/plugins/cache/cursor-public/pstack', baseline.target.revision);
for (const source of sources) {
  assert.equal(sha256(readFileSync(join(archive, source.file))), source.sha256, source.file);
  if (source.file.startsWith('pstack/')) assert.equal(sha256(readFileSync(join(installed, source.file.slice('pstack/'.length)))), source.sha256, source.file);
}
const pi = join(homedir(), '.pi/agent/install/releases/1.5.0/node_modules/@earendil-works/pi-coding-agent');
for (const file of baseline.pi.apiEvidence) assert.equal(sha256(readFileSync(join(pi, file.file))), file.sha256, file.file);
const require = createRequire(resolve('extensions/pi-pstack/package.json'));
assert.equal(sha256(readFileSync(require.resolve('re2js'))), '230f725da3faab52ab1ea7efcfff1a4dc41e489d79015926a3269adb58544565');
assert.equal(json(join(evidence, 're2js/package/package.json')).dependencies, undefined);
const regex = baseline.dependencies.find((dependency) => dependency.name === 're2js');
assert.ok(regex);
assert.equal(sha256(readFileSync(join(evidence, 're2js/package.tgz'))), regex.archiveSha256);
assert.equal(
  `sha512-${createHash('sha512')
    .update(readFileSync(join(evidence, 're2js/package.tgz')))
    .digest('base64')}`,
  regex.registry.integrity,
);
const fixture = json(resolve('extensions/pi-pstack/test/fixtures/cursor-shell-monitor.json'));
const cases = [...fixture.cases, ...fixture.factoryCases];
assert.equal(new Set(cases.map((scenario) => scenario.id)).size, cases.length);
assert.equal(fixture.provenance.regexEngine, 're2js@1.2.2');
assert.equal(fixture.provenance.sourceRevision, baseline.target.revision);
assert.equal(baseline.verdict, 'NOT VERIFIED');
assert.equal(baseline.completeness.behavioralInventoryComplete, false);
assert.equal(baseline.completeness.dependencyClosureComplete, false);
assert.equal(baseline.completeness.nativeParityComplete, false);
assert.equal(baseline.processConstraint.workAloneSatisfied, false);
const changed = execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
assert.ok(changed.every((path) => path === 'bun.lock' || path.startsWith('extensions/pi-pstack/') || path.startsWith('parity/pstack-full-parity-2026-11-04/')));
const result = {
  verdict: 'VERIFIED',
  scope: 'Artifact identities, source counts, engine identity, change scope, and honesty of incomplete-status flags only. Not a whole-plugin parity verdict.',
  identities: { sourceFiles: sources.length, dependencyCandidates: dependencies.length, hostFactories: modules.length, monitorBehaviorIds: cases.length },
  positiveClaims: [
    'Pinned archive and installed pstack files match recorded source hashes.',
    'Inspected Pi API files match the recorded runtime hashes.',
    'Native and reference regex engines load the same identified CommonJS package bytes.',
    'The registry archive matches its SHA-256 and npm SHA-512 integrity.',
    'Tracked changes stay within pi-pstack, its lockfile, and this audit.',
  ],
  rejectedClaims: ['100% behavioral inventory', 'Closed transitive dependency graph', 'Whole-plugin behavioral parity', 'Live Cursor workflow comparison', 'Independent external review', 'Compliance with the no-other-LLM constraint'],
  limitations: [
    'Source and test counts are not behavioral coverage.',
    'Matching an isolated original component does not prove the whole host or hosted services.',
    'The three review passes are by the same assistant, using separate deterministic checks.',
  ],
};
writeFileSync(destinationArg, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
