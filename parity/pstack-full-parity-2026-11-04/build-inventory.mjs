import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const [evidenceArg, destinationArg] = process.argv.slice(2);
if (!evidenceArg || !destinationArg) throw new Error('Usage: node build-inventory.mjs <reference-evidence-directory> <destination-directory>');
const evidence = resolve(evidenceArg);
const destination = resolve(destinationArg);
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sources = readJson(join(evidence, 'sources.json'));
const host = readJson(join(evidence, 'host-modules.json'));
const archive = join(evidence, `plugins-${sources.revision}`);
assert.equal(sha256(readFileSync(join(evidence, 'plugins.tar.gz'))), '851e9bff58322f9b470ace1e8ddedfe633505fcbea9df9b7c62225b8950f7b20');
for (const source of sources.sources) assert.equal(sha256(readFileSync(join(archive, source.file))), source.sha256, source.file);
assert.equal(sources.sources.filter((source) => source.installedMatch === false).length, 0);
const component = (name, relationship) => ({
  name,
  version: readJson(join(archive, name, '.cursor-plugin/plugin.json')).version,
  relationship,
});
mkdirSync(destination, { recursive: true });
const jsonl = (name, records) => writeFileSync(join(destination, name), `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
jsonl('source-inventory.jsonl', sources.sources);
jsonl(
  'dependency-candidates.jsonl',
  sources.dependencyCandidates.map((edge) => ({ id: `DEPENDENCY:${sha256(`${edge.file}\0${edge.line}\0${edge.column}\0${edge.target}`).slice(0, 20)}`, ...edge })),
);
jsonl('host-modules.jsonl', host.modules);
const pi = join(homedir(), '.pi/agent/install/releases/1.5.0/node_modules/@earendil-works/pi-coding-agent');
const piFiles = ['docs/extensions.md', 'docs/rpc.md', 'docs/sdk.md', 'docs/skills.md', 'dist/core/extensions/types.d.ts', 'dist/core/extensions/runner.js', 'dist/core/agent-session.js'];
const baseline = {
  verdict: 'NOT VERIFIED',
  startingImplementationRevision: '0ab0b0c97699fafa31e462aecf8f3a5fdf3154ab',
  target: { repository: 'https://github.com/cursor/plugins', revision: 'ae5650febf4320793844c12c4adaa937f417f8da', version: '0.15.36', selection: 'Actual installed plugin cache, not the older local source checkout' },
  archive: {
    revision: sources.revision,
    sha256: sha256(readFileSync(join(evidence, 'plugins.tar.gz'))),
    comparison: 'upstream-comparison.json',
    targetRelationship: 'The captured comparison and file hashes show unchanged pstack content between installed target and downloaded archive.',
  },
  components: [component('pstack', 'target'), component('cursor-team-kit', 'soft dependency named by pstack'), component('cursor-sdk', 'candidate examined, dependency relationship not established')],
  cursor: { cliVersion: host.cliVersion, desktop: 'not installed on this host', hostedServices: 'not exercised', unavailableChunks: host.unavailableChunks },
  pi: { version: readJson(join(pi, 'package.json')).version, apiEvidence: piFiles.map((file) => ({ file, sha256: sha256(readFileSync(join(pi, file))) })) },
  dependencies: [
    {
      name: 're2js',
      version: '1.2.2',
      evidence: 'Cursor index.js.LICENSE.txt identifies version v1.2.2. The extracted local-exec observer uses its embedded RE2JS implementation.',
      archiveSha256: sha256(readFileSync(join(evidence, 're2js/package.tgz'))),
      registry: readJson(join(evidence, 're2js/registry.json')).dist,
      transitives: 'The published package manifest declares no runtime dependencies.',
    },
    { name: 'commander', version: '14.0.0', evidence: 'pstack/skills/poteto-mode/scripts/package.json and bun.lock', semanticReview: 'pending' },
    { name: 'fast-check', version: '4.5.3', evidence: 'pstack/skills/statechart/scripts/package.json', semanticReview: 'pending' },
    { name: 'bun-types', version: '1.3.14', evidence: 'pstack/skills/poteto-mode/scripts/bun.lock resolves the manifest latest declaration', semanticReview: 'pending' },
    { name: 'typescript', version: '7.0.2', evidence: 'pstack/skills/poteto-mode/scripts/bun.lock resolves the manifest latest declaration', semanticReview: 'pending' },
    { name: '@types/node', version: '26.1.2', evidence: 'pstack/skills/poteto-mode/scripts/bun.lock', semanticReview: 'pending' },
    { name: 'undici-types', version: '8.3.0', evidence: 'pstack/skills/poteto-mode/scripts/bun.lock', semanticReview: 'pending' },
  ],
  counts: { capturedSourceFiles: sources.sources.length, dependencyCandidates: sources.dependencyCandidates.length, capturedHostFactories: host.modules.length },
  completeness: { dependencyClosureComplete: false, behavioralInventoryComplete: false, originalWorkflowCoverageComplete: false, nativeParityComplete: false, countsAreCoverage: false },
  processConstraint: { workAloneSatisfied: false, breach: 'A mistaken cursor agent status command launched another LLM. Its response is excluded from evidence and reviews.' },
};
writeFileSync(join(destination, 'baseline.json'), `${JSON.stringify(baseline, null, 2)}\n`);
console.log(JSON.stringify(baseline.counts));
