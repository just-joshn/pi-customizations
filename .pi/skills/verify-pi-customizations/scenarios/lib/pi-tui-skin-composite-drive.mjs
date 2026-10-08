#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { pause } from '../../../../../extensions/pi-tui-skin/scripts/lib/tmux-driver.mjs';
import { COMPOSITE_OBSERVER_SOURCE } from './pi-tui-skin-composite-observer.mjs';
import { COMPOSITE_PROVIDER_SOURCE } from './pi-tui-skin-composite-provider.mjs';
import { cleanupProbes, makeLayout, startProbe, waitForCapture } from './tui-probe.mjs';

export const COMPOSITE_PACKAGE = 'extensions/pi-tui-skin';
export const COMPOSITE_MODEL = 'Reference UI Scripted';
export const COMPOSITE_MODEL_ALT = 'Reference UI Scripted Alt';
export const COMPOSITE_MODEL_COMMAND = 'upi-composite/smoke-alt';
export const COMPOSITE_HEADER = 'Pi Coding Agent';
export const COMPOSITE_IDLE_PLACEHOLDER = 'Plan, search, build anything';
export const COMPOSITE_SLOW_DONE = 'COMPOSITE_SLOW_DONE';
export const COMPOSITE_TOOL_ROW = '◇ Bash sleep 4 && echo SLOW_MARKER_LATE';
export const COMPOSITE_WIDGET_LINE = '● Running sleep 4 && echo SLOW_MARKER_LATE';
export const COMPOSITE_THINKING_HINT = '(shift+tab to cycle)';
export const COMPOSITE_BAND_GLYPHS = ['·', '•', '●'];
const COMPOSITE_SLOW_TURN = 'run slow';
const BAND_SAMPLES = 14;
const BAND_SAMPLE_MS = 120;

export function compositeEntry(repoRoot) {
  return join(repoRoot, COMPOSITE_PACKAGE, 'src', 'index.ts');
}

export function compositeMutantEntry({ repoRoot, layout, mutate }) {
  const root = join(layout.root, 'mutant');
  mkdirSync(join(root, 'src'), { recursive: true });
  cpSync(join(repoRoot, COMPOSITE_PACKAGE, 'src'), join(root, 'src'), { recursive: true });
  cpSync(join(repoRoot, COMPOSITE_PACKAGE, 'package.json'), join(root, 'package.json'));
  symlinkSync(join(repoRoot, COMPOSITE_PACKAGE, 'node_modules'), join(root, 'node_modules'));
  mutate(join(root, 'src'));
  return join(root, 'src', 'index.ts');
}

function writeFixtures(layout, entry) {
  const providerPath = join(layout.root, 'composite-provider.ts');
  writeFileSync(providerPath, COMPOSITE_PROVIDER_SOURCE);
  const wrapperPath = join(layout.root, 'composite-observer.ts');
  writeFileSync(wrapperPath, COMPOSITE_OBSERVER_SOURCE.replace('__ENTRY__', entry));
  const recordPath = join(layout.root, 'composite-observer.jsonl');
  return { providerPath, wrapperPath, recordPath };
}

function initWorkspace(workspace) {
  spawnSync('git', ['init', '-q', '-b', 'composite-main', workspace], { stdio: 'ignore' });
}

function piArgs(repoRoot, wrapperPath, providerPath) {
  return ['--extension', wrapperPath, '--theme', join(repoRoot, COMPOSITE_PACKAGE, 'themes', 'tui-skin.json'), '--use-theme', 'tui-skin', '--extension', providerPath, '--model', 'upi-composite/smoke', '--no-session', '-a', '-nc'];
}

function save(rawDir, name, probe, plain) {
  const file = join(rawDir, `${name}.txt`);
  writeFileSync(file, plain);
  const ansi = probe.captureAnsi();
  if (ansi !== undefined) writeFileSync(join(rawDir, `${name}.ansi.txt`), ansi);
  return file;
}

function bandSamples(probe) {
  const samples = [];
  for (let index = 0; index < BAND_SAMPLES; index += 1) {
    for (const line of probe.capture().split('\n')) {
      const glyph = COMPOSITE_BAND_GLYPHS.find((candidate) => line.includes(candidate));
      if (line.includes('Working') && line.includes('▄') && glyph !== undefined) {
        samples.push({ glyph, row: line.trim().replace(/\s+/g, ' ') });
      }
    }
    pause(BAND_SAMPLE_MS);
  }
  return samples;
}

