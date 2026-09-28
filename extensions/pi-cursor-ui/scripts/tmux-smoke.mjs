#!/usr/bin/env node
/**
 * Live tmux smoke driver for pi-cursor-ui.
 *
 * Starts a real `pi` in a detached tmux server with this package loaded, drives
 * it with keystrokes, and writes plain-text pane captures under artifacts/.
 * HOME, the workspace, and the scripted provider are throwaway temp paths, so
 * the developer's ~/.pi is never read or written, and the scripted provider
 * never touches the network.
 *
 *   node scripts/tmux-smoke.mjs --list
 *   node scripts/tmux-smoke.mjs --steps tools
 *   node scripts/tmux-smoke.mjs --all
 *
 * Each step runs actions (type, keys, resize), waits for every `expect` literal
 * to appear and every `reject` literal to be absent, then saves the pane.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT_MAIN = join(PKG_ROOT, 'src', 'index.ts');
const THEME_FILE = join(PKG_ROOT, 'themes', 'cursor-ui.json');
const ARTIFACT_ROOT = join(PKG_ROOT, 'artifacts');
let artifactDir = ARTIFACT_ROOT;
const SOCKET = `pi-cursor-ui-smoke-${process.pid}`;
const SESSION = 'cursor-ui-smoke';
const PANE_ARGS = ['-t', SESSION];
const POLL_MS = 250;
const STEP_TIMEOUT_MS = 60_000;

const IDLE_EXPECT = ['> agent', 'Pi Coding Agent', 'shift+tab to cycle', '/ commands', '@ files', '! shell'];
const idle = { name: 'idle frame', capture: '01-idle', expect: IDLE_EXPECT };
const runTools = { kind: 'send', text: 'run tools' };
const slowTurn = { kind: 'send', text: 'SLOW reply' };

const SCENARIOS = new Map([
  ['idle', { description: 'boot the skin and confirm the idle frame', steps: [idle] }],
  [
    'prompt',
    {
      description: 'type a prompt and read the scripted reply',
      steps: [idle, { name: 'scripted reply', capture: '02-reply', actions: [{ kind: 'send', text: 'say hello' }], expect: ['CURSOR_UI_REPLY_OK'] }],
    },
  ],
  [
    'stream',
    {
      description: 'capture the frame while the scripted reply streams',
      steps: [idle, { name: 'mid stream', capture: '02-streaming', actions: [slowTurn], expect: ['SLOW REPLY STREAMING'], reject: ['CURSOR_UI_REPLY_OK'] }],
    },
  ],
  [
    'cancel',
    {
      description: 'escape cancels the streaming reply',
      steps: [
        idle,
        { name: 'streaming', capture: '02-streaming', actions: [slowTurn], expect: ['SLOW '] },
        { name: 'cancelled', capture: '03-cancelled', actions: [{ kind: 'keys', keys: ['Escape'] }], expect: ['Ask, build, or change anything'] },
      ],
    },
  ],
  [
    'steer',
    {
      description: 'typing while streaming steers the running turn',
      steps: [
        idle,
        { name: 'streaming', capture: '02-streaming', actions: [slowTurn], expect: ['SLOW '] },
        {
          name: 'steered',
          capture: '03-steered',
          actions: [
            { kind: 'type', text: 'steer now' },
            { kind: 'keys', keys: ['Enter'] },
          ],
          expect: ['steer now'],
        },
      ],
    },
  ],
  [
    'followup',
    {
      description: 'alt+enter queues a follow-up message',
      steps: [
        idle,
        { name: 'streaming', capture: '02-streaming', actions: [slowTurn], expect: ['SLOW '] },
        {
          name: 'follow up',
          capture: '03-followup',
          actions: [
            { kind: 'type', text: 'follow up' },
            { kind: 'keys', keys: ['AltEnter'] },
          ],
          expect: ['follow up'],
        },
      ],
    },
  ],
  [
    'thinking',
    {
      description: 'shift+tab cycles the real thinking level in the footer',
      steps: [idle, { name: 'cycled', capture: '02-thinking', actions: [{ kind: 'keys', keys: ['ShiftTab'] }], expect: ['shift+tab to cycle'], footerDiffersFrom: '01-idle' }],
    },
  ],
  [
    'slash',
    {
      description: 'slash opens the command menu',
      steps: [idle, { name: 'slash menu', capture: '02-slash', actions: [{ kind: 'type', text: '/' }], expect: ['Open settings menu', '(1/25)'] }],
    },
  ],
  [
    'files',
    {
      description: 'at opens file completion from the workspace',
      steps: [idle, { name: 'file menu', capture: '02-files', actions: [{ kind: 'type', text: '@note' }], expect: ['note.txt'] }],
    },
  ],
  [
    'shell',
    {
      description: 'bang runs a shell command in context',
      steps: [idle, { name: 'shell output', capture: '02-shell', actions: [{ kind: 'send', text: '!echo CURSOR_UI_SHELL_OK' }], expect: ['CURSOR_UI_SHELL_OK'] }],
    },
  ],
  [
    'shell-nocontext',
    {
      description: 'double bang runs a shell command outside model context',
      steps: [idle, { name: 'shell output', capture: '02-shell-nocontext', actions: [{ kind: 'send', text: '!!echo CURSOR_UI_SHELL_NC_OK' }], expect: ['CURSOR_UI_SHELL_NC_OK'] }],
    },
  ],
  [
    'tools',
    {
      description: 'one scripted turn per built-in tool row with the opt-in overrides enabled',
      env: { PI_CURSOR_UI_TOOL_OVERRIDES: 'grep,find,ls,powershell' },
      steps: [
        idle,
        { name: 'read row', capture: '02-tool-read', actions: [runTools], expect: ['Read README.md'] },
        { name: 'bash row', capture: '03-tool-bash', expect: ['Bash echo CURSOR_UI_BASH_OK', 'CURSOR_UI_BASH_OK'] },
        { name: 'write row', capture: '04-tool-write', expect: ['Write written.txt'] },
        { name: 'edit row', capture: '05-tool-edit', expect: ['Edit note.txt'] },
        { name: 'grep row', capture: '06-tool-grep', expect: ['Search "CURSOR_UI"'] },
        { name: 'find row', capture: '07-tool-find', expect: ['Find "*.txt"'] },
        { name: 'ls row', capture: '08-tool-ls', expect: ['List .'] },
        { name: 'tools done', capture: '09-tool-done', expect: ['CURSOR_UI_TOOLS_DONE'] },
      ],
    },
  ],
  [
    'widget',
    {
      description: 'the live activity widget shows the running tool',
      steps: [
        idle,
        {
          name: 'running tool',
          capture: '02-widget',
          actions: [{ kind: 'send', text: 'run slow tool' }],
          expect: ['Running sleep 4 && echo SLOW_MARKER_LATE'],
          reject: ['CURSOR_UI_SLOW_DONE'],
        },
        { name: 'finished', capture: '03-widget-done', expect: ['CURSOR_UI_SLOW_DONE'], reject: ['Running sleep 4'] },
      ],
    },
  ],
  [
    'expand',
    {
      description: 'ctrl+o expands real tool output',
      env: { PI_CURSOR_UI_TOOL_OVERRIDES: 'grep,find,ls,powershell' },
      steps: [
        idle,
        { name: 'tools done', capture: '02-tool-rows', actions: [runTools], expect: ['CURSOR_UI_TOOLS_DONE'] },
        { name: 'expanded', capture: '03-expanded', actions: [{ kind: 'keys', keys: ['CtrlO'] }], expect: ['CURSOR_UI_PLAINTEXT'] },
      ],
    },
  ],
  [
    'resize',
    {
      description: 'a resize keeps the frame intact',
      steps: [
        idle,
        { name: 'narrow', capture: '02-narrow', actions: [{ kind: 'resize', size: [72, 22] }], expect: ['Pi Coding Agent', '/ commands'] },
        { name: 'wide', capture: '03-wide', actions: [{ kind: 'resize', size: [140, 44] }], expect: ['Pi Coding Agent', '@ files'] },
      ],
    },
  ],
  [
    'reload',
    {
      description: 'slash reload re-installs the skin',
      steps: [idle, { name: 'reloaded', capture: '02-reloaded', actions: [{ kind: 'send', text: '/reload' }], expect: ['> agent', 'shift+tab to cycle'] }],
    },
  ],
  [
    'fullscreen',
    {
      description: 'the skin loads in fullscreen TUI mode',
      fullscreen: true,
      steps: [{ name: 'fullscreen frame', capture: '01-fullscreen', expect: ['> agent', 'Pi Coding Agent', '/ commands'] }],
    },
  ],
  ['print-mode', { description: 'non-TUI print mode loads the extension safely', mode: 'print' }],
  [
    'package-load',
    {
      description: 'the package manifest loads the extension and the theme together',
      packageLoad: true,
      steps: [idle],
    },
  ],
  ['json-mode', { description: 'non-TUI json mode loads the extension and the reply is unchanged', mode: 'json' }],
  ['rpc-mode', { description: 'non-TUI rpc mode loads the extension and answers a prompt', mode: 'rpc' }],
]);

const PROVIDER_SOURCE = `import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const TOOL_TURNS = [
  { type: 'toolCall', id: 'smoke-read', name: 'read', arguments: { path: 'README.md' } },
  { type: 'toolCall', id: 'smoke-bash', name: 'bash', arguments: { command: 'echo CURSOR_UI_BASH_OK' } },
  { type: 'toolCall', id: 'smoke-write', name: 'write', arguments: { path: 'written.txt', content: 'CURSOR_UI_WRITTEN\\n' } },
  { type: 'toolCall', id: 'smoke-edit', name: 'edit', arguments: { path: 'note.txt', oldText: 'alpha', newText: 'beta' } },
  { type: 'toolCall', id: 'smoke-grep', name: 'grep', arguments: { pattern: 'CURSOR_UI' } },
  { type: 'toolCall', id: 'smoke-find', name: 'find', arguments: { pattern: '*.txt' } },
  { type: 'toolCall', id: 'smoke-ls', name: 'ls', arguments: { path: '.' } },
];

function usage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function textOf(message) {
  if (typeof message.content === 'string') return message.content;
  return message.content.filter((part) => part.type === 'text').map((part) => part.text).join(' ');
}

function transcriptText(context) {
  return context.messages.filter((message) => message.role === 'user').map((message) => textOf(message)).join('\\n');
}

export default function (pi: ExtensionAPI) {
  pi.registerProvider('cursor-ui-scripted', {
    name: 'Cursor UI Scripted',
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'smoke-not-a-real-key',
    api: 'cursor-ui-scripted',
    streamSimple(model, context, _options) {
      const stream = createAssistantMessageEventStream();
      const transcript = transcriptText(context);
      const toolResults = context.messages.filter((message) => message.role === 'toolResult').length;
      const wantsTools = transcript.includes('run tools');
      const slow = transcript.includes('SLOW');
      const wantsSlowTool = transcript.includes('run slow') && toolResults === 0;
      const turn = wantsSlowTool
        ? { type: 'toolCall', id: 'smoke-slow', name: 'bash', arguments: { command: 'sleep 4 && echo SLOW_MARKER_LATE' } }
        : wantsTools && toolResults < TOOL_TURNS.length
          ? TOOL_TURNS[toolResults]
          : undefined;
      const slowToolRun = transcript.includes('run slow');
      const text = turn ? undefined : wantsTools ? 'CURSOR_UI_TOOLS_DONE' : slowToolRun ? 'CURSOR_UI_SLOW_DONE' : 'CURSOR_UI_REPLY_OK';
      (async () => {
        const message = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage: usage(), stopReason: 'pending', timestamp: Date.now() };
        stream.push({ type: 'start', partial: message });
        if (turn) {
          message.content.push(turn);
          stream.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
          stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall: turn, partial: message });
        } else {
          message.content.push({ type: 'text', text: '' });
          stream.push({ type: 'text_start', contentIndex: 0, partial: message });
          const chunks = slow ? ['SLOW ', 'REPLY ', 'STREAMING ', text] : [text];
          for (const chunk of chunks) {
            if (message.content[0].text.endsWith('CURSOR_UI_REPLY_OK')) break;
            message.content[0].text += chunk;
            stream.push({ type: 'text_delta', contentIndex: 0, delta: chunk, partial: message });
            if (slow) await new Promise((resolve) => setTimeout(resolve, 900));
          }
          stream.push({ type: 'text_end', contentIndex: 0, content: message.content[0].text, partial: message });
        }
        message.stopReason = turn ? 'toolUse' : 'stop';
        stream.push({ type: 'done', reason: message.stopReason, message });
        stream.end();
      })();
      return stream;
    },
    models: [{ id: 'smoke', name: 'Cursor UI Scripted', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
  });
}
`;

const KEY_SEQUENCES = new Map([
  ['Escape', ['1b']],
  ['ShiftTab', ['1b', '5b', '5a']],
  ['AltEnter', ['1b', '0d']],
  ['CtrlO', ['0f']],
  ['Enter', ['0d']],
]);

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
const tempPaths = [];

function pause(ms) {
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

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  tempPaths.push(dir);
  return dir;
}

function capturePane() {
  return tmux(['capture-pane', '-p', ...PANE_ARGS]);
}

function paneContains(text, literal) {
  return text.split('\n').some((line) => line.includes(literal));
}

function footerLine(text) {
  const lines = text.split('\n').map((line) => line.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines[lines.length - 3] ?? '';
}

function saveCapture(name, text) {
  const file = join(artifactDir, `${name}.txt`);
  writeFileSync(file, text);
  let ansi;
  try {
    ansi = tmux(['capture-pane', '-p', '-e', ...PANE_ARGS]);
  } catch {
    ansi = undefined;
  }
  if (ansi !== undefined) writeFileSync(join(artifactDir, `${name}.ansi.txt`), ansi);
  return file;
}

function predicateFor(step) {
  return (text) => step.expect.every((literal) => paneContains(text, literal)) && (step.reject ?? []).every((literal) => !paneContains(text, literal));
}

function waitFor(step) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let last = capturePane();
  while (Date.now() < deadline) {
    if (predicateFor(step)(last)) return saveCapture(step.capture, last);
    pause(POLL_MS);
    last = capturePane();
  }
  const file = saveCapture(step.capture, last);
  throw new Error(`timed out after ${STEP_TIMEOUT_MS}ms waiting for ${step.name} (last capture ${file})`);
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

function runAction(action) {
  if (action.kind === 'send') sendText(action.text);
  else if (action.kind === 'type') tmux(['send-keys', '-l', ...PANE_ARGS, action.text]);
  else if (action.kind === 'keys') for (const key of action.keys) sendKeys(key);
  else if (action.kind === 'resize') tmux(['resize-window', '-t', SESSION, '-x', String(action.size[0]), '-y', String(action.size[1])]);
  else throw new Error(`unknown action ${action.kind}`);
  pause(180);
}

function cleanup() {
  try {
    tmux(['kill-server']);
  } catch {
    // The server may already be gone.
  }
  for (const dir of tempPaths) rmSync(dir, { recursive: true, force: true });
  tempPaths.length = 0;
}

function seedWorkspace(workspace) {
  writeFileSync(join(workspace, 'README.md'), '# Cursor UI smoke\n\nCURSOR_UI_PLAINTEXT marker line.\n');
  writeFileSync(join(workspace, 'note.txt'), 'alpha\nCURSOR_UI_NOTE\n');
  mkdirSync(join(workspace, 'nested'), { recursive: true });
  writeFileSync(join(workspace, 'nested', 'child.txt'), 'CURSOR_UI_NESTED\n');
  try {
    execFileSync('git', ['init', '-q', '-b', 'smoke-main', workspace]);
  } catch {
    // Branch display is best-effort evidence; a missing git binary is not a failure.
  }
}

function piArgs(scenario, provider) {
  const args = [
    'env',
    `HOME=${shquote(homeDir)}`,
    'PI_OFFLINE=1',
    ...Object.entries(scenario.env ?? {}).map(([name, value]) => `${name}=${shquote(value)}`),
    shquote(piBin),
    ...(scenario.packageLoad ? ['-e', shquote(PKG_ROOT)] : ['--extension', shquote(EXT_MAIN), '--theme', shquote(THEME_FILE), '--use-theme', 'cursor-ui']),
    '--extension',
    shquote(provider),
    '--model',
    'cursor-ui-scripted/smoke',
    '--no-session',
    '-a',
    '-nc',
  ];
  if (scenario.fullscreen) args.push('--tui-mode', 'fullscreen');
  return args;
}

let homeDir = '';
let piBin = '';

function runPrintMode(mode) {
  homeDir = tempDir('pi-cursor-ui-home');
  mkdirSync(join(homeDir, '.pi', 'agent'), { recursive: true });
  writeFileSync(join(homeDir, '.pi', 'agent', 'settings.json'), `${JSON.stringify({ quietStartup: true }, null, 2)}\n`);
  const provider = join(tempDir('pi-cursor-ui-provider'), 'scripted-provider.ts');
  writeFileSync(provider, PROVIDER_SOURCE);
  const common = ['--extension', EXT_MAIN, '--extension', provider, '--model', 'cursor-ui-scripted/smoke', '--no-session', '-a', '-nc'];
  const args = mode === 'rpc' ? ['--mode', 'rpc', ...common] : mode === 'json' ? ['--mode', 'json', ...common, 'say hello'] : ['--print', ...common, 'say hello'];
  const options = { encoding: 'utf8', timeout: 60_000, env: { ...process.env, HOME: homeDir, PI_OFFLINE: '1' } };
  const output = mode === 'rpc' ? execFileSync(piBin, args, { ...options, input: `${JSON.stringify({ id: 'smoke', type: 'prompt', message: 'say hello' })}\n` }) : execFileSync(piBin, args, options);
  const file = saveCapture(`01-${mode}-mode`, output);
  const expected = mode === 'json' ? ['CURSOR_UI_REPLY_OK', '"type":"agent_end"'] : ['CURSOR_UI_REPLY_OK'];
  for (const literal of expected) {
    if (!output.includes(literal)) throw new Error(`${mode} mode output is missing ${literal} (capture ${file})`);
  }
  return [{ step: `${mode} reply`, file }];
}

function runScenario(name) {
  const scenario = SCENARIOS.get(name);
  if (!scenario) throw new Error(`unknown scenario "${name}" (see --list)`);
  if (!existsSync(EXT_MAIN)) throw new Error(`extension entry point not found: ${EXT_MAIN}`);
  piBin = resolvePi();
  if (!have('tmux')) throw new Error('tmux is required for the smoke driver but was not found on PATH');

  artifactDir = join(ARTIFACT_ROOT, name);
  rmSync(artifactDir, { recursive: true, force: true });
  mkdirSync(artifactDir, { recursive: true });

  if (scenario.mode !== undefined) return runPrintMode(scenario.mode);

  homeDir = tempDir('pi-cursor-ui-home');
  mkdirSync(join(homeDir, '.pi', 'agent'), { recursive: true });
  writeFileSync(join(homeDir, '.pi', 'agent', 'settings.json'), `${JSON.stringify({ quietStartup: true }, null, 2)}\n`);
  const workspace = tempDir('pi-cursor-ui-ws');
  const provider = join(tempDir('pi-cursor-ui-provider'), 'scripted-provider.ts');
  writeFileSync(provider, PROVIDER_SOURCE);
  seedWorkspace(workspace);

  const size = scenario.fullscreen ? ['120', '40'] : ['110', '36'];
  tmuxConfig = join(tempDir('pi-cursor-ui-tmux'), 'tmux.conf');
  writeFileSync(tmuxConfig, 'set -g extended-keys on\nset -g extended-keys-format csi-u\nset -g window-size manual\n');
  tmux(['new-session', '-d', '-x', size[0], '-y', size[1], '-s', SESSION, '-c', workspace, `${piArgs(scenario, provider).join(' ')}; echo PI-EXITED-$?; sleep 900`]);

  const captures = [];
  for (const step of scenario.steps) {
    for (const action of step.actions ?? []) runAction(action);
    const file = waitFor(step);
    captures.push({ step: step.name, file });
    if (step.footerDiffersFrom) {
      const previous = readFileSync(join(artifactDir, `${step.footerDiffersFrom}.txt`), 'utf8');
      const before = footerLine(previous);
      const after = footerLine(readFileSync(file, 'utf8'));
      if (before === after) throw new Error(`${step.name}: footer line did not change (${JSON.stringify(after)})`);
    }
  }
  return captures;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) {
    for (const [name, scenario] of SCENARIOS) process.stdout.write(`${name}  ${scenario.description}\n`);
    return 0;
  }
  const all = argv.includes('--all');
  const flag = argv.indexOf('--steps');
  const names = all ? [...SCENARIOS.keys()] : [flag === -1 ? 'idle' : argv[flag + 1]];
  const failures = [];
  for (const name of names) {
    try {
      for (const capture of runScenario(name)) process.stdout.write(`[pass] ${name}: ${capture.step} -> ${capture.file}\n`);
    } catch (error) {
      failures.push(name);
      process.stderr.write(`[fail] ${name}: ${error instanceof Error ? error.message : String(error)}\n`);
    } finally {
      cleanup();
    }
  }
  if (failures.length > 0) {
    process.stderr.write(`smoke failures: ${failures.join(', ')}\n`);
    return 1;
  }
  return 0;
}

process.exitCode = main();
