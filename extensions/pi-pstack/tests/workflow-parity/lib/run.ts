// One family, one driver: run it, evaluate its checker, and for the scripted driver prove each negative case fails.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Family } from '../families/types.ts';
import { type CheckResult, evaluate, failed, table, validateSources } from './check.ts';
import { REAL_MODEL, runWorkflow } from './driver.ts';
import { withCopy } from './mutate.ts';

export interface NegativeResult {
  name: string;
  expected: string[];
  failedChecks: string[];
  detected: boolean;
}

export interface FamilyRun {
  family: string;
  driver: 'scripted' | 'real';
  results: CheckResult[];
  negatives: NegativeResult[];
  sandbox: string;
  tmuxSocket: string;
  timedOut: boolean;
  piStderr: string;
  cleanup: () => void;
}

export async function runFamily(family: Family, driver: 'scripted' | 'real'): Promise<FamilyRun> {
  validateSources(family.checks);
  const outcome = await runWorkflow(family.spec, driver);
  const results = evaluate(family.checks, outcome.view);
  const negatives = driver === 'scripted' ? family.negatives.map((negative) => runNegative(family, negative, outcome.sandbox)) : [];
  return { family: family.id, driver, results, negatives, sandbox: outcome.sandbox, tmuxSocket: outcome.meta.tmuxSocket, timedOut: outcome.meta.timedOut, piStderr: outcome.meta.piStderr, cleanup: outcome.cleanup };
}

function runNegative(family: Family, negative: Family['negatives'][number], sandbox: string): NegativeResult {
  const failedChecks = withCopy(sandbox, negative.mutate, (view) => failed(evaluate(family.checks, view)));
  return { name: negative.name, expected: negative.fails, failedChecks, detected: negative.fails.every((id) => failedChecks.includes(id)) };
}

export function report(run: FamilyRun): string {
  const lines = [table(run.family, run.driver, run.results)];
  if (run.negatives.length > 0) {
    lines.push(`-- negative cases for ${run.family}`);
    for (const negative of run.negatives) lines.push(`${negative.detected ? 'DETECTED' : 'MISSED  '} ${negative.name} -> must fail ${negative.expected.join(', ')}; failed ${negative.failedChecks.join(', ') || 'nothing'}`);
  }
  return lines.join('\n');
}

/** Writes the checker table and the run's identity where a reviewer can read it later. */
export function writeEvidence(run: FamilyRun): string {
  const dir = process.env['PSTACK_E2E_EVIDENCE_DIR'] ?? join(tmpdir(), 'pstack-workflow-parity');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${run.family}-${run.driver}${run.driver === 'real' ? `-${REAL_MODEL.replace(/[^\w.-]/g, '_')}` : ''}.json`);
  writeFileSync(path, JSON.stringify({ family: run.family, driver: run.driver, at: new Date().toISOString(), timedOut: run.timedOut, sandbox: run.sandbox, results: run.results, negatives: run.negatives }, null, 2));
  return path;
}

/** Failing checks that the family does not list as a known product defect. */
export function unexpectedFailures(run: FamilyRun, family: Family): string[] {
  const known = new Set((family.knownDefects ?? []).map((entry) => entry.checkId));
  return run.results.filter((result) => result.verdict === 'FAIL' && !known.has(result.id)).map((result) => result.id);
}
