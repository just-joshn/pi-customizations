#!/usr/bin/env node
/**
 * Mutation control for the F-014 composite checks.
 *
 * Each entry in COMPOSITE_MUTATIONS breaks exactly the behaviour its target
 * row claims, in an isolated copy of the package source. The probe drives real
 * Pi against that copy and asserts that the targeted checks fail while the
 * others still pass. That is the failing-before side of the composite
 * verification: a check that no mutation can turn red observes nothing.
 *
 * It writes evidence only. It never writes a receipt, so a mutant run cannot
 * leave a `failed` receipt that would outrank the production drive.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCompositeSession } from '../scenarios/lib/pi-tui-skin-composite-drive.mjs';
import { COMPOSITE_CHECKS, COMPOSITE_MUTATIONS } from '../scenarios/pi-tui-skin-composite.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const EVIDENCE_DIR = join(REPO_ROOT, 'artifacts/user-perspective/pi-tui-skin-composite-mutations');

function evaluate(observations) {
  return new Map(
    COMPOSITE_CHECKS.map((check) => {
      const result = check.run(observations);
      return [check.surfaceId, result];
    }),
  );
}

mkdirSync(EVIDENCE_DIR, { recursive: true });
const report = [];
let failures = 0;
for (const mutation of COMPOSITE_MUTATIONS) {
  const rawDir = join(EVIDENCE_DIR, 'raw', mutation.name);
  let results = new Map();
  let driveError = null;
  try {
    const observations = runCompositeSession({ repoRoot: REPO_ROOT, rawDir, mutate: mutation.apply });
    results = evaluate(observations);
  } catch (error) {
    driveError = error instanceof Error ? error.message : String(error);
  }
  const failed = [...results.entries()].filter(([, result]) => !result.ok).map(([surfaceId]) => surfaceId);
  const missing = mutation.expectFailed.filter((surfaceId) => !failed.includes(surfaceId));
  const unexpected = failed.filter((surfaceId) => !mutation.expectFailed.includes(surfaceId));
  const ok = driveError === null && missing.length === 0 && unexpected.length === 0;
  if (!ok) failures += 1;
  report.push({
    mutation: mutation.name,
    expectFailed: mutation.expectFailed,
    failed,
    missing,
    unexpected,
    driveError,
    ok,
    details: Object.fromEntries([...results.entries()].map(([surfaceId, result]) => [surfaceId, result.detail])),
  });
  process.stdout.write(`${ok ? '✓' : '✗'} ${mutation.name}: failed ${JSON.stringify(failed)} expected ${JSON.stringify(mutation.expectFailed)}${driveError === null ? '' : ` driveError ${JSON.stringify(driveError)}`}\n`);
  for (const [surfaceId, result] of results.entries()) {
    if (!result.ok) process.stdout.write(`    ${surfaceId}: ${result.detail}\n`);
  }
}

writeFileSync(join(EVIDENCE_DIR, 'mutations.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`mutation control: ${COMPOSITE_MUTATIONS.length - failures}/${COMPOSITE_MUTATIONS.length} mutants behaved as targeted\n`);
if (failures > 0) process.exitCode = 1;
