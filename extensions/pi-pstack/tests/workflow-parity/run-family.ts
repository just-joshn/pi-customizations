// node tests/workflow-parity/run-family.ts <family|all> [--real]
// PSTACK_E2E_REAL_MODEL=<provider>/<id> node tests/workflow-parity/run-family.ts --model-check: one tiny prompt on that model in a fresh sandbox, to prove the sandbox catalog resolves it.
// node tests/workflow-parity/run-family.ts --rescore <sandbox> [--family <id>] [--json]: re-evaluate a kept sandbox with the current checkers, no model run.
// Scripted: the real Pi binary with a scenario model. --real: PSTACK_E2E_REAL_MODEL=<provider>/<id> lets a real model decide.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { families, familyById } from './families/index.ts';
import { evaluate, table } from './lib/check.ts';
import { loadView, REAL_MODEL, runWorkflow } from './lib/driver.ts';
import { report, runFamily, unexpectedFailures, writeEvidence } from './lib/run.ts';

const argv = process.argv.slice(2);
const rescoreAt = argv.indexOf('--rescore');
if (rescoreAt !== -1) {
  const sandbox = argv[rescoreAt + 1];
  if (sandbox === undefined) {
    console.error('usage: run-family.ts --rescore <sandbox> [--family <id>] [--json]');
    process.exit(2);
  }
  const named = argv[argv.indexOf('--family') + 1];
  const id = argv.includes('--family') && named !== undefined ? named : (JSON.parse(readFileSync(join(sandbox, 'meta.json'), 'utf8')) as { family: string }).family;
  const family = familyById(id);
  const results = evaluate(family.checks, loadView(sandbox));
  console.log(argv.includes('--json') ? JSON.stringify({ family: id, sandbox, results }) : table(id, 'rescore', results, (family.knownDefects ?? []).map((entry) => entry.checkId)));
  process.exit(0);
}
if (argv.includes('--model-check')) {
  if (REAL_MODEL === '') {
    console.error('usage: PSTACK_E2E_REAL_MODEL=<provider>/<id> run-family.ts --model-check');
    process.exit(2);
  }
  const outcome = await runWorkflow({ family: 'model-check', runId: 'model-check', mode: 'print', timeoutMs: 120_000, roles: {}, history: [{ message: 'init', files: { 'README.md': 'x\n' } }], prompt: () => 'Reply with exactly the word pong and nothing else. Do not use tools.', scenario: () => ({ actors: {} }) }, 'real');
  const oneShot = JSON.parse(readFileSync(join(outcome.sandbox, 'one-shot.json'), 'utf8')) as { exitCode: number | null; stdout: string; stderr: string };
  outcome.cleanup();
  console.log(`${REAL_MODEL} in a sandbox: exit ${oneShot.exitCode}, stdout ${JSON.stringify(oneShot.stdout.trim())}${oneShot.stderr === '' ? '' : `, stderr ${JSON.stringify(oneShot.stderr.slice(-400))}`}`);
  process.exit(oneShot.exitCode === 0 && /pong/i.test(oneShot.stdout) ? 0 : 1);
}
const [target, ...flags] = argv;
const driver = flags.includes('--real') ? 'real' : 'scripted';
if (target === undefined) {
  console.error(`usage: run-family.ts <${families.map((family) => family.id).join('|')}|all> [--real]`);
  process.exit(2);
}
if (driver === 'real' && REAL_MODEL === '') {
  console.error('PSTACK_E2E_REAL_MODEL is not set, for example PSTACK_E2E_REAL_MODEL=deepseek/deepseek-flash');
  process.exit(2);
}
let bad = 0;
for (const family of target === 'all' ? families : [familyById(target)]) {
  const run = await runFamily(family, driver);
  console.log(report(run));
  console.log(`evidence record: ${writeEvidence(run)}`);
  if (run.timedOut) console.log(`TIMED OUT (${run.stopReason ?? 'unknown'}); pi stderr: ${run.piStderr}`);
  const known = (family.knownDefects ?? []).map((entry) => `${entry.checkId}: ${entry.defect}`);
  if (known.length > 0) console.log(`known product defects (expected FAIL):\n  ${known.join('\n  ')}`);
  if (unexpectedFailures(run, family).length > 0 || run.negatives.some((negative) => !negative.detected)) bad += 1;
  if (!flags.includes('--keep')) run.cleanup();
  else console.log(`sandbox kept: ${run.sandbox}`);
}
process.exit(bad === 0 ? 0 : 1);
