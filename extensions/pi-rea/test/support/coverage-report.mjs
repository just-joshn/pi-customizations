import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const separator = args.indexOf('--');
if (separator === -1) {
  process.stderr.write('usage: node test/support/coverage-report.mjs --tests <test files> -- <source file substrings>\n');
  process.exitCode = 2;
  process.exit();
}
const testFiles = args.slice(0, separator);
const targets = args.slice(separator + 1);

const packageDir = fileURLToPath(new URL('../..', import.meta.url));
const reports = mkdtempSync(join(tmpdir(), 'pi-rea-coverage-'));
try {
  const run = spawnSync(
    'bunx',
    [
      'vitest',
      'run',
      ...testFiles,
      '--coverage',
      '--coverage.reporter=json',
      `--coverage.reportsDirectory=${reports}`,
      '--coverage.thresholds.lines=0',
      '--coverage.thresholds.statements=0',
      '--coverage.thresholds.branches=0',
      '--coverage.thresholds.functions=0',
    ],
    { cwd: packageDir, encoding: 'utf8' },
  );
  if (run.status !== 0) {
    process.stdout.write(run.stdout ?? '');
    process.stderr.write(run.stderr ?? '');
    process.exitCode = run.status ?? 1;
    process.exit();
  }
  const coverage = JSON.parse(readFileSync(join(reports, 'coverage-final.json'), 'utf8'));
  const percent = (values) => `${((100 * values.filter((value) => value > 0).length) / Math.max(values.length, 1)).toFixed(1)}%`;
  let matched = 0;
  for (const target of targets) {
    for (const [path, data] of Object.entries(coverage)) {
      if (!path.includes(target)) continue;
      matched += 1;
      const statements = Object.values(data.s);
      const branches = Object.values(data.b).flat();
      const functions = Object.values(data.f);
      process.stdout.write(
        `${path.split('/src/').pop()}  statements ${percent(statements)} (${statements.filter((v) => v > 0).length}/${statements.length})  branches ${percent(branches)} (${branches.filter((v) => v > 0).length}/${branches.length})  functions ${percent(functions)} (${functions.filter((v) => v > 0).length}/${functions.length})\n`,
      );
    }
  }
  if (matched === 0) process.stderr.write('no requested file matched a coverage entry\n');
} finally {
  rmSync(reports, { recursive: true, force: true });
}
