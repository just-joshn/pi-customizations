#!/usr/bin/env node
/**
 * The tmux driver behind the smoke scenarios.
 *
 * Owns the throwaway tmux server, the temp HOME and workspace, the keystroke
 * actions, the pane captures under artifacts/, and the process teardown. The
 * scenario table and the fuzz runner drive the same primitives, so the session
 * state lives here and nowhere else.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROVIDER_SOURCE } from './scripted-provider.mjs';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXT_MAIN = join(PKG_ROOT, 'src', 'index.ts');
const THEME_FILE = join(PKG_ROOT, 'themes', 'tui-skin.json');
const ARTIFACT_ROOT = join(PKG_ROOT, 'artifacts');
let artifactDir = ARTIFACT_ROOT;
const SOCKET = `pi-tui-skin-smoke-${process.pid}`;
const SESSION = 'tui-skin-smoke';
const PANE_ARGS = ['-t', SESSION];
export const POLL_MS = 250;
export const STEP_TIMEOUT_MS = 60_000;

const KEY_SEQUENCES = new Map([
  ['Escape', ['1b']],
  ['ShiftTab', ['1b', '5b', '5a']],
  ['AltEnter', ['1b', '0d']],
  ['CtrlO', ['0f']],
  ['Enter', ['0d']],
  ['Up', ['1b', '5b', '41']],
  ['Down', ['1b', '5b', '42']],
  ['Tab', ['09']],
  ['CtrlC', ['03']],
]);

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
const tempPaths = [];

export function pause(ms) {
  if (ms > 0) Atomics.wait(sleepBuffer, 0, 0, ms);
}

function shquote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

let tmuxConfig = '/dev/null';

function tmux(args) {
  return execFileSync('tmux', ['-L', SOCKET, '-f', tmuxConfig, ...args], { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] });
}

function have(command) {
  try {
    return execFileSync('sh', ['-c', `command -v ${command}`], { encoding: 'utf8' }).trim().length > 0;
  } catch {
    return false;
  }
}

function resolvePi() {
  if (process.env.PI_BIN) return process.env.PI_BIN;
  return execFileSync('sh', ['-c', 'command -v pi'], { encoding: 'utf8' }).trim();
}

export function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  tempPaths.push(dir);
  return dir;
}

export function capturePane() {
  return tmux(['capture-pane', '-p', ...PANE_ARGS]);
}

function captureAnsi() {
  try {
    return tmux(['capture-pane', '-p', '-e', ...PANE_ARGS]);
  } catch {
    return undefined;
  }
}

function paneSize() {
  try {
    const [cols, rows] = tmux(['display-message', '-p', ...PANE_ARGS, '#{pane_width}x#{pane_height}'])
      .trim()
      .split('x')
      .map(Number);
    return { cols, rows };
  } catch {
    return { cols: undefined, rows: undefined };
  }
}

export function captureFrame(plain = capturePane()) {
  return { plain, ansi: captureAnsi(), ...paneSize() };
}

export function writeCapture(name, frame) {
  const file = join(artifactDir, `${name}.txt`);
  writeFileSync(file, frame.plain);
  if (frame.ansi !== undefined) writeFileSync(join(artifactDir, `${name}.ansi.txt`), frame.ansi);
  return file;
}

function sendText(text) {
  tmux(['send-keys', '-l', ...PANE_ARGS, text]);
  tmux(['send-keys', ...PANE_ARGS, 'Enter']);
}

function sendKeys(name) {
  const bytes = KEY_SEQUENCES.get(name);
  if (!bytes) throw new Error(`unknown key "${name}"`);
  tmux(['send-keys', '-H', ...PANE_ARGS, ...bytes]);
}

export function runAction(action) {
  if (action.kind === 'send') sendText(action.text);
  else if (action.kind === 'type') tmux(['send-keys', '-l', ...PANE_ARGS, action.text]);
  else if (action.kind === 'keys') for (const key of action.keys) sendKeys(key);
  else if (action.kind === 'resize') resizeWindow(action.size[0], action.size[1]);
  else throw new Error(`unknown action ${action.kind}`);
  pause(180);
}

/** Stops the throwaway server. A server that is already gone is the normal case at teardown. */
function stopServer() {
  spawnSync('tmux', ['-L', SOCKET, '-f', tmuxConfig, 'kill-server'], { stdio: 'ignore' });
}

export function cleanup() {
  stopServer();
  for (const dir of tempPaths) rmSync(dir, { recursive: true, force: true });
  tempPaths.length = 0;
}

