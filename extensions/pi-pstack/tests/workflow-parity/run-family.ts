// node tests/workflow-parity/run-family.ts <family|all> [--real]
// PSTACK_E2E_REAL_MODEL=<provider>/<id> node tests/workflow-parity/run-family.ts --model-check: one tiny prompt on that model in a fresh sandbox, to prove the sandbox catalog resolves it.
// node tests/workflow-parity/run-family.ts --rescore <sandbox> [--family <id>] [--json]: re-evaluate a kept sandbox with the current checkers, no model run.
// Exit codes: 0 both contracts passed, 1 upstream failure (or either contract in scripted runs) or missed negative, 2 usage, 3 INCONCLUSIVE, 4 adaptation-only failure in real runs or rescoring.
// --stop-on-provider-error: with `all`, stop the batch at the first INCONCLUSIVE provider-error instead of running the remaining families against a dead provider.
// --real preflights every model the run uses (PSTACK_E2E_REAL_MODEL, PSTACK_E2E_REAL_MODEL_B) before it builds anything.
// Scripted: the real Pi binary with a scenario model. --real: PSTACK_E2E_REAL_MODEL=<provider>/<id> lets a real model decide.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { families, familyById } from './families/index.ts';
import { evaluate, resultExitCode, summarize, table } from './lib/check.ts';
import { loadView, type Meta, REAL_MODEL } from './lib/driver.ts';
import { assess, assessHarnessStop, describe, EXIT_INCONCLUSIVE } from './lib/integrity.ts';
import { checkModel, modelsInUse } from './lib/preflight.ts';
import { report, runFamily, writeEvidence } from './lib/run.ts';

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
  const meta = JSON.parse(readFileSync(join(sandbox, 'meta.json'), 'utf8')) as Meta;
  const view = loadView(sandbox);
  const inconclusive = assessHarnessStop(meta, family.spec) ?? assess(view, meta.crashed);
  if (inconclusive !== undefined) {
    console.log(argv.includes('--json') ? JSON.stringify({ family: id, sandbox, results: [], inconclusive }) : `== ${id} (rescore): ${describe(inconclusive)} ==`);
    process.exit(EXIT_INCONCLUSIVE);
  }
  const results = evaluate(family.checks, view);
  const known = (family.knownDefects ?? []).map((entry) => entry.checkId);
  console.log(argv.includes('--json') ? JSON.stringify({ family: id, sandbox, summary: summarize(results, known), results }) : table(id, 'rescore', results, known));
  process.exit(resultExitCode(results, 'real', known));
}
if (argv.includes('--model-check')) {
  if (REAL_MODEL === '') {
    console.error('usage: PSTACK_E2E_REAL_MODEL=<provider>/<id> run-family.ts --model-check');
    process.exit(2);
  }
  const result = await checkModel(REAL_MODEL);
  console.log(result.line);
  process.exit(result.ok ? 0 : EXIT_INCONCLUSIVE);
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
if (driver === 'real') {
  for (const model of modelsInUse()) {
    const result = await checkModel(model);
    if (!result.ok) {
      console.log(`== ${target} (real driver): INCONCLUSIVE provider-error: ${model}: ${result.detail} ==\npreflight failed before building anything`);
      process.exit(EXIT_INCONCLUSIVE);
    }
  }
}
let bad = 0;
let adaptationBad = false;
let inconclusive = 0;
let credentialLeak = false;
for (const family of target === 'all' ? families : [familyById(target)]) {
  const run = await runFamily(family, driver);
  console.log(report(run));
  console.log(`evidence record: ${writeEvidence(run)}`);
  credentialLeak ||= run.containerCredentialProbes?.some((probe) => probe.status === 'fail') === true;
  if (run.inconclusive !== undefined) {
    inconclusive += 1;
    console.log(`sandbox kept: ${run.sandbox}`);
    if (run.inconclusive.kind === 'provider-error' && flags.includes('--stop-on-provider-error')) break;
    continue;
  }
  if (run.timedOut) console.log(`TIMED OUT (${run.stopReason ?? 'unknown'}); pi stderr: ${run.piStderr}`);
  const known = (family.knownDefects ?? []).map((entry) => `${entry.checkId}: ${entry.defect}`);
  if (known.length > 0) console.log(`known product defects (expected FAIL):\n  ${known.join('\n  ')}`);
  const exit = resultExitCode(run.results, driver, run.known);
  if (exit === 4) adaptationBad = true;
  if (exit === 3) inconclusive += 1;
  if (exit === 1 || run.negatives.some((negative) => !negative.detected)) bad += 1;
  if (!flags.includes('--keep') && exit !== EXIT_INCONCLUSIVE) run.cleanup();
  else console.log(`sandbox kept: ${run.sandbox}`);
}
process.exit(credentialLeak || bad > 0 ? 1 : inconclusive > 0 ? EXIT_INCONCLUSIVE : adaptationBad ? 4 : 0);
