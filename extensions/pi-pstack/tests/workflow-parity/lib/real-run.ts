// Runs one real-forge family: the real pi binary with the scripted model against the sandbox repository, then the forge's
// state is read from the GitHub API, the checks and every negative case are evaluated, and the evidence is written before the
// run's PRs are closed and its branches deleted.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RealFamily } from '../families/pr-real-forge.ts';
import type { Facts } from '../fixtures/real-forge.ts';
import { type CheckResult, evaluate, failed, table, validateSources } from './check.ts';
import { runWorkflow } from './driver.ts';
import { withCopy } from './mutate.ts';

export interface RealRecord {
  family: string;
  recordedAt: string;
  piRunMs: number;
  facts: Facts;
  results: CheckResult[];
  negatives: { name: string; expected: string[]; failedChecks: string[]; detected: boolean }[];
  cleanup: { leftoverPrs: number[]; leftoverBranches: string[] };
  table: string;
  timedOut: boolean;
  piStderr: string;
}

export async function runRealFamily(family: RealFamily): Promise<RealRecord> {
  validateSources(family.checks);
  const started = Date.now();
  const outcome = await runWorkflow(family.spec, 'scripted');
  const piRunMs = Date.now() - started;
  try {
    const facts = family.forge.capture({ sandbox: outcome.sandbox, repo: outcome.view.repo }, family.capture());
    const results = evaluate(family.checks, outcome.view);
    const negatives = family.negatives.map((negative) => {
      const failedChecks = withCopy(outcome.sandbox, negative.mutate, (view) => failed(evaluate(family.checks, view)));
      return { name: negative.name, expected: negative.fails, failedChecks, detected: negative.fails.every((id) => failedChecks.includes(id)) };
    });
    const text = [table(family.id, 'real forge, scripted model', results), ...negatives.map((negative) => `${negative.detected ? 'DETECTED' : 'MISSED  '} ${negative.name} -> must fail ${negative.expected.join(', ')}; failed ${negative.failedChecks.join(', ') || 'nothing'}`)].join('\n');
    const record: RealRecord = { family: family.id, recordedAt: new Date().toISOString(), piRunMs, facts, results, negatives, cleanup: { leftoverPrs: [], leftoverBranches: [] }, table: text, timedOut: outcome.meta.timedOut, piStderr: outcome.meta.piStderr };
    return record;
  } finally {
    if (process.env['PSTACK_REAL_FORGE_KEEP'] === '1') {
      console.log(`sandbox kept: ${outcome.sandbox}`);
      family.forge.cleanup();
    } else outcome.cleanup();
  }
}

/** Reads what a finished cleanup left on the forge. Call it after `runRealFamily` returns. */
export function finishRecord(family: RealFamily, record: RealRecord): RealRecord {
  const left = family.forge.leftovers();
  record.cleanup = { leftoverPrs: left.openPrs, leftoverBranches: left.branches };
  return record;
}

export function writeRecord(record: RealRecord): string {
  const dir = process.env['PSTACK_REAL_FORGE_EVIDENCE_DIR'] ?? join(tmpdir(), 'pstack-real-forge');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${record.family}.json`);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  return path;
}