function seedWorkspace(workspace, scenario) {
  writeFileSync(join(workspace, 'README.md'), '# Reference UI smoke\n\nTUI_SKIN_PLAINTEXT marker line.\n');
  writeFileSync(join(workspace, 'note.txt'), 'alpha\nTUI_SKIN_NOTE\n');
  // biome-ignore lint/security/noSecrets: fixture content for the unicode scenario, not a secret
  writeFileSync(join(workspace, 'unicode.txt'), 'TUI_SKIN_UNICODE 你好世界 🎉🚀\n第二行：日本語テキスト\n漢字と emoji 🌈 mixed\n');
  mkdirSync(join(workspace, 'nested'), { recursive: true });
  writeFileSync(join(workspace, 'nested', 'child.txt'), 'TUI_SKIN_NESTED\n');
  if (scenario.git === false) return;
  // Branch display is best-effort evidence, but a missing or failing git has to be visible.
  const initialized = spawnSync('git', ['init', '-q', '-b', 'smoke-main', workspace], { stdio: 'ignore' });
  if (initialized.error || initialized.status !== 0) process.stderr.write(`git init unavailable: ${initialized.error?.message ?? `exit ${initialized.status}`}\n`);
}

function piArgs(scenario, provider) {
  const args = [
    'env',
    `HOME=${shquote(homeDir)}`,
    'PI_OFFLINE=1',
    ...Object.entries(scenario.env ?? {}).map(([name, value]) => `${name}=${shquote(value)}`),
    shquote(piBinary()),
    ...(scenario.packageLoad ? ['-e', shquote(PKG_ROOT)] : ['--extension', shquote(EXT_MAIN), '--theme', shquote(THEME_FILE), '--use-theme', 'tui-skin']),
    '--extension',
    shquote(provider),
    '--model',
    'tui-skin-scripted/smoke',
    '--no-session',
    '-a',
    '-nc',
  ];
  if (scenario.fullscreen) args.push('--tui-mode', 'fullscreen');
  return args;
}

const TMUX_CONF = 'set -g extended-keys on\nset -g extended-keys-format csi-u\nset -g window-size manual\n';

let homeDir = '';
let piBin = '';

/** The pi binary every session and print-mode run executes. */
export function piBinary() {
  if (piBin === '') piBin = resolvePi();
  return piBin;
}

/** Fail loudly when tmux is missing, instead of at the first spawn. */
export function requireTmux() {
  if (!have('tmux')) throw new Error('tmux is required for the smoke driver but was not found on PATH');
}

export function startSession(scenario) {
  homeDir = tempDir('pi-tui-skin-home');
  mkdirSync(join(homeDir, '.pi', 'agent'), { recursive: true });
  writeFileSync(join(homeDir, '.pi', 'agent', 'settings.json'), `${JSON.stringify({ quietStartup: true }, null, 2)}\n`);
  const workspace =
    scenario.workspaceRoot === undefined
      ? tempDir('pi-tui-skin-ws')
      : (() => {
          const dir = mkdtempSync(join(scenario.workspaceRoot, 'pi-tui-skin-ws-'));
          tempPaths.push(dir);
          return dir;
        })();
  const provider = join(tempDir('pi-tui-skin-provider'), 'scripted-provider.ts');
  writeFileSync(provider, PROVIDER_SOURCE);
  seedWorkspace(workspace, scenario);

  const size = scenario.fullscreen ? ['120', '40'] : ['110', '36'];
  tmuxConfig = join(tempDir('pi-tui-skin-tmux'), 'tmux.conf');
  writeFileSync(tmuxConfig, TMUX_CONF);
  tmux(['new-session', '-d', '-x', size[0], '-y', size[1], '-s', SESSION, '-c', workspace, `${piArgs(scenario, provider).join(' ')}; echo PI-EXITED-$?; sleep 900`]);
  return { workspace, provider };
}

export function prepareArtifacts(name) {
  artifactDir = join(ARTIFACT_ROOT, name);
  rmSync(artifactDir, { recursive: true, force: true });
  mkdirSync(artifactDir, { recursive: true });
}

/** Resize the smoke window; the scenario and the fuzz ladder both drive it. */
export function resizeWindow(width, height) {
  tmux(['resize-window', '-t', SESSION, '-x', String(width), '-y', String(height)]);
}

/** Path of a saved plain-text capture inside the current artifact directory. */
export function artifactPath(name) {
  return join(artifactDir, `${name}.txt`);
}
