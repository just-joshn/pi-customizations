#!/usr/bin/env node
/**
 * Capture the installed cursor-agent as the parity baseline.
 *
 * Every frame is taken with `tmux capture-pane`, so the baseline is text and
 * ANSI rather than a screenshot, and a drift shows up as a line diff. No
 * prompt is submitted, so the run spends no model requests.
 *
 *   node scripts/capture-reference.mjs [--check] [--transcript]
 *
 * `--check` compares the fresh capture against the committed baseline and
 * fails on any difference, which is how a cursor-agent upgrade announces
 * itself. `--transcript` replays the newest chat in this workspace instead:
 * that path renders real tool rows, and it needs a stored chat to resume.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripTerminalSequences } from '@earendil-works/pi-tui';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(PKG_ROOT, '..', '..');
const CURSOR_AGENT = process.env.CURSOR_AGENT_BIN ?? 'cursor-agent';
const REFERENCE_ROOT = join(PKG_ROOT, 'reference');
const SOCKET = `cursor-ui-reference-${process.pid}`;
const SESSION = 'cursor-ui-reference';
const SIZE = { cols: 110, rows: 34 };

/** States reachable with keystrokes only, so no model request is ever sent. */
const STEPS = [
  ['01-idle', null],
  ['02-typed', () => send('plan mission control interface')],
  ['03-cleared', () => press('C-u')],
  ['04-slash-menu', () => send('/')],
  ['05-slash-closed', () => press('Escape')],
  ['06-at-menu', () => send('@')],
  ['07-at-closed', () => press('Escape')],
  ['08-bang-mode', () => send('!ls')],
  ['09-bang-cleared', () => press('C-u')],
  ['10-mode-plan', () => press('BTab')],
  ['11-mode-debug', () => press('BTab')],
  ['12-mode-ask', () => press('BTab')],
  ['13-mode-agent', () => press('BTab')],
];

const tmux = (...args) => execFileSync('tmux', ['-L', SOCKET, ...args], { encoding: 'utf8' });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const send = (text) => tmux('send-keys', '-t', SESSION, '-l', text);
const press = (...keys) => {
  for (const key of keys) tmux('send-keys', '-t', SESSION, key);
};

function pane() {
  return { plain: tmux('capture-pane', '-p', '-t', SESSION), ansi: tmux('capture-pane', '-p', '-e', '-t', SESSION) };
}

/** Drop the shell prompt rows above the banner so frames diff from the UI down. */
function fromBanner(text) {
  const lines = text
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''));
  const start = lines.findIndex((line) => line.trim() === 'Cursor Agent');
  return (start === -1 ? lines : lines.slice(start)).join('\n');
}

async function waitForBanner() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (tmux('capture-pane', '-p', '-t', SESSION).includes('Plan, search, build anything')) return;
    await sleep(400);
  }
  throw new Error('cursor-agent did not reach its idle prompt');
}

function buildVersion() {
  return execFileSync(CURSOR_AGENT, ['--version'], { encoding: 'utf8' }).trim();
}

async function captureStates(outDir, size) {
  tmux('-f', '/dev/null', 'new-session', '-d', '-s', SESSION, '-x', String(size.cols), '-y', String(size.rows));
  tmux('set-option', '-t', SESSION, 'status', 'off');
  tmux('set-option', '-t', SESSION, 'extended-keys', 'on');
  tmux('set-option', '-t', SESSION, 'extended-keys-format', 'csi-u');
  tmux('send-keys', '-t', SESSION, `cd ${JSON.stringify(REPO_ROOT)} && ${CURSOR_AGENT} --trust`, 'Enter');
  await waitForBanner();
  await sleep(2_500);

  const written = [];
  for (const [name, action] of STEPS) {
    action?.();
    await sleep(1_200);
    const { plain, ansi } = pane();
    writeFileSync(join(outDir, `${name}.txt`), `${fromBanner(plain)}\n`);
    writeFileSync(join(outDir, `${name}.ansi.txt`), `${ansi}\n`);
    written.push(name);
  }
  return written;
}

async function captureNarrow(outDir) {
  for (const [name, cols, rows] of [
    ['20-narrow-40x12', 40, 12],
    ['21-mid-72x22', 72, 22],
  ]) {
    tmux('resize-window', '-t', SESSION, '-x', String(cols), '-y', String(rows));
    await sleep(1_500);
    const { plain, ansi } = pane();
    writeFileSync(join(outDir, `${name}.txt`), `${fromBanner(plain)}\n`);
    writeFileSync(join(outDir, `${name}.ansi.txt`), `${ansi}\n`);
  }
}

