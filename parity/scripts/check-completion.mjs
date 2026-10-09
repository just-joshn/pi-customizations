import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateCompletion, writeCompletion } from './completion.mjs';
import { parityDirectory } from './preflight-files.mjs';

export async function runCompletion(args) {
  if (!Array.isArray(args) || args.length > 1 || args.some((argument) => typeof argument !== 'string' || argument.startsWith('-'))) {
    return {
      exitCode: 1,
      report: {
        kind: 'completion',
        gateVersion: 1,
        verdict: 'BLOCKED',
        blockers: [
          {
            code: 'INVALID_ARGUMENTS',
            file: '',
            locator: '',
            contractLocator: 'contract.md §9',
            message: 'Usage: node parity/scripts/check-completion.mjs [parity-directory]',
          },
        ],
        requirementCount: 0,
        executedJourneyCount: 0,
        evidenceIndex: [],
        evaluatedAt: new Date().toISOString(),
      },
      completionPath: null,
    };
  }

  try {
    const directory = resolve(args[0] ?? fileURLToPath(new URL('..', import.meta.url)));
    const report = await evaluateCompletion(directory);
    const root = await parityDirectory(directory);
    const completionPath = root ? await writeCompletion(root, report) : null;
    return {
      exitCode: report.verdict === 'PASS' ? 0 : 2,
      report,
      completionPath,
    };
  } catch {
    return {
      exitCode: 1,
      report: {
        kind: 'completion',
        gateVersion: 1,
        verdict: 'BLOCKED',
        blockers: [
          {
            code: 'COMPLETION_EXECUTION_FAILED',
            file: '',
            locator: '',
            contractLocator: 'contract.md §9',
            message: 'Completion gate execution failed. No PASS verdict was produced.',
          },
        ],
        requirementCount: 0,
        executedJourneyCount: 0,
        evidenceIndex: [],
        evaluatedAt: new Date().toISOString(),
      },
      completionPath: null,
    };
  }
}

if (import.meta.main) {
  const result = await runCompletion(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  process.exitCode = result.exitCode;
}
