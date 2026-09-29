#!/usr/bin/env node
/**
 * Live tmux smoke driver for pi-tui-skin.
 *
 * Starts a real `pi` in a detached tmux server with this package loaded, drives
 * it with keystrokes, and writes plain-text pane captures under artifacts/.
 * HOME, the workspace, and the scripted provider are throwaway temp paths, so
 * the developer's ~/.pi is never read or written, and the scripted provider
 * never touches the network.
 *
 *   node scripts/tmux-smoke.mjs --list
 *   node scripts/tmux-smoke.mjs --steps tools
 *   node scripts/tmux-smoke.mjs --all [--strict] [--no-invariants]
 *   node scripts/tmux-smoke.mjs --fuzz 5 --seed 1
 *
 * Each step runs actions (type, keys, resize), waits for every `expect` literal
 * to appear and every `reject` literal to be absent, then saves the pane. When
 * invariants are on, every capture also runs through `scripts/lib/frame-invariants.mjs`.
 *
 * The scenario table lives in `scripts/lib/scenarios.mjs`, the tmux session and
 * capture primitives in `scripts/lib/tmux-driver.mjs`, and the seeded fuzz mode
 * in `scripts/lib/fuzz-runner.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ALL_INVARIANTS, checkFrame, splitFrameResults } from './lib/frame-invariants.mjs';
import { runFuzz } from './lib/fuzz-runner.mjs';
import { footerLine, paneContains } from './lib/pane-text.mjs';
import { SCENARIOS } from './lib/scenarios.mjs';
import { PROVIDER_SOURCE } from './lib/scripted-provider.mjs';
import { artifactPath, captureFrame, capturePane, cleanup, EXT_MAIN, POLL_MS, pause, piBinary, prepareArtifacts, requireTmux, runAction, STEP_TIMEOUT_MS, startSession, tempDir, writeCapture } from './lib/tmux-driver.mjs';

function predicateFor(step) {
  return (text) => step.expect.every((literal) => paneContains(text, literal)) && (step.reject ?? []).every((literal) => !paneContains(text, literal));
}

function recordInvariants(run, step, frame, file) {
  if (!run.options.invariants) return;
  const results = checkFrame({
    plain: frame.plain,
    ansi: frame.ansi,
    cols: frame.cols,
    rows: frame.rows,
    scenario: run.name,
    step: step.name,
    expectChrome: step.chrome === true || step.chrome === 'top',
    expectHeader: step.chrome === 'top',
    expectExit: step.exit === true,
  });
  const { findings, skips } = splitFrameResults(results);
  const touched = new Set([...findings.map((entry) => entry.invariant), ...skips.map((entry) => entry.invariant)]);
  run.passes += ALL_INVARIANTS.filter((name) => !touched.has(name)).length;
  for (const entry of findings) {
    run.findings.push(entry);
    process.stdout.write(`[${entry.invariant}] ${run.name} ${step.name}: ${entry.detail} -> ${file}\n`);
  }
  for (const entry of skips) {
    run.skips.push(entry);
    if (run.options.verbose) process.stdout.write(`[skip] ${run.name} ${step.name}: ${entry.invariant}: ${entry.reason} -> ${file}\n`);
  }
  if (run.options.strict && findings.length > 0) {
    throw new Error(`${step.name}: ${findings.length} frame invariant finding(s): ${findings.map((entry) => entry.invariant).join(', ')}`);
  }
}

function waitFor(step, run) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let plain = capturePane();
  while (Date.now() < deadline) {
    if (predicateFor(step)(plain)) {
      const frame = captureFrame(plain);
      const file = writeCapture(step.capture, frame);
      step.check?.({ ...frame, contains: (literal) => paneContains(plain, literal) });
      recordInvariants(run, step, frame, file);
      return { step: step.name, file };
    }
    pause(POLL_MS);
    plain = capturePane();
  }
  const frame = captureFrame(plain);
  const file = writeCapture(step.capture, frame);
  recordInvariants(run, step, frame, file);
  throw new Error(`timed out after ${STEP_TIMEOUT_MS}ms waiting for ${step.name} (last capture ${file})`);
}

function runPrintMode(mode) {
  const homeDir = tempDir('pi-tui-skin-home');
  mkdirSync(join(homeDir, '.pi', 'agent'), { recursive: true });
  writeFileSync(join(homeDir, '.pi', 'agent', 'settings.json'), `${JSON.stringify({ quietStartup: true }, null, 2)}\n`);
  const provider = join(tempDir('pi-tui-skin-provider'), 'scripted-provider.ts');
  writeFileSync(provider, PROVIDER_SOURCE);
  const common = ['--extension', EXT_MAIN, '--extension', provider, '--model', 'tui-skin-scripted/smoke', '--no-session', '-a', '-nc'];
  const args = mode === 'rpc' ? ['--mode', 'rpc', ...common] : mode === 'json' ? ['--mode', 'json', ...common, 'say hello'] : ['--print', ...common, 'say hello'];
  const options = { encoding: 'utf8', timeout: 60_000, env: { ...process.env, HOME: homeDir, PI_OFFLINE: '1' } };
  const pi = piBinary();
  const output = mode === 'rpc' ? execFileSync(pi, args, { ...options, input: `${JSON.stringify({ id: 'smoke', type: 'prompt', message: 'say hello' })}\n` }) : execFileSync(pi, args, options);
  const file = writeCapture(`01-${mode}-mode`, { plain: output });
  const expected = mode === 'json' ? ['TUI_SKIN_REPLY_OK', '"type":"agent_end"'] : ['TUI_SKIN_REPLY_OK'];
  for (const literal of expected) {
    if (!output.includes(literal)) throw new Error(`${mode} mode output is missing ${literal} (capture ${file})`);
  }
  return [{ step: `${mode} reply`, file }];
}

function runScenario(name, run) {
  const scenario = SCENARIOS.get(name);
  if (!scenario) throw new Error(`unknown scenario "${name}" (see --list)`);
  if (!existsSync(EXT_MAIN)) throw new Error(`extension entry point not found: ${EXT_MAIN}`);
  piBinary();
  requireTmux();

  prepareArtifacts(name);

  if (scenario.mode !== undefined) return runPrintMode(scenario.mode);

  startSession(scenario);

  const captures = [];
  for (const step of scenario.steps) {
    for (const action of step.actions ?? []) runAction(action);
    const capture = waitFor(step, run);
    captures.push(capture);
    if (step.footerDiffersFrom) {
      const previous = readFileSync(artifactPath(step.footerDiffersFrom), 'utf8');
      const before = footerLine(previous);
      const after = footerLine(readFileSync(capture.file, 'utf8'));
      if (before === after) throw new Error(`${step.name}: footer line did not change (${JSON.stringify(after)})`);
    }
  }
  return captures;
}

// --- entry point ------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) {
    for (const [name, scenario] of SCENARIOS) process.stdout.write(`${name}  ${scenario.description}\n`);
    return 0;
  }

  const fuzzFlag = argv.indexOf('--fuzz');
  if (fuzzFlag !== -1) {
    const count = Number(argv[fuzzFlag + 1] ?? '1');
    const seedFlag = argv.indexOf('--seed');
    const seed = Number(seedFlag === -1 ? '1' : argv[seedFlag + 1]);
    if (!Number.isInteger(count) || count <= 0) throw new Error('--fuzz needs a positive integer count');
    if (!Number.isInteger(seed)) throw new Error('--seed needs an integer seed');
    return runFuzz(count, seed);
  }

  const options = {
    all: argv.includes('--all'),
    strict: argv.includes('--strict'),
    invariants: !argv.includes('--no-invariants'),
    verbose: argv.includes('--all'),
  };
  const stepsFlag = argv.indexOf('--steps');
  const names = options.all ? [...SCENARIOS.keys()] : [stepsFlag === -1 ? 'idle' : argv[stepsFlag + 1]];
  const failures = [];
  const totals = { findings: 0, skips: 0, passes: 0 };
  for (const name of names) {
    const run = { name, options, findings: [], skips: [], passes: 0 };
    try {
      for (const capture of runScenario(name, run)) process.stdout.write(`[pass] ${name}: ${capture.step} -> ${capture.file}\n`);
    } catch (error) {
      failures.push(name);
      process.stderr.write(`[fail] ${name}: ${error instanceof Error ? error.message : String(error)}\n`);
    } finally {
      cleanup();
    }
    if (options.invariants) process.stdout.write(`[invariants] ${name}: ${run.findings.length} findings, ${run.skips.length} skipped, ${run.passes} passed\n`);
    totals.findings += run.findings.length;
    totals.skips += run.skips.length;
    totals.passes += run.passes;
  }
  if (options.all && options.invariants) {
    process.stdout.write(`invariants: ${totals.findings} findings, ${totals.skips} skipped, ${totals.passes} passed\n`);
  }
  if (failures.length > 0) {
    process.stderr.write(`smoke failures: ${failures.join(', ')}\n`);
    return 1;
  }
  if (options.all && options.invariants && totals.findings > 0) return 1;
  return 0;
}

process.exitCode = main();
