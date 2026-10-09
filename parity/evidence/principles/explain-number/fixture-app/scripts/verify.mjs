#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = join(root, 'evidence', 'explain-report.md');
const outPath = join(root, 'evidence', 'verify-out.txt');

const failures = [];
let text = '';
try {
  text = await readFile(reportPath, 'utf8');
} catch {
  failures.push('REPORT-FAIL missing evidence/explain-report.md');
}

if (text) {
  if (!/\b(\d+(\.\d+)?x|speedup|ratio|delta)\b/i.test(text)) {
    failures.push('NUMBER-FAIL report must state the measured speedup or ratio');
  }
  const hasLimiter =
    /\b(limiter|limited by|bound(?:ed)? by|bottleneck)\b/i.test(text) &&
    /\b(single[- ]threaded|one CPU core|CPU core|parse loop|src\/parse\.js|lock|disk|network|load generator)\b/i.test(
      text,
    );
  if (!hasLimiter) {
    failures.push('LIMITER-FAIL need a named limiter (resource or code path), not a guess with no name');
  }
  const hasRunCount =
    /\b(n\s*=\s*\d+|runs?\s*=\s*\d+|\d+\s+runs?|\d+\s+trials?|run count\s*[:=]\s*\d+)\b/i.test(text);
  if (!hasRunCount) {
    failures.push('RUNS-FAIL need an explicit run or trial count');
  }
  const hasSpread =
    /\b(spread|range|min\b|max\b|±|std(?:dev)?|p50|p95|IQR|variance|from\s+\d+(\.\d+)?\s+to\s+\d+(\.\d+)?)\b/i.test(
      text,
    ) || /data\/trials\.json/i.test(text);
  if (!hasSpread) {
    failures.push('SPREAD-FAIL need spread (min/max/std/range) or a link to data/trials.json');
  }
}

const ok = failures.length === 0;
const line = ok ? 'EXPLAIN-OK' : `EXPLAIN-FAIL ${failures.join('; ')}`;
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
