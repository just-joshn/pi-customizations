#!/usr/bin/env node
// Flake hunter. Runs vitest on named test files N times while CPU hogs run in
// the background, with and without --sequence.shuffle, then prints pass and fail
// counts and the first distinct failure messages per file.
//
// Usage (from extensions/pi-pstack):
//   node scripts/flake-hunt.mjs [--runs N] [--hogs K] [--modes plain,shuffle]
//                               <file|all>...
//
//   --runs N     runs per file per mode (default 10)
//   --hogs K     busy-loop processes kept alive for the whole hunt (default 0)
//   --save-failures DIR  write the raw output of every failed run to DIR
//   --modes      comma list of plain and shuffle (default plain,shuffle). Shuffle
//                run i uses --sequence.seed=i+1, so a failing seed is reproducible
//   exit code    1 when any run failed, else 0
//   <file>       a path such as test/child-task-lifecycle.test.ts, or "all" for
//                the whole vitest suite
//
// Every hog and every vitest run is a child this script spawned. Their pids are
// printed or tracked, and only those are killed on exit, SIGINT, SIGTERM or a
// crash. If this script is SIGKILLed, a hog notices its parent changed within a
// second and exits on its own.
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';

const MAX_MESSAGES = 8;
const MESSAGE_WIDTH = 240;
const TEMP_PATH = /(?:\/private)?\/var\/folders\/\S+?\/T\/[^\s'"]+/g;

function parseOptions(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      runs: { type: 'string', default: '10' },
      hogs: { type: 'string', default: '0' },
      modes: { type: 'string', default: 'plain,shuffle' },
      'save-failures': { type: 'string' },
    },
  });
  const runs = Number(values.runs);
  const hogs = Number(values.hogs);
  const modes = values.modes.split(',');
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a positive integer, got ${values.runs}`);
  if (!Number.isInteger(hogs) || hogs < 0) throw new Error(`--hogs must be a non-negative integer, got ${values.hogs}`);
  for (const mode of modes) if (mode !== 'plain' && mode !== 'shuffle') throw new Error(`unknown mode ${mode}`);
  if (positionals.length === 0) throw new Error('name at least one test file, or "all"');
  return { runs, hogs, modes, targets: positionals, saveFailures: values['save-failures'] };
}

function hogSource(parentPid) {
  return [`const parent = ${parentPid};`, 'let checked = Date.now();', 'for (;;) {', '  if (Date.now() - checked > 500) {', '    checked = Date.now();', '    if (process.ppid !== parent) process.exit(0);', '  }', '}'].join('\n');
}

const liveRuns = new Set();

function startHogs(count) {
  const source = hogSource(process.pid);
  const hogs = [];
  for (let i = 0; i < count; i += 1) {
    hogs.push(spawn(process.execPath, ['-e', source], { stdio: 'ignore' }));
  }
  return hogs;
}

function stopHogs(hogs) {
  for (const hog of hogs) hog.kill('SIGKILL');
}

function stopRuns() {
  for (const pid of liveRuns) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  liveRuns.clear();
}

function readReport(reportPath) {
  try {
    return JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch {
    return undefined;
  }
}

function reportMessages(report) {
  const messages = [];
  for (const file of report.testResults) {
    const failedTests = file.assertionResults.filter((test) => test.status === 'failed');
    for (const test of failedTests) {
      messages.push(`${test.fullName}: ${(test.failureMessages[0] ?? '').split('\n')[0]}`);
    }
    if (file.status === 'failed' && failedTests.length === 0) {
      messages.push(`${file.name}: ${file.message || 'file failed'}`);
    }
  }
  return messages;
}

function failureMessages(reportPath, result) {
  const report = readReport(reportPath);
  const messages = report ? reportMessages(report) : [];
  if (messages.length > 0) return messages;
  const lines = `${result.stdout}\n${result.stderr}`.split('\n').filter((line) => line.trim() && !line.startsWith('JSON report written'));
  const tail = lines.slice(-6).join(' | ');
  return [`exit ${result.status}: ${tail}`];
}

function execute(args) {
  return new Promise((resolve) => {
    const child = spawn('bunx', args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    liveRuns.add(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      stderr += String(error);
    });
    child.on('close', (status) => {
      stopRuns();
      resolve({ status, stdout, stderr });
    });
  });
}

function saveFailure(dir, name, result, reportPath) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `exit ${result.status}\n${result.stdout}\n${result.stderr}`);
  copyFileSync(reportPath, join(dir, `${name}.json`));
}

async function runOnce({ target, shuffleSeed, workdir, saveAs }) {
  const reportPath = join(workdir, 'report.json');
  const args = ['vitest', 'run', '--reporter=json', '--reporter=default', `--outputFile.json=${reportPath}`];
  if (target !== 'all') args.push(target);
  if (shuffleSeed !== undefined) args.push('--sequence.shuffle', `--sequence.seed=${shuffleSeed}`);
  const result = await execute(args);
  if (result.status === 0) return [];
  if (saveAs) saveFailure(saveAs.dir, saveAs.name, result, reportPath);
  return failureMessages(reportPath, result);
}

async function hunt({ target, shuffle, runs, workdir, saveFailures }) {
  const distinct = new Map();
  const failedSeeds = [];
  let failed = 0;
  for (let i = 0; i < runs; i += 1) {
    const shuffleSeed = shuffle ? i + 1 : undefined;
    const saveAs = saveFailures && { dir: saveFailures, name: `${basename(target)}.${shuffle ? 'shuffle' : 'plain'}.${i + 1}.log` };
    const messages = await runOnce({ target, shuffleSeed, workdir, saveAs });
    if (messages.length === 0) continue;
    failed += 1;
    if (shuffle) failedSeeds.push(shuffleSeed);
    for (const message of messages) {
      const key = message.replace(TEMP_PATH, (path) => `<tmp>/${path.split('/').pop()}`).slice(0, MESSAGE_WIDTH);
      distinct.set(key, (distinct.get(key) ?? 0) + 1);
    }
  }
  return { passed: runs - failed, failed, distinct, failedSeeds };
}

function report({ target, mode, hogs, runs }, { passed, failed, distinct, failedSeeds }) {
  process.stdout.write(`${target}\tmode=${mode}\thogs=${hogs}\truns=${runs}\tpass=${passed}\tfail=${failed}\n`);
  if (failedSeeds.length > 0) process.stdout.write(`  failing seeds: ${failedSeeds.join(' ')}\n`);
  for (const [message, count] of [...distinct].slice(0, MAX_MESSAGES)) {
    process.stdout.write(`  x${count} ${message}\n`);
  }
}

async function main() {
  const { runs, hogs: hogCount, modes, targets, saveFailures } = parseOptions(process.argv.slice(2));
  const workdir = mkdtempSync(join(tmpdir(), 'flake-hunt-'));
  const hogs = startHogs(hogCount);
  const cleanup = () => {
    stopRuns();
    stopHogs(hogs);
    rmSync(workdir, { recursive: true, force: true });
  };
  process.on('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => process.exit(130));
  }
  process.stdout.write(`hog pids: ${hogs.map((hog) => hog.pid).join(' ') || 'none'}\n`);
  let totalFailed = 0;
  for (const target of targets) {
    for (const mode of modes) {
      const shuffle = mode === 'shuffle';
      const result = await hunt({ target, shuffle, runs, workdir, saveFailures });
      totalFailed += result.failed;
      report({ target, mode, hogs: hogCount, runs }, result);
    }
  }
  process.exit(totalFailed > 0 ? 1 : 0);
}

await main();