function readObserver(recordPath) {
  try {
    return readFileSync(recordPath, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function footerRow(text, pattern) {
  return text.split('\n').find((line) => pattern.test(line)) ?? '';
}

export function runCompositeDrive({ repoRoot, layout, providerPath, wrapperPath, recordPath, rawDir }) {
  const probe = startProbe({ layout, piArgs: piArgs(repoRoot, wrapperPath, providerPath), size: [110, 36], env: { COMPOSITE_OBSERVER_PATH: recordPath } });
  const captures = {};
  const frames = {};
  const band = { samples: [], glyphs: [], rows: [] };
  let observer = [];
  try {
    waitForCapture(probe.capture, 'idle header', (text) => text.includes(COMPOSITE_HEADER));
    frames.idle = probe.capture();
    captures.idle = save(rawDir, '00-idle', probe, frames.idle);

    probe.send(COMPOSITE_SLOW_TURN);
    frames.running = waitForCapture(probe.capture, 'running tool call row', (text) => text.includes(COMPOSITE_TOOL_ROW));
    captures.running = save(rawDir, '01-running', probe, frames.running);
    band.samples = bandSamples(probe);
    band.glyphs = [...new Set(band.samples.map((sample) => sample.glyph))];
    band.rows = [...new Set(band.samples.map((sample) => sample.row))];

    frames.settled = waitForCapture(probe.capture, 'slow turn settled', (text) => text.includes(COMPOSITE_SLOW_DONE) && text.includes(COMPOSITE_IDLE_PLACEHOLDER));
    captures.settled = save(rawDir, '02-settled', probe, frames.settled);

    probe.keys('ShiftTab');
    waitForCapture(probe.capture, 'thinking level applied', (text) => text.includes('Thinking level:'));
    pause(500);
    frames.thinking = probe.capture();
    captures.thinking = save(rawDir, '03-thinking', probe, frames.thinking);

    probe.send(`/model ${COMPOSITE_MODEL_COMMAND}`);
    waitForCapture(probe.capture, 'model command in the composer', (text) => text.includes(COMPOSITE_MODEL_COMMAND));
    probe.keys('Enter');
    waitForCapture(probe.capture, 'model change applied', (text) => text.includes('Model: smoke-alt'));
    pause(500);
    frames.switched = probe.capture();
    captures.switched = save(rawDir, '05-model-switched', probe, frames.switched);

    for (const cycle of [1, 2]) {
      probe.send('/reload');
      frames[`reload${cycle}`] = waitForCapture(probe.capture, `reload ${cycle} frame`, (text) => text.includes(COMPOSITE_IDLE_PLACEHOLDER) && text.includes(COMPOSITE_HEADER));
      captures[`reload${cycle}`] = save(rawDir, `0${5 + cycle}-reload-${cycle}`, probe, frames[`reload${cycle}`]);
    }

    probe.keys('CtrlC');
    probe.keys('CtrlC');
    frames.quit = waitForCapture(probe.capture, 'pi exit', (text) => text.includes('PI-EXITED-'));
    captures.quit = save(rawDir, '08-quit', probe, frames.quit);
    observer = readObserver(recordPath);
    writeFileSync(join(rawDir, 'observer.jsonl'), observer.map((entry) => JSON.stringify(entry)).join('\n'));
  } finally {
    cleanupProbes();
  }

  return {
    rawDir,
    captures,
    frames,
    band,
    footer: {
      idleModelRow: footerRow(frames.idle, /Reference UI Scripted/),
      afterTurnModelRow: footerRow(frames.settled, /Reference UI Scripted/),
      thinkingRow: footerRow(frames.thinking, /shift\+tab to cycle/),
      locationRow: footerRow(frames.settled, /^ {2}(\/|~)/),
      afterSwitchModelRow: footerRow(frames.switched, /Reference UI Scripted/),
      runningEscToStop: frames.running.includes('esc to stop'),
    },
    headerCounts: {
      reload1: frames.reload1.split('\n').filter((line) => line.includes(COMPOSITE_HEADER)).length,
      reload2: frames.reload2.split('\n').filter((line) => line.includes(COMPOSITE_HEADER)).length,
    },
    quitMarkers: frames.quit.split('\n').filter((line) => line.includes('PI-EXITED-')),
    observer,
  };
}

/** One full composite session against the live entrypoint or a mutant entry. */
export function runCompositeSession({ repoRoot, rawDir, mutate }) {
  mkdirSync(rawDir, { recursive: true });
  const layout = makeLayout('skin-composite', {});
  initWorkspace(layout.workspace);
  const entry = mutate === undefined ? compositeEntry(repoRoot) : compositeMutantEntry({ repoRoot, layout, mutate });
  const { providerPath, wrapperPath, recordPath } = writeFixtures(layout, entry);
  return runCompositeDrive({ repoRoot, layout, providerPath, wrapperPath, recordPath, rawDir });
}
