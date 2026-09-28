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
 *   node scripts/tmux-smoke.mjs --all [--strict] [--no-invariants]
 *   node scripts/tmux-smoke.mjs --fuzz 5 --seed 1
 *
 * Each step runs actions (type, keys, resize), waits for every `expect` literal
 * to appear and every `reject` literal to be absent, then saves the pane. When
 * invariants are on, every capture also runs through `scripts/lib/frame-invariants.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALL_INVARIANTS, checkFrame, splitFrameResults, visibleWidth } from './lib/frame-invariants.mjs';

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
const FUZZ_BUDGET_MS = 90_000;

const IDLE_EXPECT = ['> agent', 'Pi Coding Agent', 'shift+tab to cycle', '/ commands', '@ files', '! shell'];
const idle = { name: 'idle frame', capture: '01-idle', expect: IDLE_EXPECT, chrome: 'top' };
const runTools = { kind: 'send', text: 'run tools' };
const slowTurn = { kind: 'send', text: 'SLOW reply' };
const send = (text) => ({ kind: 'send', text });
const keys = (...names) => ({ kind: 'keys', keys: names });
const resize = (width, height) => ({ kind: 'resize', size: [width, height] });

const SCENARIOS = new Map([
  ['idle', { description: 'boot the skin and confirm the idle frame', steps: [idle] }],
  [
    'prompt',
    {
      description: 'type a prompt and read the scripted reply',
      steps: [idle, { name: 'scripted reply', capture: '02-reply', actions: [send('say hello')], expect: ['CURSOR_UI_REPLY_OK'], chrome: true }],
    },
  ],
  [
    'stream',
    {
      description: 'capture the frame while the scripted reply streams',
      steps: [idle, { name: 'mid stream', capture: '02-streaming', actions: [slowTurn], expect: ['SLOW REPLY STREAMING'], reject: ['CURSOR_UI_REPLY_OK'], chrome: true }],
    },
  ],
  [
    'cancel',
    {
      description: 'escape cancels the streaming reply',
      steps: [
        idle,
        { name: 'streaming', capture: '02-streaming', actions: [slowTurn], expect: ['SLOW ', 'esc to stop'], reject: ['CURSOR_UI_REPLY_OK'], chrome: true },
        {
          name: 'cancelled',
          capture: '03-cancelled',
          actions: [keys('Escape')],
          expect: ['Ask, build, or change anything'],
          reject: ['CURSOR_UI_REPLY_OK', 'esc to stop'],
          chrome: true,
          check: ({ plain }) => {
            if (plain.split('\n').some((line) => line.includes('● Running'))) throw new Error('activity widget still shows a running tool after cancel');
          },
        },
      ],
    },
  ],
  [
    'steer',
    {
      description: 'typing while streaming steers the running turn',
      steps: [
        idle,
        { name: 'streaming', capture: '02-streaming', actions: [slowTurn], expect: ['SLOW ', 'esc to stop'], reject: ['CURSOR_UI_REPLY_OK'], chrome: true },
        {
          name: 'steered',
          capture: '03-steered',
          actions: [{ kind: 'type', text: 'steer now' }, keys('Enter')],
          expect: ['CURSOR_UI_REPLY_OK'],
          reject: ['esc to stop'],
          chrome: true,
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
        { name: 'streaming', capture: '02-streaming', actions: [slowTurn], expect: ['SLOW ', 'esc to stop'], reject: ['CURSOR_UI_REPLY_OK'], chrome: true },
        {
          name: 'follow up',
          capture: '03-followup',
          actions: [{ kind: 'type', text: 'follow up' }, keys('AltEnter')],
          expect: ['follow up'],
          reject: ['CURSOR_UI_FOLLOWUP_DONE'],
          chrome: true,
          check: ({ plain }) => {
            if (editorBlock(plain).some((line) => line.includes('follow up'))) throw new Error('the queued follow-up is still in the editor');
          },
        },
        {
          name: 'submitted',
          capture: '04-followup-submitted',
          expect: ['CURSOR_UI_FOLLOWUP_DONE', '→ Ask, build, or change anything'],
          reject: ['esc to stop'],
          chrome: true,
        },
      ],
    },
  ],
  [
    'thinking',
    {
      description: 'shift+tab cycles the real thinking level in the footer',
      steps: [idle, { name: 'cycled', capture: '02-thinking', actions: [keys('ShiftTab')], expect: ['shift+tab to cycle'], footerDiffersFrom: '01-idle', chrome: true }],
    },
  ],
  [
    'slash',
    {
      description: 'slash opens the command menu',
      steps: [idle, { name: 'slash menu', capture: '02-slash', actions: [{ kind: 'type', text: '/' }], expect: ['Open settings menu', '(1/25)'], chrome: true }],
    },
  ],
  [
    'files',
    {
      description: 'at opens file completion from the workspace',
      steps: [idle, { name: 'file menu', capture: '02-files', actions: [{ kind: 'type', text: '@note' }], expect: ['note.txt'], chrome: true }],
    },
  ],
  [
    'shell',
    {
      description: 'bang runs a shell command in context',
      steps: [idle, { name: 'shell output', capture: '02-shell', actions: [send('!echo CURSOR_UI_SHELL_OK')], expect: ['CURSOR_UI_SHELL_OK'], chrome: true }],
    },
  ],
  [
    'shell-nocontext',
    {
      description: 'double bang runs a shell command outside model context',
      steps: [idle, { name: 'shell output', capture: '02-shell-nocontext', actions: [send('!!echo CURSOR_UI_SHELL_NC_OK')], expect: ['CURSOR_UI_SHELL_NC_OK'], chrome: true }],
    },
  ],
  [
    'tools',
    {
      description: 'one scripted turn per built-in tool row with the opt-in overrides enabled',
      env: { PI_CURSOR_UI_TOOL_OVERRIDES: 'grep,find,ls,powershell', PI_CURSOR_UI_SMOKE_TURN_MS: '700' },
      steps: [
        idle,
        { name: 'read row', capture: '02-tool-read', actions: [runTools], expect: ['Read README.md'], reject: ['◇ Bash echo CURSOR_UI_BASH_OK'], chrome: true },
        { name: 'bash row', capture: '03-tool-bash', expect: ['Bash echo CURSOR_UI_BASH_OK', 'CURSOR_UI_BASH_OK'], reject: ['◇ Write written.txt'], chrome: true },
        { name: 'write row', capture: '04-tool-write', expect: ['Write written.txt'], reject: ['◇ Edit note.txt'], chrome: true },
        { name: 'edit row', capture: '05-tool-edit', expect: ['Edit note.txt'], reject: ['◇ Search "CURSOR_UI"'], chrome: true },
        { name: 'grep row', capture: '06-tool-grep', expect: ['Search "CURSOR_UI"'], reject: ['◇ Find "*.txt"'], chrome: true },
        { name: 'find row', capture: '07-tool-find', expect: ['Find "*.txt"'], reject: ['◇ List .'], chrome: true },
        { name: 'ls row', capture: '08-tool-ls', expect: ['List .'], reject: ['CURSOR_UI_TOOLS_DONE'], chrome: true },
        { name: 'tools done', capture: '09-tool-done', expect: ['CURSOR_UI_TOOLS_DONE'], chrome: true },
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
          actions: [send('run slow')],
          expect: ['Running sleep 4 && echo SLOW_MARKER_LATE'],
          reject: ['CURSOR_UI_SLOW_DONE'],
          chrome: true,
        },
        {
          name: 'finished',
          capture: '03-widget-done',
          expect: ['CURSOR_UI_SLOW_DONE'],
          reject: ['Running sleep 4'],
          chrome: true,
          check: ({ plain }) => {
            if (plain.split('\n').some((line) => line.includes('● Running'))) throw new Error('activity widget still shows a running tool after it finished');
          },
        },
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
        { name: 'tools done', capture: '02-tool-rows', actions: [runTools], expect: ['CURSOR_UI_TOOLS_DONE'], chrome: true },
        { name: 'expanded', capture: '03-expanded', actions: [keys('CtrlO')], expect: ['CURSOR_UI_PLAINTEXT'], chrome: true },
      ],
    },
  ],
  [
    'resize',
    {
      description: 'a resize keeps the frame intact',
      steps: [
        idle,
        { name: 'narrow', capture: '02-narrow', actions: [resize(72, 22)], expect: ['Pi Coding Agent', '/ commands'], chrome: 'top' },
        { name: 'wide', capture: '03-wide', actions: [resize(140, 44)], expect: ['Pi Coding Agent', '@ files'], chrome: 'top' },
      ],
    },
  ],
  [
    'reload',
    {
      description: 'slash reload re-installs the skin',
      steps: [idle, { name: 'reloaded', capture: '02-reloaded', actions: [send('/reload')], expect: ['> agent', 'shift+tab to cycle'], chrome: 'top' }],
    },
  ],
  [
    'fullscreen',
    {
      description: 'the skin loads in fullscreen TUI mode',
      fullscreen: true,
      steps: [{ name: 'fullscreen frame', capture: '01-fullscreen', expect: ['> agent', 'Pi Coding Agent', '/ commands'], chrome: 'top' }],
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

  // --- layout and environment scenarios -------------------------------------------------
  [
    'narrow',
    {
      description: 'a 40x12 idle frame, a tool row, and the resize back to 110x36',
      steps: [
        idle,
        { name: 'narrow idle', capture: '02-narrow', actions: [resize(40, 12)], expect: ['> agent', 'Pi Coding Agent', '/ commands'], chrome: true },
        { name: 'narrow tool row', capture: '03-narrow-tool', actions: [send('one tool')], expect: ['◇ Read README.md', 'CURSOR_UI_ONE_DONE'], chrome: true },
        { name: 'restored', capture: '04-restored', actions: [resize(110, 36)], expect: ['Pi Coding Agent', '→ Ask, build, or change anything'], chrome: 'top' },
      ],
    },
  ],
  [
    'tiny',
    {
      description: 'a 24x8 idle frame renders its chrome',
      steps: [idle, { name: 'tiny idle', capture: '02-tiny', actions: [resize(24, 8)], expect: ['/ commands', '→ Ask'], chrome: true }],
    },
  ],
  [
    'colossus',
    {
      description: 'a 200x60 idle frame and a tool row',
      steps: [
        idle,
        { name: 'colossus idle', capture: '02-colossus', actions: [resize(200, 60)], expect: ['Pi Coding Agent', '→ Ask, build, or change anything'], chrome: 'top' },
        { name: 'colossus tool row', capture: '03-colossus-tool', actions: [send('one tool')], expect: ['◇ Read README.md', 'CURSOR_UI_ONE_DONE'], chrome: true },
      ],
    },
  ],
  [
    'resize-storm',
    {
      description: 'resizes across the ladder while a streaming reply is in flight',
      steps: [
        idle,
        { name: 'streaming', capture: '02-storm-streaming', actions: [slowTurn], expect: ['SLOW ', 'esc to stop'], reject: ['CURSOR_UI_REPLY_OK'], chrome: true },
        { name: 'storm 40x12', capture: '03-storm-40x12', actions: [resize(40, 12)], expect: ['/ commands'], reject: ['Pi Coding Agent'], chrome: true },
        { name: 'storm 200x60', capture: '04-storm-200x60', actions: [resize(200, 60)], expect: ['Pi Coding Agent'], chrome: 'top' },
        { name: 'storm 30x6', capture: '05-storm-30x6', actions: [resize(30, 6)], expect: ['/ commands'], reject: ['Pi Coding Agent'], chrome: true },
        { name: 'storm 110x36', capture: '06-storm-110x36', actions: [resize(110, 36)], expect: ['Pi Coding Agent'], chrome: 'top' },
      ],
    },
  ],
  [
    'error-tool',
    {
      description: 'a scripted tool error renders a red Error row and the agent recovers',
      env: { PI_CURSOR_UI_SMOKE_TURN_MS: '700' },
      steps: [
        idle,
        {
          name: 'error row',
          capture: '02-error',
          actions: [send('error tool')],
          expect: ['◇ Bash echo CURSOR_UI_ERROR_MSG && exit 3', 'Error'],
          reject: ['CURSOR_UI_ERROR_RECOVERED'],
          chrome: true,
          check: ({ plain, ansi }) => {
            const lines = plain.split('\n');
            const index = lines.findIndex((line) => line.includes('Error'));
            if (index === -1) throw new Error('no Error line in the pane');
            const ansiLine = (ansi ?? '').split('\n')[index] ?? '';
            if (!ansiLine.includes('[38;2;224;108;117m')) throw new Error(`Error row is not error red: ${JSON.stringify(ansiLine)}`);
          },
        },
        { name: 'recovered', capture: '03-error-recovered', expect: ['CURSOR_UI_ERROR_RECOVERED', '→ Ask, build, or change anything'], reject: ['Running', 'esc to stop'], chrome: true },
      ],
    },
  ],
  [
    'abort-tool',
    {
      description: 'escape aborts a slow tool and the editor border returns to idle',
      steps: [
        idle,
        {
          name: 'slow tool running',
          capture: '02-abort-running',
          actions: [send('run slow')],
          expect: ['Running sleep 4 && echo SLOW_MARKER_LATE'],
          reject: ['CURSOR_UI_SLOW_DONE'],
          chrome: true,
          check: ({ ansi }) => {
            const ruleRow = (ansi ?? '').split('\n').find((line) => stripAnsi(line).includes(' esc to stop'));
            if (ruleRow === undefined) throw new Error('running editor has no "esc to stop" border');
            if (!ruleRow.includes('[38;2;108;91;157m')) throw new Error(`running border is not borderAccent: ${JSON.stringify(ruleRow)}`);
          },
        },
        {
          name: 'aborted',
          capture: '03-aborted',
          actions: [keys('Escape')],
          expect: ['→ Ask, build, or change anything'],
          reject: ['Running sleep 4', 'esc to stop'],
          chrome: true,
          check: ({ ansi }) => {
            const ruleRow = (ansi ?? '').split('\n').find((line) => line.includes('────'));
            if (ruleRow === undefined) throw new Error('no editor rule row after abort');
            if (!ruleRow.includes('[38;2;62;208;122m')) throw new Error(`idle border is not success green: ${JSON.stringify(ruleRow)}`);
          },
        },
      ],
    },
  ],
  [
    'parallel-tools',
    {
      description: 'two tool calls in one assistant turn both render rows',
      env: { PI_CURSOR_UI_SMOKE_TURN_MS: '700' },
      steps: [
        idle,
        { name: 'first parallel row', capture: '02-parallel', actions: [send('parallel tools')], expect: ['◇ Read README.md'], reject: ['◇ Bash echo CURSOR_UI_PARALLEL_OK'], chrome: true },
        { name: 'both rows', capture: '03-parallel-both', expect: ['◇ Read README.md', '◇ Bash echo CURSOR_UI_PARALLEL_OK'], reject: ['CURSOR_UI_PARALLEL_DONE'], chrome: true },
        { name: 'parallel done', capture: '04-parallel-done', expect: ['CURSOR_UI_PARALLEL_DONE'], chrome: true },
      ],
    },
  ],
  [
    'long-output',
    {
      description: 'a 2000-line result collapses to one row and expands inside the pane',
      env: { PI_CURSOR_UI_SMOKE_TURN_MS: '700' },
      steps: [
        idle,
        {
          name: 'collapsed',
          capture: '02-long-collapsed',
          actions: [send('long output')],
          expect: ['◇ Bash seq 1 2000'],
          reject: ['CURSOR_UI_LONG_DONE'],
          chrome: true,
          check: ({ plain, rows }) => {
            const lines = plain.split('\n');
            const callRows = lines.filter((line) => line.includes('◇ Bash seq 1 2000'));
            if (callRows.length !== 1) throw new Error(`collapsed row count is ${callRows.length}, want 1`);
            const numbered = lines.filter((line) => /^\d+$/.test(line.trim()));
            if (numbered.length !== 0) throw new Error(`collapsed result leaked ${numbered.length} output lines`);
            if (lines.length > rows + 1) throw new Error(`capture has ${lines.length} lines for ${rows} rows`);
          },
        },
        { name: 'long done', capture: '03-long-done', expect: ['CURSOR_UI_LONG_DONE'], chrome: true },
        {
          name: 'expanded',
          capture: '04-long-expanded',
          actions: [keys('CtrlO')],
          expect: ['2000'],
          chrome: true,
          check: ({ plain, rows }) => {
            const lines = plain.split('\n');
            const numbered = lines.filter((line) => /^\d+$/.test(line.trim()));
            if (numbered.length === 0) throw new Error('CtrlO did not expand the 2000-line result');
            if (lines.length > rows + 1) throw new Error(`capture has ${lines.length} lines for ${rows} rows`);
          },
        },
      ],
    },
  ],
  [
    'model-switch',
    {
      description: 'the model picker opens and closes with the frame intact',
      steps: [
        idle,
        { name: 'picker open', capture: '02-model-picker', actions: [send('/model')], expect: ['Cursor UI Scripted'], chrome: true },
        { name: 'picker closed', capture: '03-model-closed', actions: [keys('Escape')], expect: ['> agent', 'Pi Coding Agent', '→ Ask, build, or change anything'], chrome: 'top' },
      ],
    },
  ],
  [
    'theme-switch',
    {
      description: 'the theme picker opens and closes with the frame intact',
      steps: [
        idle,
        { name: 'picker open', capture: '02-theme-picker', actions: [send('/theme')], expect: ['cursor-ui'], chrome: true },
        { name: 'picker closed', capture: '03-theme-closed', actions: [keys('Escape')], expect: ['> agent', 'Pi Coding Agent', '→ Ask, build, or change anything'], chrome: 'top' },
      ],
    },
  ],
  [
    'compact',
    {
      description: 'compact on a short session keeps the frame intact',
      steps: [
        idle,
        { name: 'prompted', capture: '02-compact-prompt', actions: [send('say hello')], expect: ['CURSOR_UI_REPLY_OK'], chrome: true },
        { name: 'compacted', capture: '03-compacted', actions: [send('/compact')], expect: ['> agent', 'Pi Coding Agent', '→ Ask, build, or change anything'], chrome: true, reject: ['TypeError', 'Unhandled'] },
      ],
    },
  ],
  [
    'reload-twice',
    {
      description: 'two reloads leave exactly one header and no stale rows',
      steps: [
        idle,
        { name: 'reload one', capture: '02-reload-1', actions: [send('/reload')], expect: ['> agent', 'Pi Coding Agent'], chrome: 'top' },
        {
          name: 'reload two',
          capture: '03-reload-2',
          actions: [send('/reload')],
          expect: ['> agent', 'Pi Coding Agent'],
          chrome: 'top',
          check: ({ plain }) => {
            const count = plain.split('\n').filter((line) => line.includes('Pi Coding Agent')).length;
            if (count !== 1) throw new Error(`header count is ${count}, want 1`);
          },
        },
      ],
    },
  ],
  [
    'at-accept',
    {
      description: 'selecting a file completion inserts the reference into the editor',
      steps: [
        idle,
        { name: 'file menu', capture: '02-at-menu', actions: [{ kind: 'type', text: '@note' }], expect: ['note.txt'], chrome: true },
        {
          name: 'accepted',
          capture: '03-at-accepted',
          actions: [keys('Tab')],
          expect: ['note.txt'],
          chrome: true,
          check: ({ plain }) => {
            const editor = editorBlock(plain);
            if (!editor.some((line) => line.includes('note.txt'))) throw new Error(`editor did not receive the reference: ${JSON.stringify(editor)}`);
          },
        },
      ],
    },
  ],
  [
    'history-recall',
    {
      description: 'up arrow recalls the last prompt into the editor',
      steps: [
        idle,
        { name: 'sent', capture: '02-history-sent', actions: [send('say hello')], expect: ['CURSOR_UI_REPLY_OK'], chrome: true },
        {
          name: 'recalled',
          capture: '03-history-recall',
          actions: [keys('Up')],
          expect: ['say hello'],
          chrome: true,
          check: ({ plain }) => {
            const editor = editorBlock(plain);
            if (!editor.some((line) => line.includes('say hello'))) throw new Error(`editor did not recall the prompt: ${JSON.stringify(editor)}`);
          },
        },
      ],
    },
  ],
  [
    'no-color',
    {
      description: 'NO_COLOR renders the frame with no escape leak',
      env: { NO_COLOR: '1' },
      steps: [idle, { name: 'no color idle', capture: '02-no-color', expect: ['Pi Coding Agent', '→ Ask, build, or change anything'], chrome: true }],
    },
  ],
  [
    'term-256',
    {
      description: 'TERM=tmux-256color renders the same frame',
      env: { TERM: 'tmux-256color' },
      steps: [idle, { name: 'term 256 idle', capture: '02-term-256', expect: ['> agent', 'Pi Coding Agent', '→ Ask, build, or change anything'], chrome: true }],
    },
  ],
  [
    'non-git',
    {
      description: 'a cwd outside git renders the frame',
      git: false,
      steps: [idle, { name: 'non-git idle', capture: '02-non-git', expect: ['Pi Coding Agent', '→ Ask, build, or change anything'], chrome: true }],
    },
  ],
  [
    'outside-home',
    {
      description: 'a cwd under /tmp with HOME set never renders a broken tilde',
      workspaceRoot: '/tmp',
      steps: [
        idle,
        {
          name: 'outside home',
          capture: '02-outside-home',
          expect: ['Pi Coding Agent', '/tmp'],
          chrome: true,
          check: ({ plain }) => {
            const directory = plain.split('\n')[2] ?? '';
            if (directory.startsWith('~')) throw new Error(`directory line starts with a tilde: ${JSON.stringify(directory)}`);
            if (directory.includes('~/') && directory.length < 3) throw new Error(`directory line is a broken tilde: ${JSON.stringify(directory)}`);
          },
        },
      ],
    },
  ],
  [
    'unicode',
    {
      description: 'a CJK and emoji file read by the read tool stays aligned',
      steps: [
        idle,
        { name: 'unicode row', capture: '02-unicode', actions: [send('read unicode')], expect: ['◇ Read unicode.txt', 'CURSOR_UI_UNICODE_DONE'], chrome: true },
        {
          name: 'unicode expanded',
          capture: '03-unicode-expanded',
          actions: [keys('CtrlO')],
          expect: ['你好世界', '🎉🚀'],
          chrome: true,
          check: ({ plain, cols }) => {
            for (const line of plain.split('\n')) {
              if (visibleWidth(line) > cols) throw new Error(`wide row exceeds cols ${cols}: ${JSON.stringify(line)}`);
              if (line.includes('�')) throw new Error(`wide row contains a replacement character: ${JSON.stringify(line)}`);
            }
          },
        },
      ],
    },
  ],
  [
    'bash-mode',
    {
      description: 'a bang prefix keeps the editor and its border',
      steps: [
        idle,
        {
          name: 'bash mode',
          capture: '02-bash-mode',
          actions: [{ kind: 'type', text: '!' }],
          expect: ['Pi Coding Agent', '! shell'],
          chrome: true,
          check: ({ plain }) => {
            const editor = editorBlock(plain);
            if (!editor.some((line) => line.trim() === '!')) throw new Error(`editor did not enter bash mode: ${JSON.stringify(editor)}`);
          },
        },
      ],
    },
  ],
  [
    'journey',
    {
      description: 'a four-turn session keeps the frame intact through read, edit, grep, and bash',
      env: { PI_CURSOR_UI_TOOL_OVERRIDES: 'grep,find,ls,powershell', PI_CURSOR_UI_SMOKE_TURN_MS: '700' },
      steps: [
        idle,
        { name: 'journey read', capture: '02-journey-read', actions: [send('journey')], expect: ['◇ Read README.md'], reject: ['◇ Edit note.txt'], chrome: true },
        { name: 'journey edit', capture: '03-journey-edit', expect: ['◇ Edit note.txt'], reject: ['◇ Search "CURSOR_UI"'], chrome: true },
        { name: 'journey grep', capture: '04-journey-grep', expect: ['◇ Search "CURSOR_UI"', '1 file edited'], reject: ['◇ Bash echo CURSOR_UI_JOURNEY_BASH'], chrome: true },
        { name: 'journey bash', capture: '05-journey-bash', expect: ['◇ Bash echo CURSOR_UI_JOURNEY_BASH', '1 file edited'], reject: ['CURSOR_UI_JOURNEY_DONE'], chrome: true },
        { name: 'journey done', capture: '06-journey-done', expect: ['CURSOR_UI_JOURNEY_DONE'], chrome: true },
        { name: 'journey expanded', capture: '07-journey-expanded', actions: [keys('CtrlO')], expect: ['CURSOR_UI_PLAINTEXT'], chrome: true },
      ],
    },
  ],
  [
    'quit',
    {
      description: 'ctrl+c exits pi through uninstall with no crash output',
      steps: [
        idle,
        {
          name: 'exited',
          capture: '02-quit',
          // pi's `app.clear` binding clears on the first ctrl+c and exits on the second.
          actions: [keys('CtrlC'), keys('CtrlC')],
          expect: ['PI-EXITED-'],
          reject: ['TypeError', 'ReferenceError', '    at ', 'Unhandled', 'Cannot read propert', 'presentation cleanup step failed'],
          chrome: false,
          exit: true,
          check: ({ plain }) => {
            if (!plain.includes('PI-EXITED-0')) throw new Error(`pi did not exit cleanly: ${JSON.stringify(plain.split('\n').filter((line) => line.includes('PI-EXITED-')))}`);
          },
        },
      ],
    },
  ],
  [
    'reload-mid-turn',
    {
      description: 'a reload during a paced tool turn recovers with one header and no stale activity',
      env: { PI_CURSOR_UI_SMOKE_TURN_MS: '1500' },
      steps: [
        idle,
        {
          name: 'slow tool running',
          capture: '02-reload-mid-running',
          actions: [send('run slow')],
          expect: ['Running sleep 4 && echo SLOW_MARKER_LATE'],
          reject: ['CURSOR_UI_SLOW_DONE'],
          chrome: 'top',
        },
        {
          name: 'reloaded mid turn',
          capture: '03-reload-mid',
          actions: [send('/reload')],
          expect: ['Pi Coding Agent', 'shift+tab to cycle'],
          reject: ['TypeError', 'Unhandled'],
          chrome: 'top',
          check: ({ plain }) => {
            const headers = plain.split('\n').filter((line) => line.includes('Pi Coding Agent')).length;
            if (headers !== 1) throw new Error(`header count after mid-turn reload is ${headers}, want 1`);
          },
        },
        {
          name: 'turn finished',
          capture: '04-reload-mid-done',
          expect: ['CURSOR_UI_SLOW_DONE', '→ Ask, build, or change anything'],
          chrome: 'top',
          check: ({ plain }) => {
            const lines = plain.split('\n');
            const headers = lines.filter((line) => line.includes('Pi Coding Agent')).length;
            if (headers !== 1) throw new Error(`header count after the mid-turn reload finished is ${headers}, want 1`);
            const footers = lines.filter((line) => line.includes('shift+tab to cycle')).length;
            if (footers !== 1) throw new Error(`footer count after the mid-turn reload finished is ${footers}, want 1`);
            if (lines.some((line) => line.includes('● Running'))) throw new Error('a stale activity widget survived the mid-turn reload');
          },
        },
      ],
    },
  ],
]);

const PROVIDER_SOURCE = `import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const READ_README = { type: 'toolCall', id: 'smoke-read', name: 'read', arguments: { path: 'README.md' } };
const READ_UNICODE = { type: 'toolCall', id: 'smoke-unicode', name: 'read', arguments: { path: 'unicode.txt' } };
const EDIT_NOTE = { type: 'toolCall', id: 'smoke-journey-edit', name: 'edit', arguments: { path: 'note.txt', oldText: 'alpha', newText: 'beta' } };
const GREP = { type: 'toolCall', id: 'smoke-journey-grep', name: 'grep', arguments: { pattern: 'CURSOR_UI' } };

