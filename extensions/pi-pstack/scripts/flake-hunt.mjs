#!/usr/bin/env node
// Flake hunter. Runs vitest on named test files N times while CPU hogs run in
// the background, with and without --sequence.shuffle, then prints pass and fail
// counts and the first distinct failure messages per file.
//
// Usage (from extensions/pi-pstack):
//   node scripts/flake-hunt.mjs [--runs N] [--hogs K] [--modes plain,shuffle]
//                               [--seed S] [--keep-going-on-error] <file|all>...
//
//   --runs N     runs per file per mode (default 10)
//   --hogs K     busy-loop processes kept alive for the whole hunt (default 0)
//   --modes      comma list of plain and shuffle (default plain,shuffle)
//   <file>       a path such as test/child-task-lifecycle.test.ts, or "all" for
//                the whole vitest suite
//
// Every hog is a child this script spawned. Their pids are printed and only
// those pids are killed on exit, SIGINT or SIGTERM.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const MAX_MESSAGES = 3;
const MESSAGE_WIDTH = 240;

function parseOptions(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      runs: { type: 'string', default: '10' },
      hogs: { type: 'string', default: '0' },
      modes: { type: 'string', default: 'plain,shuffle' },
    },
  });
  const runs = Number(values.runs);
  const hogs = Number(values.hogs);
  const modes = values.modes.split(',');
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a positive integer, got ${values.runs}`);
  if (!Number.isInteger(hogs) || hogs < 0) throw new Error(`--hogs must be a non-negative integer, got ${values.hogs}`);
  for (const mode of modes) if (mode !== 'plain' && mode !== 'shuffle') throw new Error(`unknown mode ${mode}`);
  if (positionals.length === 0) throw new Error('name at least one test file, or "all"');
  return { runs, hogs, modes, targets: positionals };
}

function startHogs(count) {
  const hogs = [];
  for (let i = 0; i < count; i += 1) {
    hogs.push(spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }));
  }
  return hogs;
}

function stopHogs(hogs) {
  for (const hog of hogs) hog.kill('SIGKILL');
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
  const tail = `${result.stdout}${result.stderr}`.trim().split('\n').slice(-6).join(' | ');
  return [`exit ${result.status}: ${tail}`];
}

function execute(args) {
  return new Promise((resolve) => {
    const child = spawn('bunx', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function runOnce({ target, shuffle, workdir }) {
  const reportPath = join(workdir, 'report.json');
  const args = ['vitest', 'run', '--reporter=json', `--outputFile=${reportPath}`];
  if (target !== 'all') args.push(target);
  if (shuffle) args.push('--sequence.shuffle');
  const result = await execute(args);
  return result.status === 0 ? [] : failureMessages(reportPath, result);
}

async function hunt({ target, shuffle, runs, workdir }) {
  const distinct = new Map();
  let failed = 0;
  for (let i = 0; i < runs; i += 1) {
    const messages = await runOnce({ target, shuffle, workdir });
    if (messages.length === 0) continue;
    failed += 1;
    for (const message of messages) {
      const key = message.slice(0, MESSAGE_WIDTH);
      distinct.set(key, (distinct.get(key) ?? 0) + 1);
    }
  }
  return { passed: runs - failed, failed, distinct };
}

function report({ target, mode, hogs, runs }, { passed, failed, distinct }) {
  process.stdout.write(`${target}\tmode=${mode}\thogs=${hogs}\truns=${runs}\tpass=${passed}\tfail=${failed}\n`);
  for (const [message, count] of [...distinct].slice(0, MAX_MESSAGES)) {
    process.stdout.write(`  x${count} ${message}\n`);
  }
}

async function main() {
  const { runs, hogs: hogCount, modes, targets } = parseOptions(process.argv.slice(2));
  const workdir = mkdtempSync(join(tmpdir(), 'flake-hunt-'));
  const hogs = startHogs(hogCount);
  const cleanup = () => {
    stopHogs(hogs);
    rmSync(workdir, { recursive: true, force: true });
  };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      cleanup();
      process.exit(130);
    });
  }
  process.stdout.write(`hog pids: ${hogs.map((hog) => hog.pid).join(' ') || 'none'}\n`);
  try {
    for (const target of targets) {
      for (const mode of modes) {
        const shuffle = mode === 'shuffle';
        report({ target, mode, hogs: hogCount, runs }, await hunt({ target, shuffle, runs, workdir }));
      }
    }
  } finally {
    cleanup();
  }
}

await main();
