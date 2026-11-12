// node tests/workflow-parity/run-family.ts <family|all> [--real]
// Scripted: the real Pi binary with a scenario model. --real: PSTACK_E2E_REAL_MODEL=<provider>/<id> lets a real model decide.
import { families, familyById } from './families/index.ts';
import { REAL_MODEL } from './lib/driver.ts';
import { report, runFamily, writeEvidence } from './lib/run.ts';

const [target, ...flags] = process.argv.slice(2);
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
  if (run.timedOut) console.log(`TIMED OUT; pi stderr: ${run.piStderr}`);
  if (run.results.some((result) => result.verdict === 'FAIL') || run.negatives.some((negative) => !negative.detected)) bad += 1;
  if (!flags.includes('--keep')) run.cleanup();
  else console.log(`sandbox kept: ${run.sandbox}`);
}
process.exit(bad === 0 ? 0 : 1);
