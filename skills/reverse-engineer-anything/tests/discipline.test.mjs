import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { absenceClaimAllowed, auditEvidence, isWithinTarget, unresolvedCitations } from '../scripts/lib/discipline.mjs';
import { coverage } from '../scripts/lib/envelope.mjs';
import { analyzeJavaScriptApplication } from '../scripts/lib/formats/javascript.mjs';
import { openDirectorySource } from '../scripts/lib/formats/target-source.mjs';
import { describeSubject } from '../scripts/lib/target.mjs';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../scripts/rea.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('../../../parity/reverse-engineer-anything/fixtures/targets/notepad-app', import.meta.url));

const cleanRecord = {
  evidence_id: `ev_${'a'.repeat(64)}`,
  operation: 'analyze_javascript_application',
  authority: 'shipped-artifact',
  environment: null,
  limitations: ['Static analysis only.'],
  evidence_links: [],
  normalized_result: {
    graph: {
      coverage: coverage({ status: 'partial' }),
      nodes: [
        {
          kind: 'javascript-asset',
          observations: [
            {
              label: 'main.js',
              properties: { path: 'main.js' },
              evidence: {
                authority: 'artifact-bytes',
                state: 'observed',
                confidence: 'exact',
                coverage: coverage({ status: 'complete' }),
                limitations: ['Read as bytes only.'],
                evidence_ids: [],
              },
            },
          ],
        },
      ],
    },
  },
};

test('DISC-001: a finding without evidence cannot be reported as observed', () => {
  assert.deepEqual(auditEvidence([cleanRecord]), []);
  const bad = structuredClone(cleanRecord);
  bad.normalized_result.graph.nodes[0].observations[0].evidence.state = 'observed';
  bad.normalized_result.graph.nodes[0].observations[0].evidence.authority = 'static-relationship-inference';
  const violations = auditEvidence([bad]);
  assert.ok(violations.some((violation) => violation.rule === 'observed-without-observing-authority'));
  const noLimitations = structuredClone(cleanRecord);
  noLimitations.normalized_result.graph.nodes[0].observations[0].evidence.limitations = [];
  assert.ok(auditEvidence([noLimitations]).some((violation) => violation.rule === 'observation-limitations-missing'));
  const truncated = structuredClone(cleanRecord);
  truncated.normalized_result.graph.nodes[0].observations[0].evidence.coverage = { status: 'partial', truncated: true, omitted_count: null, limits: [] };
  assert.ok(auditEvidence([truncated]).some((violation) => violation.rule === 'truncated-without-count'));
});

test('DISC-002: execution claims require a runtime record', () => {
  const claiming = structuredClone(cleanRecord);
  claiming.normalized_result.executed = true;
  const violations = auditEvidence([claiming]);
  assert.ok(
    violations.some((violation) => violation.rule === 'execution-claim-without-runtime'),
    'a static record may not claim execution',
  );
  const runtime = structuredClone(claiming);
  runtime.authority = 'runtime-observation';
  runtime.environment = { host: 'local' };
  assert.deepEqual(
    auditEvidence([runtime]).filter((violation) => violation.rule === 'execution-claim-without-runtime'),
    [],
  );
});

test('DISC-003: bundle resolves every cited evidence id', () => {
  const bundle = { records: [cleanRecord] };
  assert.deepEqual(unresolvedCitations(bundle), []);
  const broken = structuredClone(bundle);
  broken.records[0].evidence_links = [`ev_${'f'.repeat(64)}`];
  assert.deepEqual(unresolvedCitations(broken), [{ from: cleanRecord.evidence_id, missing: `ev_${'f'.repeat(64)}` }]);
});

test('DISC-004: paths outside the target are refused', async (t) => {
  assert.equal(isWithinTarget('/target/app', '/target/app/src/main.js'), true);
  assert.equal(isWithinTarget('/target/app', '/target/other.js'), false);
  const root = mkdtempSync(join(tmpdir(), 'rea-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'scoped', main: 'src/main.js' }));
  writeFileSync(join(root, 'src/main.js'), 'module.exports = 1;');
  try {
    symlinkSync('/etc/passwd', join(root, 'escape.js'));
  } catch (error) {
    t.diagnostic(`symlink scope check skipped on this host: ${error instanceof Error ? error.message : String(error)}`);
  }
  const subject = await describeSubject(root);
  const source = await openDirectorySource(root);
  const result = await analyzeJavaScriptApplication({ source, subject });
  const paths = result.graph.nodes.flatMap((node) => node.observations.map((observation) => observation.properties?.path)).filter(Boolean);
  assert.ok(!paths.includes('escape.js'), 'a symlink out of the target is not followed');
  assert.ok(paths.every((path) => isWithinTarget(root, join(root, path))));
});

test('DISC-005: absence is only claimable inside complete coverage', () => {
  assert.equal(absenceClaimAllowed(cleanRecord), false);
  const complete = structuredClone(cleanRecord);
  complete.normalized_result.graph.coverage = coverage({ status: 'complete' });
  assert.equal(absenceClaimAllowed(complete), true);
});

test('DISC-006: the analyzer output passes its own discipline audit', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rea-disc-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { stdout } = await run(process.execPath, [cli, 'analyze-javascript-application', fixture, '--store', join(root, '.rea'), '--json']);
  const envelope = JSON.parse(stdout);
  const violations = auditEvidence([envelope]);
  assert.deepEqual(violations, [], `the analyzer must not violate its own discipline rules: ${JSON.stringify(violations[0] ?? {})}`);
});

test('DISC-007: the discipline audit is reachable from the CLI', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rea-audit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = `--store=${join(root, '.rea')}`;
  await run(process.execPath, [cli, 'analyze-javascript-application', fixture, store, '--json']);
  const { stdout } = await run(process.execPath, [cli, 'discipline-audit', store, '--json']);
  const audit = JSON.parse(stdout);
  assert.equal(audit.evidence_count, 1);
  assert.deepEqual(audit.violations, []);
  assert.deepEqual(audit.unresolved_citations, []);
  assert.equal(audit.absence_claims_allowed.length, 0, 'a partial analysis may not support an absence claim');
});
