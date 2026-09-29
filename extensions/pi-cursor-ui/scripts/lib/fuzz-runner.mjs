#!/usr/bin/env node
/**
 * The seeded fuzz runner.
 *
 * Each session starts a fresh tmux session at a random ladder size, fires a
 * seeded sequence of actions, and reads every capture through the frame
 * invariants. `runFuzz` prints one line per session and returns the process
 * exit code.
 */
import { ALL_INVARIANTS, checkFrame, splitFrameResults } from './frame-invariants.mjs';
import { paneContains } from './pane-text.mjs';
import { captureFrame, cleanup, pause, piBinary, prepareArtifacts, resizeWindow, runAction, startSession, writeCapture } from './tmux-driver.mjs';

const FUZZ_BUDGET_MS = 90_000;

const FUZZ_LADDER = [
  [40, 12],
  [80, 24],
  [110, 36],
  [200, 60],
  [30, 6],
];
const FUZZ_TEXT_POOL = ['hello', 'run tools', 'one tool', 'error tool', 'long output', '@note', '!echo FUZZ_BANG', 'SLOW reply', '你', '/compact'];
const FUZZ_SHAPES = ['type', 'Enter', 'Escape', 'ShiftTab', 'CtrlO', 'AltEnter', 'resize', 'reload', 'model', 'Up', 'Tab'];

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

function randomAction(rand) {
  const shape = pick(rand, FUZZ_SHAPES);
  if (shape === 'type') {
    const text = pick(rand, FUZZ_TEXT_POOL);
    return { shape, action: { kind: 'type', text }, log: `type ${JSON.stringify(text)}` };
  }
  if (shape === 'resize') {
    const size = pick(rand, FUZZ_LADDER);
    return { shape, action: { kind: 'resize', size }, log: `resize ${size[0]}x${size[1]}` };
  }
  if (shape === 'reload') return { shape, action: { kind: 'send', text: '/reload' }, log: 'send /reload' };
  if (shape === 'model') return { shape, action: { kind: 'send', text: '/model' }, log: 'send /model' };
  return { shape, action: { kind: 'keys', keys: [shape] }, log: `keys ${shape}` };
}

function runFuzzSession(seed, sessionIndex, options) {
  const rand = mulberry32((seed * 1_000_003 + sessionIndex) >>> 0);
  const [width, height] = pick(rand, FUZZ_LADDER);
  const actionCount = 10 + Math.floor(rand() * 16);
  const name = `fuzz/seed-${seed}-session-${sessionIndex}`;
  prepareArtifacts(name);
  const run = { name, options: { ...options, verbose: true }, findings: [], skips: [], passes: 0 };
  const unique = new Map();
  const actions = [];
  let budgetHit = false;
  let piExited = false;

  piBinary();
  startSession({});
  resizeWindow(width, height);
  pause(300);

  const started = Date.now();
  for (let index = 0; index < actionCount; index++) {
    if (Date.now() - started > FUZZ_BUDGET_MS) {
      budgetHit = true;
      break;
    }
    const picked = randomAction(rand);
    actions.push(picked.log);
    try {
      runAction(picked.action);
    } catch (error) {
      process.stderr.write(`[fuzz] seed=${seed} session=${sessionIndex} action=${index}: action failed: ${error instanceof Error ? error.message : String(error)}\n`);
      break;
    }
    const frame = captureFrame();
    const file = writeCapture(`action-${String(index).padStart(3, '0')}`, frame);
    const results = checkFrame({ plain: frame.plain, ansi: frame.ansi, cols: frame.cols, rows: frame.rows, scenario: name, step: `action ${index}`, expectChrome: false });
    const { findings, skips } = splitFrameResults(results);
    const touched = new Set([...findings.map((entry) => entry.invariant), ...skips.map((entry) => entry.invariant)]);
    run.passes += ALL_INVARIANTS.filter((invariant) => !touched.has(invariant)).length;
    run.skips.push(...skips);
    for (const entry of findings) {
      run.findings.push(entry);
      if (!unique.has(entry.invariant)) unique.set(entry.invariant, { ...entry, seed, session: sessionIndex, action: index, log: [...actions], file });
    }
    if (paneContains(frame.plain, 'PI-EXITED-')) {
      piExited = true;
      const exitLine = frame.plain.split('\n').find((line) => line.includes('PI-EXITED-')) ?? '';
      if (!unique.has('pi-exited')) unique.set('pi-exited', { invariant: 'pi-exited', detail: `pi exited during fuzz (${exitLine.trim()})`, seed, session: sessionIndex, action: index, log: [...actions], file });
      break;
    }
  }

  return { run, unique, actions, budgetHit, piExited, width, height, actionCount };
}

export function runFuzz(count, seed) {
  const options = { invariants: true, strict: false, verbose: true, all: false };
  const totals = { findings: 0, skips: 0, passes: 0 };
  const skippedReasons = new Map();
  for (let session = 0; session < count; session++) {
    let result;
    try {
      result = runFuzzSession(seed, session, options);
    } finally {
      cleanup();
    }
    totals.findings += result.run.findings.length;
    totals.skips += result.run.skips.length;
    totals.passes += result.run.passes;
    for (const entry of result.run.skips) skippedReasons.set(entry.invariant, entry.reason);
    process.stdout.write(
      `[fuzz] seed=${seed} session=${session} size=${result.width}x${result.height} actions=${result.actions.length}/${result.actionCount} findings=${result.run.findings.length} skipped=${result.run.skips.length}${result.budgetHit ? ' budget=90s-reached' : ''}\n`,
    );
    for (const entry of result.unique.values()) {
      process.stdout.write(`[fuzz-unique] seed=${entry.seed} session=${entry.session} action=${entry.action} invariant=${entry.invariant}: ${entry.detail} -> ${entry.file}\n`);
      process.stdout.write(`[fuzz-log] ${entry.log.map((line, index) => `${index}:${line}`).join(' | ')}\n`);
    }
  }
  process.stdout.write(`invariants: ${totals.findings} findings, ${totals.skips} skipped\n`);
  for (const [invariant, reason] of skippedReasons) process.stdout.write(`[skip] ${invariant}: ${reason}\n`);
  return totals.findings > 0 ? 1 : 0;
}
