#!/usr/bin/env node
/**
 * One command that decides whether the Reference-style skin is healthy.
 *
 * Runs the unit gate, the live TUI scenarios, and seeded randomized sessions,
 * then prints `findings: <n>` and exits non-zero when anything failed. Every
 * step's raw output is kept under artifacts/sweep/ so a reviewer can read the
 * evidence instead of the summary.
 *
 *   node scripts/ui-sweep.mjs              full sweep
 *   node scripts/ui-sweep.mjs --fast       unit gate only
 *   node scripts/ui-sweep.mjs --live-only  live scenarios and fuzz only
 *   node scripts/ui-sweep.mjs --fuzz 20 --seed 7
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(PKG_ROOT, '..', '..');
const OUT_DIR = join(PKG_ROOT, 'artifacts', 'sweep');
const RUNS_FILE = join(PKG_ROOT, 'artifacts', 'sweep-runs.jsonl');

function parseArgs(argv) {
  const fuzzIndex = argv.indexOf('--fuzz');
  const seedIndex = argv.indexOf('--seed');
  return {
    fast: argv.includes('--fast'),
    liveOnly: argv.includes('--live-only'),
    fuzz: fuzzIndex === -1 ? 20 : Number(argv[fuzzIndex + 1]),
    seed: seedIndex === -1 ? 1 : Number(argv[seedIndex + 1]),
  };
}

const UNIT_STEPS = [
  { name: 'typecheck', cwd: PKG_ROOT, command: ['bun', 'run', 'typecheck'] },
  { name: 'skin-boundaries', cwd: PKG_ROOT, command: ['bun', 'run', 'check:skin'] },
  { name: 'skin-boundaries-self-test', cwd: PKG_ROOT, command: ['node', 'scripts/check-skin-boundaries.mjs', '--self-test'] },
  { name: 'frame-invariants-self-test', cwd: PKG_ROOT, command: ['node', 'scripts/lib/frame-invariants.mjs', '--self-test'] },
  { name: 'reference-parity', cwd: PKG_ROOT, command: ['node', 'scripts/compare-reference.mjs'] },
  { name: 'test-coverage', cwd: PKG_ROOT, command: ['bun', 'run', 'test:coverage'] },
  { name: 'prompt-parity', cwd: PKG_ROOT, command: ['node', 'scripts/check-prompt-parity.mjs'] },
  { name: 'biome', cwd: REPO_ROOT, command: ['bunx', 'biome', 'ci', '.', '--error-on-warnings', '--max-diagnostics=none'] },
  { name: 'vitest-conventions', cwd: REPO_ROOT, command: ['node', 'extensions/scripts/check-vitest-conventions.mjs'] },
];

const liveSteps = (options) => [
  { name: 'live-matrix', cwd: PKG_ROOT, command: ['node', 'scripts/tmux-smoke.mjs', '--all'] },
  { name: 'live-fuzz', cwd: PKG_ROOT, command: ['node', 'scripts/tmux-smoke.mjs', '--fuzz', String(options.fuzz), '--seed', String(options.seed)] },
];

/** Findings a step reports in its own output, on top of a non-zero exit. */
function reportedFindings(output) {
  const findings = [];
  for (const line of output.split('\n')) {
    const match = /^invariants: (\d+) findings/m.exec(line.trim());
    if (match && Number(match[1]) > 0) findings.push(`${match[1]} invariant findings`);
    if (/^smoke failures:/m.test(line.trim())) findings.push(line.trim());
    if (/^\[fail\]/m.test(line.trim())) findings.push(line.trim());
    if (/^findings: [1-9]/m.test(line.trim())) findings.push(line.trim());
  }
  return findings;
}

function runStep(step, index) {
  const started = Date.now();
  let output = '';
  let code = 0;
  try {
    output = execFileSync(step.command[0], step.command.slice(1), {
      cwd: step.cwd,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0' },
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    code = typeof error.status === 'number' ? error.status : 1;
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
  const logFile = join(OUT_DIR, `${String(index).padStart(2, '0')}-${step.name}.log`);
  writeFileSync(logFile, output);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const findings = reportedFindings(output);
  const failed = code !== 0;
  const label = failed ? `FAIL (exit ${code})` : findings.length > 0 ? `FAIL (${findings.join('; ')})` : 'pass';
  process.stdout.write(`[${label}] ${step.name} ${seconds}s -> ${logFile}\n`);
  return { name: step.name, code, seconds: Number(seconds), findings, logFile, failed: failed || findings.length > 0 };
}

/** One line per run, appended outside the per-run log directory so it survives. */
function recordRun(summary) {
  let head = 'unknown';
  let dirty = true;
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    dirty = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim().length > 0;
  } catch {
    // A missing git binary must not fail a sweep whose real work already ran.
  }
  appendFileSync(RUNS_FILE, `${JSON.stringify({ ...summary, head, dirty, finishedAt: new Date().toISOString() })}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const steps = [...(options.liveOnly ? [] : UNIT_STEPS), ...(options.fast ? [] : liveSteps(options))];
  const results = steps.map((step, index) => runStep(step, index));
  const failures = results.filter((result) => result.failed);
  const summary = {
    startedAt: new Date().toISOString(),
    seed: options.seed,
    fuzzSessions: options.fast || options.liveOnly ? 0 : options.fuzz,
    mode: options.fast ? 'fast' : options.liveOnly ? 'live-only' : 'full',
    steps: results.map(({ logFile, ...rest }) => ({ ...rest, log: logFile.replace(`${PKG_ROOT}/`, '') })),
    failures: failures.map((result) => result.name),
    findings: failures.length,
  };
  writeFileSync(join(OUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  recordRun(summary);
  process.stdout.write(`findings: ${summary.findings}\n`);
  process.exitCode = summary.findings === 0 ? 0 : 1;
}

main();
