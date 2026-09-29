#!/usr/bin/env node
/**
 * The smoke scenario table.
 *
 * Every scenario the driver can run: a description for `--list`, an optional
 * session mode, environment, and the ordered steps. A step's `check` callback
 * reads the captured pane through `lib/pane-text.mjs`, so the layout rules stay
 * shared with the driver.
 */
import { visibleWidth } from './frame-invariants.mjs';
import { editorBlock, stripAnsi } from './pane-text.mjs';

/** The footer model row the scripted provider always prints; the mode row is absent at the session default. */
const FOOTER_LITERAL = 'Cursor UI Scripted';
const IDLE_EXPECT = ['Pi Coding Agent', 'Tip: ', 'Plan, search, build anything'];
const idle = { name: 'idle frame', capture: '01-idle', expect: IDLE_EXPECT, chrome: 'top' };
const runTools = { kind: 'send', text: 'run tools' };
const slowTurn = { kind: 'send', text: 'SLOW reply' };
const send = (text) => ({ kind: 'send', text });
const keys = (...names) => ({ kind: 'keys', keys: names });
const resize = (width, height) => ({ kind: 'resize', size: [width, height] });

export const SCENARIOS = new Map([
  ['idle', { description: 'boot the skin and confirm the idle frame', steps: [idle] }],
  [
    'typed-composer',
    {
      description: 'typed input keeps the reference prompt glyph and text column',
      steps: [
        idle,
        {
          name: 'typed composer',
          capture: '02-typed',
          actions: [{ kind: 'type', text: 'hello world' }],
          expect: ['→ hello world'],
          chrome: true,
          check: ({ plain }) => {
            const row = plain.split('\n').find((line) => line.includes('hello world')) ?? '';
            if (!/^ {2}→ hello world$/.test(row.trimEnd())) throw new Error(`typed row is ${JSON.stringify(row)}`);
            if (plain.includes('Plan, search, build anything')) throw new Error('the placeholder is still visible over typed text');
          },
        },
      ],
    },
  ],
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
          expect: ['Plan, search, build anything'],
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
          expect: ['CURSOR_UI_FOLLOWUP_DONE', '→ Plan, search, build anything'],
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
        { name: 'narrow', capture: '02-narrow', actions: [resize(72, 22)], expect: ['Pi Coding Agent', FOOTER_LITERAL], chrome: 'top' },
        { name: 'wide', capture: '03-wide', actions: [resize(140, 44)], expect: ['Pi Coding Agent', 'Plan, search, build anything'], chrome: 'top' },
      ],
    },
  ],
  [
    'reload',
    {
      description: 'slash reload re-installs the skin',
      steps: [idle, { name: 'reloaded', capture: '02-reloaded', actions: [send('/reload')], expect: ['Pi Coding Agent', FOOTER_LITERAL], chrome: 'top' }],
    },
  ],
  [
    'fullscreen',
    {
      description: 'the skin loads in fullscreen TUI mode',
      fullscreen: true,
      steps: [{ name: 'fullscreen frame', capture: '01-fullscreen', expect: ['Pi Coding Agent', FOOTER_LITERAL], chrome: 'top' }],
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
        { name: 'narrow idle', capture: '02-narrow', actions: [resize(40, 12)], expect: ['Pi Coding Agent', FOOTER_LITERAL], chrome: true },
        { name: 'narrow tool row', capture: '03-narrow-tool', actions: [send('one tool')], expect: ['◇ Read README.md', 'CURSOR_UI_ONE_DONE'], chrome: true },
        { name: 'restored', capture: '04-restored', actions: [resize(110, 36)], expect: ['Pi Coding Agent', '→ Plan, search, build anything'], chrome: 'top' },
      ],
    },
  ],
  [
    'tiny',
    {
      description: 'a 24x8 idle frame renders its chrome',
      steps: [idle, { name: 'tiny idle', capture: '02-tiny', actions: [resize(24, 8)], expect: ['→ Plan', FOOTER_LITERAL], chrome: true }],
    },
  ],
  [
    'colossus',
    {
      description: 'a 200x60 idle frame and a tool row',
      steps: [
        idle,
        { name: 'colossus idle', capture: '02-colossus', actions: [resize(200, 60)], expect: ['Pi Coding Agent', '→ Plan, search, build anything'], chrome: 'top' },
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
        { name: 'storm 40x12', capture: '03-storm-40x12', actions: [resize(40, 12)], expect: [FOOTER_LITERAL], reject: ['Pi Coding Agent'], chrome: true },
        { name: 'storm 200x60', capture: '04-storm-200x60', actions: [resize(200, 60)], expect: ['Pi Coding Agent'], chrome: 'top' },
        { name: 'storm 30x6', capture: '05-storm-30x6', actions: [resize(30, 6)], expect: [FOOTER_LITERAL], reject: ['Pi Coding Agent'], chrome: true },
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
        { name: 'recovered', capture: '03-error-recovered', expect: ['CURSOR_UI_ERROR_RECOVERED', '→ Plan, search, build anything'], reject: ['Running', 'esc to stop'], chrome: true },
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
            const row = (ansi ?? '').split('\n').find((line) => stripAnsi(line).includes('esc to stop'));
            if (row === undefined) throw new Error('running editor has no "esc to stop" hint');
          },
        },
        {
          name: 'aborted',
          capture: '03-aborted',
          actions: [keys('Escape')],
          expect: ['→ Plan, search, build anything'],
          reject: ['Running sleep 4', 'esc to stop'],
          chrome: true,
          check: ({ ansi }) => {
            const bandRow = (ansi ?? '').split('\n').find((line) => stripAnsi(line).includes('▄▄▄'));
            if (bandRow === undefined) throw new Error('no composer band row after abort');
            if (!bandRow.includes('[38;2;21;21;21m')) throw new Error(`composer band is not the fill role: ${JSON.stringify(bandRow)}`);
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
        { name: 'picker closed', capture: '03-model-closed', actions: [keys('Escape')], expect: ['Pi Coding Agent', '→ Plan, search, build anything'], chrome: 'top' },
      ],
    },
  ],
  [
    'theme-switch',
    {
      description: 'the theme picker opens and closes with the frame intact',
      steps: [
        idle,
        {
          name: 'picker open',
          capture: '02-theme-picker',
          actions: [send('/settings'), { kind: 'type', text: 'theme' }, keys('Enter')],
          expect: ['Select a theme', 'Automatic'],
          chrome: true,
        },
        { name: 'picker closed', capture: '03-theme-closed', actions: [keys('Escape'), keys('Escape')], expect: ['Pi Coding Agent', '→ Plan, search, build anything'], chrome: 'top' },
      ],
    },
  ],
  [
    'theme-switch-spinner',
    {
      description: 'the working frames follow a theme chosen in the settings modal',
      env: { PI_CURSOR_UI_SMOKE_TURN_MS: '700' },
      steps: [
        idle,
        {
          name: 'dark theme selected',
          capture: '02-theme-dark',
          actions: [send('/settings'), { kind: 'type', text: 'theme' }, keys('Enter'), keys('Down'), keys('Enter'), keys('Escape')],
          expect: ['Pi Coding Agent'],
          chrome: 'top',
        },
        {
          name: 'running frames repainted',
          capture: '03-running',
          actions: [send('run slow')],
          expect: ['Working', '● Running sleep 4'],
          chrome: true,
          check: ({ ansi }) => {
            const band = ansi.split('\n').find((line) => line.includes('Working')) ?? '';
            const frame = /38;2;(\d+;\d+;\d+)m[·•●]/.exec(band)?.[1];
            if (frame === undefined) throw new Error(`no spinner frame inside the band row: ${band}`);
            // The built-in dark theme's dim, muted, and success roles.
            const darkFrames = ['102;102;102', '128;128;128', '181;189;104'];
            if (!darkFrames.includes(frame)) throw new Error(`the spinner kept another theme's color: ${frame}`);
          },
        },
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
        { name: 'compacted', capture: '03-compacted', actions: [send('/compact')], expect: ['Pi Coding Agent', '→ Plan, search, build anything'], chrome: true, reject: ['TypeError', 'Unhandled'] },
      ],
    },
  ],
  [
    'reload-twice',
    {
      description: 'two reloads leave exactly one header and no stale rows',
      steps: [
        idle,
        { name: 'reload one', capture: '02-reload-1', actions: [send('/reload')], expect: ['Pi Coding Agent'], chrome: 'top' },
        {
          name: 'reload two',
          capture: '03-reload-2',
          actions: [send('/reload')],
          expect: ['Pi Coding Agent'],
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
      steps: [idle, { name: 'no color idle', capture: '02-no-color', expect: ['Pi Coding Agent', '→ Plan, search, build anything'], chrome: true }],
    },
  ],
  [
    'term-256',
    {
      description: 'TERM=tmux-256color renders the same frame',
      env: { TERM: 'tmux-256color' },
      steps: [idle, { name: 'term 256 idle', capture: '02-term-256', expect: ['Pi Coding Agent', '→ Plan, search, build anything'], chrome: true }],
    },
  ],
  [
    'non-git',
    {
      description: 'a cwd outside git renders the frame',
      git: false,
      steps: [idle, { name: 'non-git idle', capture: '02-non-git', expect: ['Pi Coding Agent', '→ Plan, search, build anything'], chrome: true }],
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
          expect: ['Pi Coding Agent', FOOTER_LITERAL],
          chrome: true,
          check: ({ ansi, plain }) => {
            const editor = editorBlock(plain).map((line) => line.trim());
            if (!editor.includes('→ !')) throw new Error(`editor did not keep the prompt glyph over the bang prefix: ${JSON.stringify(editor)}`);
            const bandColors = [...ansi.matchAll(/38;2;(\d+;\d+;\d+)m[▄▀]/g)].map((match) => match[1]);
            if (!bandColors.includes('215;175;95')) throw new Error(`the band is not in the bash accent: ${[...new Set(bandColors)].join(', ')}`);
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
        { name: 'journey grep', capture: '04-journey-grep', expect: ['◇ Search "CURSOR_UI"', 'Cursor UI Scripted'], reject: ['◇ Bash echo CURSOR_UI_JOURNEY_BASH'], chrome: true },
        { name: 'journey bash', capture: '05-journey-bash', expect: ['◇ Bash echo CURSOR_UI_JOURNEY_BASH', 'Cursor UI Scripted'], reject: ['CURSOR_UI_JOURNEY_DONE'], chrome: true },
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
          expect: ['Pi Coding Agent', FOOTER_LITERAL],
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
          expect: ['CURSOR_UI_SLOW_DONE', '→ Plan, search, build anything'],
          chrome: 'top',
          check: ({ plain }) => {
            const lines = plain.split('\n');
            const headers = lines.filter((line) => line.includes('Pi Coding Agent')).length;
            if (headers !== 1) throw new Error(`header count after the mid-turn reload finished is ${headers}, want 1`);
            const footers = lines.filter((line) => line.includes(FOOTER_LITERAL)).length;
            if (footers !== 1) throw new Error(`footer count after the mid-turn reload finished is ${footers}, want 1`);
            if (lines.some((line) => line.includes('● Running'))) throw new Error('a stale activity widget survived the mid-turn reload');
          },
        },
      ],
    },
  ],
]);
