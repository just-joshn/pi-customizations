// node tests/workflow-parity/run-real-family.ts <babysit-drive-real|shipping-real|opening-a-pr-real> [--record]
// Runs one family against the throwaway GitHub repository (PSTACK_REAL_FORGE_REPO overrides it), prints the checker table,
// and with --record writes the evidence record next to the committed ones.
import { join } from 'node:path';

import { realFamilies } from './families/pr-real-forge.ts';
import { finishRecord, runRealFamily, writeRecord } from './lib/real-run.ts';

const [target, ...flags] = process.argv.slice(2);
const family = realFamilies.find((entry) => entry.id === target);
if (family === undefined) {
  console.error(`usage: run-real-family.ts <${realFamilies.map((entry) => entry.id).join('|')}> [--record]`);
  process.exit(2);
}
if (flags.includes('--record')) process.env['PSTACK_REAL_FORGE_EVIDENCE_DIR'] ??= join(import.meta.dirname, 'real-forge-evidence');
const record = await runRealFamily(family);
finishRecord(family, record);
console.log(record.table);
console.log(`PRs: ${record.facts.prs.map((pr) => pr.url).join(' ')}`);
console.log(`Actions runs: ${record.facts.actions.map((action) => action.url).join(' ')}`);
console.log(`left on the forge: ${record.cleanup.leftoverPrs.length} open PRs, ${record.cleanup.leftoverBranches.length} branches`);
console.log(`evidence record: ${writeRecord(record)}`);
const bad = record.results.some((result) => result.verdict !== 'PASS') || record.negatives.some((negative) => !negative.detected) || record.timedOut || record.cleanup.leftoverPrs.length + record.cleanup.leftoverBranches.length > 0;
process.exit(bad ? 1 : 0);