/** Replaying a stored chat renders assistant prose, tool rows and groups. */
async function captureTranscript(outDir) {
  tmux('send-keys', '-t', SESSION, 'C-u');
  tmux('kill-session', '-t', SESSION).valueOf?.();
  tmux('new-session', '-d', '-s', SESSION, '-x', '110', '-y', '34');
  tmux('set-option', '-t', SESSION, 'status', 'off');
  tmux('send-keys', '-t', SESSION, `cd ${JSON.stringify(REPO_ROOT)} && ${CURSOR_AGENT} --resume`, 'Enter');
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (tmux('capture-pane', '-p', '-t', SESSION).includes('Select')) break;
    await sleep(400);
  }
  await sleep(2_500);
  press('Enter');
  await sleep(7_000);
  writeFileSync(join(outDir, 'replay.txt'), `${tmux('capture-pane', '-p', '-t', SESSION, '-S', '-4000')}\n`);
  press('C-o');
  await sleep(2_500);
  writeFileSync(join(outDir, 'replay-expanded.txt'), `${tmux('capture-pane', '-p', '-t', SESSION, '-S', '-4000')}\n`);
}

/**
 * Drop the parts of a frame a re-capture cannot reproduce. The launch picks one
 * tip at random and wraps it to the pane, the location row follows the working
 * directory, and the ANSI capture still carries the shell prompt above the
 * banner. The visible text decides which lines those are, so every other line
 * stays byte-for-byte, colours included.
 */
function normalize(text) {
  const visible = (line) => stripTerminalSequences(line);
  const out = [];
  let inBanner = false;
  let inTip = false;
  for (const line of text.split('\n')) {
    const plain = visible(line);
    if (plain.trim() === 'Cursor Agent') inBanner = true;
    if (!inBanner) continue;
    if (/^\s*Tip: /u.test(plain)) {
      inTip = true;
      out.push('<tip>');
      continue;
    }
    if (inTip) {
      if (plain.trim() === '') inTip = false;
      // A wrapped tip emits one marker for the whole run, so the wrap width of
      // the pane cannot shift every row below it.
      else continue;
    }
    if (/^ {2}\S+ · \S+ · #\d+$/u.test(plain) || /^ {2}\S+ · \S+$/u.test(plain) || /^ {2}\S*…$/u.test(plain)) {
      out.push('<location>');
      continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n+$/u, '\n');
}

const version = buildVersion();
const referenceDir = join(REFERENCE_ROOT, `cursor-agent-${version}`);
const isCheck = process.argv.includes('--check');
const outDir = isCheck ? join(REFERENCE_ROOT, '.check', `cursor-agent-${version}`) : referenceDir;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

try {
  await captureStates(outDir, SIZE);
  await captureNarrow(outDir);
  if (process.argv.includes('--transcript')) await captureTranscript(join(outDir, 'transcript'));
} finally {
  // Teardown is best-effort: the session is usually already gone by now.
  for (const key of ['C-u', 'C-c', 'C-c']) spawnSync('tmux', ['-L', SOCKET, 'send-keys', '-t', SESSION, key]);
  await sleep(400);
  spawnSync('tmux', ['-L', SOCKET, 'kill-server']);
}

if (!isCheck) {
  writeFileSync(
    join(referenceDir, 'manifest.json'),
    `${JSON.stringify(
      {
        build: version,
        size: SIZE,
        states: readdirSync(outDir)
          .filter((f) => f.endsWith('.txt'))
          .sort(),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`captured ${version} into ${referenceDir}`);
} else {
  const baselineDir = join(REFERENCE_ROOT, `cursor-agent-${version}`);
  const mismatched = (existsSync(baselineDir) ? readdirSync(baselineDir) : [])
    .filter((name) => name.endsWith('.txt'))
    .filter((name) => {
      const after = join(outDir, name);
      if (!existsSync(after)) return true;
      return normalize(readFileSync(join(baselineDir, name), 'utf8')) !== normalize(readFileSync(after, 'utf8'));
    });
  console.log(`baseline: ${baselineDir}`);
  console.log(`mismatched states: ${mismatched.length === 0 ? 'none' : mismatched.join(', ')}`);
  process.exitCode = mismatched.length === 0 ? 0 : 1;
}