const TOOL_TURNS = [
  READ_README,
  { type: 'toolCall', id: 'smoke-bash', name: 'bash', arguments: { command: 'echo CURSOR_UI_BASH_OK' } },
  { type: 'toolCall', id: 'smoke-write', name: 'write', arguments: { path: 'written.txt', content: 'CURSOR_UI_WRITTEN\\n' } },
  { type: 'toolCall', id: 'smoke-edit', name: 'edit', arguments: { path: 'note.txt', oldText: 'alpha', newText: 'beta' } },
  { type: 'toolCall', id: 'smoke-grep', name: 'grep', arguments: { pattern: 'CURSOR_UI' } },
  { type: 'toolCall', id: 'smoke-find', name: 'find', arguments: { pattern: '*.txt' } },
  { type: 'toolCall', id: 'smoke-ls', name: 'ls', arguments: { path: '.' } },
];

const SCRIPTS = [
  { trigger: 'one tool', calls: [READ_README], sequential: true, done: 'CURSOR_UI_ONE_DONE' },
  { trigger: 'error tool', calls: [{ type: 'toolCall', id: 'smoke-error', name: 'bash', arguments: { command: 'echo CURSOR_UI_ERROR_MSG && exit 3' } }], sequential: true, done: 'CURSOR_UI_ERROR_RECOVERED' },
  { trigger: 'parallel tools', calls: [READ_README, { type: 'toolCall', id: 'smoke-parallel', name: 'bash', arguments: { command: 'echo CURSOR_UI_PARALLEL_OK' } }], sequential: false, done: 'CURSOR_UI_PARALLEL_DONE' },
  { trigger: 'long output', calls: [{ type: 'toolCall', id: 'smoke-long', name: 'bash', arguments: { command: 'seq 1 2000' } }], sequential: true, done: 'CURSOR_UI_LONG_DONE' },
  { trigger: 'read unicode', calls: [READ_UNICODE], sequential: true, done: 'CURSOR_UI_UNICODE_DONE' },
  { trigger: 'journey', calls: [READ_README, EDIT_NOTE, GREP, { type: 'toolCall', id: 'smoke-journey-bash', name: 'bash', arguments: { command: 'echo CURSOR_UI_JOURNEY_BASH' } }], sequential: true, done: 'CURSOR_UI_JOURNEY_DONE' },
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
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const transcript = transcriptText(context);
      const toolResults = context.messages.filter((message) => message.role === 'toolResult').length;
      const slow = transcript.includes('SLOW');
      const wantsSlowTool = transcript.includes('run slow') && toolResults === 0;

      let calls = [];
      let text;
      if (wantsSlowTool) {
        calls = [{ type: 'toolCall', id: 'smoke-slow', name: 'bash', arguments: { command: 'sleep 4 && echo SLOW_MARKER_LATE' } }];
      } else if (transcript.includes('run tools')) {
        if (toolResults < TOOL_TURNS.length) calls = [TOOL_TURNS[toolResults]];
        else text = 'CURSOR_UI_TOOLS_DONE';
      } else if (transcript.includes('run slow')) {
        text = 'CURSOR_UI_SLOW_DONE';
      } else {
        const script = SCRIPTS.find((entry) => transcript.includes(entry.trigger));
        const pending = script !== undefined && (script.sequential ? toolResults < script.calls.length : toolResults === 0);
        if (script === undefined) text = 'CURSOR_UI_REPLY_OK';
        else if (pending) calls = script.sequential ? [script.calls[toolResults]] : script.calls;
        else text = script.done;
        if (text === 'CURSOR_UI_REPLY_OK' && transcript.includes('follow up')) text = 'CURSOR_UI_FOLLOWUP_DONE';
      }

      const turnMs = Number(process.env.PI_CURSOR_UI_SMOKE_TURN_MS ?? '0');
      const waitTurn = () => (Number.isFinite(turnMs) && turnMs > 0 ? new Promise((resolve) => setTimeout(resolve, turnMs)) : Promise.resolve());
      (async () => {
        const message = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage: usage(), stopReason: 'pending', timestamp: Date.now() };
        stream.push({ type: 'start', partial: message });
        const aborted = () => options?.signal?.aborted === true;
        const endAborted = () => {
          message.stopReason = 'aborted';
          stream.push({ type: 'done', reason: 'aborted', message });
          stream.end();
        };
        if (calls.length > 0) {
          for (let index = 0; index < calls.length; index++) {
            if (aborted()) return endAborted();
            const call = calls[index];
            message.content.push(call);
            stream.push({ type: 'toolcall_start', contentIndex: index, partial: message });
            await waitTurn();
            if (aborted()) return endAborted();
            stream.push({ type: 'toolcall_end', contentIndex: index, toolCall: call, partial: message });
          }
        } else {
          message.content.push({ type: 'text', text: '' });
          stream.push({ type: 'text_start', contentIndex: 0, partial: message });
          // Pace the text turn too, so a row scenario can see the frame between a tool result and the closing reply.
          await waitTurn();
          if (aborted()) return endAborted();
          const chunks = slow ? ['SLOW ', 'REPLY ', 'STREAMING ', text] : [text];
          for (const chunk of chunks) {
            if (aborted()) return endAborted();
            if (message.content[0].text.endsWith('CURSOR_UI_REPLY_OK')) break;
            message.content[0].text += chunk;
            stream.push({ type: 'text_delta', contentIndex: 0, delta: chunk, partial: message });
            if (slow) await new Promise((resolve) => setTimeout(resolve, 900));
          }
          if (aborted()) return endAborted();
          stream.push({ type: 'text_end', contentIndex: 0, content: message.content[0].text, partial: message });
        }
        if (aborted()) return endAborted();
        await waitTurn();
        if (aborted()) return endAborted();
        message.stopReason = calls.length > 0 ? 'toolUse' : 'stop';
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
  ['Up', ['1b', '5b', '41']],
  ['Tab', ['09']],
  ['CtrlC', ['03']],
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

function captureFrame() {
  const plain = capturePane();
  return { plain, ansi: captureAnsi(), ...paneSize() };
}

function paneContains(text, literal) {
  return text.split('\n').some((line) => line.includes(literal));
}

function footerLine(text) {
  const lines = text.split('\n').map((line) => line.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines[lines.length - 3] ?? '';
}

function isRuleRow(line) {
  return /^─+$/.test(line) || /^─+ esc to stop$/.test(line);
}

function stripAnsi(text) {
  return String(text).replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
}

/** The lines between the last two editor rule rows. */
function editorBlock(plain) {
  const lines = plain.split('\n');
  const rules = lines.flatMap((line, index) => (isRuleRow(line) ? [index] : []));
  if (rules.length < 2) return [];
  const [top, bottom] = rules.slice(-2);
  return lines.slice(top + 1, bottom);
}

function writeCapture(name, frame) {
  const file = join(artifactDir, `${name}.txt`);
  writeFileSync(file, frame.plain);
  if (frame.ansi !== undefined) writeFileSync(join(artifactDir, `${name}.ansi.txt`), frame.ansi);
  return file;
}

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
      const frame = { plain, ansi: captureAnsi(), ...paneSize() };
      const file = writeCapture(step.capture, frame);
      step.check?.({ ...frame, contains: (literal) => paneContains(plain, literal) });
      recordInvariants(run, step, frame, file);
      return { step: step.name, file };
    }
    pause(POLL_MS);
    plain = capturePane();
  }
  const frame = { plain, ansi: captureAnsi(), ...paneSize() };
  const file = writeCapture(step.capture, frame);
  recordInvariants(run, step, frame, file);
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

function seedWorkspace(workspace, scenario) {
  writeFileSync(join(workspace, 'README.md'), '# Cursor UI smoke\n\nCURSOR_UI_PLAINTEXT marker line.\n');
  writeFileSync(join(workspace, 'note.txt'), 'alpha\nCURSOR_UI_NOTE\n');
  // biome-ignore lint/security/noSecrets: fixture content for the unicode scenario, not a secret
  writeFileSync(join(workspace, 'unicode.txt'), 'CURSOR_UI_UNICODE 你好世界 🎉🚀\n第二行：日本語テキスト\n漢字と emoji 🌈 mixed\n');
  mkdirSync(join(workspace, 'nested'), { recursive: true });
  writeFileSync(join(workspace, 'nested', 'child.txt'), 'CURSOR_UI_NESTED\n');
  if (scenario.git === false) return;
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

const TMUX_CONF = 'set -g extended-keys on\nset -g extended-keys-format csi-u\nset -g window-size manual\n';

let homeDir = '';
let piBin = '';

function startSession(scenario) {
  homeDir = tempDir('pi-cursor-ui-home');
  mkdirSync(join(homeDir, '.pi', 'agent'), { recursive: true });
  writeFileSync(join(homeDir, '.pi', 'agent', 'settings.json'), `${JSON.stringify({ quietStartup: true }, null, 2)}\n`);
  const workspace =
    scenario.workspaceRoot === undefined
      ? tempDir('pi-cursor-ui-ws')
      : (() => {
          const dir = mkdtempSync(join(scenario.workspaceRoot, 'pi-cursor-ui-ws-'));
          tempPaths.push(dir);
          return dir;
        })();
  const provider = join(tempDir('pi-cursor-ui-provider'), 'scripted-provider.ts');
  writeFileSync(provider, PROVIDER_SOURCE);
  seedWorkspace(workspace, scenario);

  const size = scenario.fullscreen ? ['120', '40'] : ['110', '36'];
  tmuxConfig = join(tempDir('pi-cursor-ui-tmux'), 'tmux.conf');
  writeFileSync(tmuxConfig, TMUX_CONF);
  tmux(['new-session', '-d', '-x', size[0], '-y', size[1], '-s', SESSION, '-c', workspace, `${piArgs(scenario, provider).join(' ')}; echo PI-EXITED-$?; sleep 900`]);
  return { workspace, provider };
}

function prepareArtifacts(name) {
  artifactDir = join(ARTIFACT_ROOT, name);
  rmSync(artifactDir, { recursive: true, force: true });
  mkdirSync(artifactDir, { recursive: true });
}

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
  const file = writeCapture(`01-${mode}-mode`, { plain: output });
  const expected = mode === 'json' ? ['CURSOR_UI_REPLY_OK', '"type":"agent_end"'] : ['CURSOR_UI_REPLY_OK'];
  for (const literal of expected) {
    if (!output.includes(literal)) throw new Error(`${mode} mode output is missing ${literal} (capture ${file})`);
  }
  return [{ step: `${mode} reply`, file }];
}

function runScenario(name, run) {
  const scenario = SCENARIOS.get(name);
  if (!scenario) throw new Error(`unknown scenario "${name}" (see --list)`);
  if (!existsSync(EXT_MAIN)) throw new Error(`extension entry point not found: ${EXT_MAIN}`);
  piBin = resolvePi();
  if (!have('tmux')) throw new Error('tmux is required for the smoke driver but was not found on PATH');

  prepareArtifacts(name);

  if (scenario.mode !== undefined) return runPrintMode(scenario.mode);

  startSession(scenario);

  const captures = [];
  for (const step of scenario.steps) {
    for (const action of step.actions ?? []) runAction(action);
    const capture = waitFor(step, run);
    captures.push(capture);
    if (step.footerDiffersFrom) {
      const previous = readFileSync(join(artifactDir, `${step.footerDiffersFrom}.txt`), 'utf8');
      const before = footerLine(previous);
      const after = footerLine(readFileSync(capture.file, 'utf8'));
      if (before === after) throw new Error(`${step.name}: footer line did not change (${JSON.stringify(after)})`);
    }
  }
  return captures;
}

// --- seeded fuzz ------------------------------------------------------------------------

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

  piBin = resolvePi();
  startSession({});
  tmux(['resize-window', '-t', SESSION, '-x', String(width), '-y', String(height)]);
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

function runFuzz(count, seed) {
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
