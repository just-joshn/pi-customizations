import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { checkFiles, checkSkill, formatProblem, referenceFiles } from './support/check.ts';

const SKILL_DIR = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const rels = args.length > 0 ? args : referenceFiles(SKILL_DIR);
const label = `cli-${createHash('sha256').update(rels.join('\n')).digest('hex').slice(0, 12)}`;
const problems = [...(args.length > 0 ? [] : checkSkill(SKILL_DIR)), ...checkFiles({ skillDir: SKILL_DIR, rels, label })];
for (const problem of problems) console.log(formatProblem(problem));
console.log(problems.length === 0 ? `ok: ${rels.length} file(s)` : `${problems.length} problem(s)`);
process.exitCode = problems.length === 0 ? 0 : 1;
