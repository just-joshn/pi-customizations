import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectParity } from './preflight.mjs';

export async function runPreflight(args) {
  if (!Array.isArray(args) || args.length > 1 || args.some((argument) => typeof argument !== 'string' || argument.startsWith('-'))) {
    return {
      exitCode: 1,
      report: {
        kind: 'preflight',
        verdict: 'BLOCKED',
        blockers: [{ code: 'INVALID_ARGUMENTS', file: '', locator: '', contractLocator: 'contract.md §9', message: 'Usage: node parity/scripts/check-preflight.mjs [parity-directory]' }],
      },
    };
  }
  try {
    return { exitCode: 2, report: await inspectParity(resolve(args[0] ?? fileURLToPath(new URL('..', import.meta.url)))) };
  } catch {
    return {
      exitCode: 1,
      report: {
        kind: 'preflight',
        verdict: 'BLOCKED',
        blockers: [{ code: 'PREFLIGHT_EXECUTION_FAILED', file: '', locator: '', contractLocator: 'contract.md §9', message: 'Preflight inspection failed. No acceptance verdict was produced.' }],
      },
    };
  }
}

if (import.meta.main) {
  const result = await runPreflight(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  process.exitCode = result.exitCode;
}
