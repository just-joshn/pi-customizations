import { brokenLinks, checkSkill as checkSkillStructure, formatProblem, readSkillFile, referenceFiles } from 'skill-gate';
import type { TypecheckException } from './exceptions.ts';
import { typecheckBlocks } from './typecheck.ts';

export { referenceFiles } from 'skill-gate';

export function checkSkill(skillDir: string, exceptions: readonly TypecheckException[]): string[] {
  const files = referenceFiles(skillDir);
  const missing = exceptions.filter((e) => !files.includes(e.file)).map((e) => `exception names a file that does not exist: ${e.file}`);
  return [...checkSkillStructure(skillDir).map(formatProblem), ...missing];
}

export function checkFile(skillDir: string, rel: string, exceptions: readonly TypecheckException[]): string[] {
  const markdown = readSkillFile({ skillDir, rel });
  const problems = brokenLinks({ skillDir, rel }, markdown).map(formatProblem);
  const own = exceptions.filter((e) => e.file === rel);
  const excusedCodes = new Map(own.map((e) => [e, new Set<number>()]));
  for (const problem of typecheckBlocks(rel, markdown.blocks)) {
    const exception = own.find((e) => problem.block.code.includes(e.blockContains) && e.codes.includes(problem.code));
    if (exception) excusedCodes.get(exception)?.add(problem.code);
    else problems.push(problem.message);
  }
  for (const [exception, seen] of excusedCodes) {
    for (const code of exception.codes) {
      if (!seen.has(code)) problems.push(`${rel}: stale exception "${exception.blockContains}" TS${code}`);
    }
  }
  return problems;
}
