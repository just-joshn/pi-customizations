#!/usr/bin/env node
/**
 * Isolated detached-tmux launcher for probes the pi-tui-skin smoke driver cannot
 * launch: a foreign package (pi-one-dark-pro-theme) and a custom scripted
 * provider. The pi-tui-skin scenarios import scripts/lib/tmux-driver.mjs
 * directly; this file adds only the session, keystroke, and capture primitives
 * those two cases need, and it isolates HOME, PI_CODING_AGENT_DIR, and the
 * workspace under one throwaway temp root.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pause, piBinary } from '../../../../../extensions/pi-tui-skin/scripts/lib/tmux-driver.mjs';

const SESSION = 'upi-probe';
const TMUX_CONF = 'set -g extended-keys on\nset -g extended-keys-format csi-u\nset -g window-size manual\n';
const KEY_SEQUENCES = new Map([
  ['Escape', ['1b']],
  ['Enter', ['0d']],
  ['Tab', ['09']],
  ['CtrlC', ['03']],
  ['CtrlO', ['0f']],
  ['ShiftTab', ['1b', '5b', '5a']],
]);

const servers = [];
const tempPaths = [];
let counter = 0;

function shquote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function tmux(socket, conf, args) {
  return execFileSync('tmux', ['-L', socket, '-f', conf, ...args], { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** One throwaway root holding HOME, the agent dir, and the workspace. */
export function makeLayout(prefix, settings = {}) {
  const root = mkdtempSync(join(tmpdir(), `upi-${prefix}-`));
  tempPaths.push(root);
  const home = join(root, 'home');
  const agentDir = join(root, 'agent');
  const workspace = join(root, 'workspace');
  for (const dir of [home, agentDir, workspace]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(agentDir, 'settings.json'), `${JSON.stringify({ quietStartup: true, ...settings }, null, 2)}\n`);
  return { root, home, agentDir, workspace };
}

/** The isolation environment every probe process gets. */
export function probeEnv(layout) {
  return { HOME: layout.home, PI_CODING_AGENT_DIR: layout.agentDir, PI_OFFLINE: '1' };
}

/** Run a one-shot `pi` command (install, list) inside the throwaway layout. */
export function runIsolatedPi(layout, args) {
  return execFileSync(piBinary(), args, { cwd: layout.workspace, env: { ...process.env, ...probeEnv(layout) }, encoding: 'utf8', timeout: 60_000 });
}

function probeApi(socket, conf) {
  return {
    socket,
    capture() {
      return tmux(socket, conf, ['capture-pane', '-p', '-t', SESSION]);
    },
    captureAnsi() {
      return tmux(socket, conf, ['capture-pane', '-p', '-e', '-t', SESSION]);
    },
    paneSize() {
      const [cols, rows] = tmux(socket, conf, ['display-message', '-p', '-t', SESSION, '#{pane_width}x#{pane_height}']).trim().split('x').map(Number);
      return { cols, rows };
    },
    title() {
      return tmux(socket, conf, ['display-message', '-p', '-t', SESSION, '#{pane_title}']).trim();
    },
    send(text) {
      tmux(socket, conf, ['send-keys', '-l', '-t', SESSION, text]);
      tmux(socket, conf, ['send-keys', '-t', SESSION, 'Enter']);
      pause(180);
    },
    type(text) {
      tmux(socket, conf, ['send-keys', '-l', '-t', SESSION, text]);
      pause(180);
    },
    keys(...names) {
      for (const name of names) {
        const bytes = KEY_SEQUENCES.get(name);
        if (!bytes) throw new Error(`unknown key "${name}"`);
        tmux(socket, conf, ['send-keys', '-H', '-t', SESSION, ...bytes]);
      }
      pause(180);
    },
    resize(width, height) {
      tmux(socket, conf, ['resize-window', '-t', SESSION, '-x', String(width), '-y', String(height)]);
      pause(180);
    },
    stop() {
      spawnSync('tmux', ['-L', socket, '-f', conf, 'kill-server'], { stdio: 'ignore' });
    },
  };
}

export function startProbe({ layout, piArgs, size = [110, 36], env = {} }) {
  counter += 1;
  const socket = `upi-probe-${process.pid}-${counter}`;
  servers.push(socket);
  const conf = join(layout.root, `tmux-${counter}.conf`);
  writeFileSync(conf, TMUX_CONF);
  const prefix = Object.entries({ ...probeEnv(layout), ...env })
    .map(([name, value]) => `${name}=${shquote(value)}`)
    .join(' ');
  const command = `${prefix} ${shquote(piBinary())} ${piArgs.map(shquote).join(' ')}; echo PI-EXITED-$?; sleep 900`;
  tmux(socket, conf, ['new-session', '-d', '-x', String(size[0]), '-y', String(size[1]), '-s', SESSION, '-c', layout.workspace, command]);
  return probeApi(socket, conf);
}

/** Kill only the probe servers this process started, then remove their temp roots. */
export function cleanupProbes() {
  for (const socket of servers) spawnSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' });
  servers.length = 0;
  for (const dir of tempPaths) rmSync(dir, { recursive: true, force: true });
  tempPaths.length = 0;
}

/** Write a plain capture plus its ANSI sibling under the scenario raw dir and return the plain path. */
export function saveCapture(dir, name, frame) {
  const plainPath = join(dir, `${name}.txt`);
  writeFileSync(plainPath, frame.plain);
  if (frame.ansi !== undefined) writeFileSync(join(dir, `${name}.ansi.txt`), frame.ansi);
  return plainPath;
}

/** Poll a capture until `predicate` holds; the thrown error names the step and the last pane. */
export function waitForCapture(capture, label, predicate, { timeoutMs = 60_000, pollMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = capture();
    if (predicate(text)) return text;
    pause(pollMs);
  }
  const last = capture();
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}; last pane has ${last.split('\n').length} lines`);
}
