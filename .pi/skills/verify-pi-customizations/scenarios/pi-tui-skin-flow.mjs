import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { captureFrame, capturePane, cleanup, piBinary, requireTmux, runAction, startSession } from '../../../../extensions/pi-tui-skin/scripts/lib/tmux-driver.mjs';
import { saveCapture, waitForCapture } from './lib/tui-probe.mjs';

const PACKAGE = 'extensions/pi-tui-skin';
const FOOTER_MODEL = 'Reference UI Scripted';
const PLACEHOLDER = '→ Plan, search, build anything';
const SLOW_WIDGET = '● Running sleep 4 && echo SLOW_MARKER_LATE';

const SIMPLE_RENDERERS = [
  ['TS-RENDER-2', 'a bash call renders a custom command row', 'bash', '◇ Bash echo TUI_SKIN_BASH_OK', /^◇ Bash echo TUI_SKIN_BASH_OK\s*$/],
  ['TS-RENDER-5', 'a write call renders a custom row', 'write', '◇ Write written.txt', /^◇ Write written\.txt \(1 line\)\s*$/],
  ['TS-RENDER-6', 'a grep call renders a custom match row', 'grep', '◇ Search "TUI_SKIN"', /^◇ Search "TUI_SKIN"\s*$/],
  ['TS-RENDER-7', 'a find call renders a custom path row', 'find', '◇ Find "*.txt"', /^◇ Find "\*\.txt"\s*$/],
  ['TS-RENDER-8', 'an ls call renders a custom listing row', 'ls', '◇ List .', /^◇ List \.\s*$/],
];

function read(path) {
  return readFileSync(path, 'utf8');
}

function findRow(path, literal) {
  return (
    read(path)
      .split('\n')
      .find((line) => line.includes(literal)) ?? ''
  );
}

function bandRow(path) {
  return (
    read(path)
      .split('\n')
      .find((line) => line.includes('Working')) ?? ''
  );
}

function waitFor(label, predicate) {
  return waitForCapture(capturePane, label, predicate);
}

function driveToolRows(rawDir, captures) {
  runAction({ kind: 'send', text: 'run tools' });
  captures.read = saveCapture(rawDir, '01-read', captureFrame(waitFor('read row', (text) => text.includes('◇ Read README.md'))));
  assert.ok(!read(captures.read).includes('TUI_SKIN_PLAINTEXT'), 'collapsed read row leaked its result body');
  runAction({ kind: 'keys', keys: ['CtrlO'] });
  captures.readExpanded = saveCapture(rawDir, '02-read-expanded', captureFrame(waitFor('expanded read result', (text) => text.includes('TUI_SKIN_PLAINTEXT'))));
  runAction({ kind: 'keys', keys: ['CtrlO'] });
  waitFor('read collapsed again', (text) => !text.includes('TUI_SKIN_PLAINTEXT'));

  captures.bash = saveCapture(rawDir, '03-bash', captureFrame(waitFor('bash row', (text) => text.includes('◇ Bash echo TUI_SKIN_BASH_OK'))));
  captures.write = saveCapture(rawDir, '04-write', captureFrame(waitFor('write row', (text) => text.includes('◇ Write written.txt'))));
  captures.edit = saveCapture(rawDir, '05-edit', captureFrame(waitFor('edit row', (text) => text.includes('◇ Edit note.txt'))));
  runAction({ kind: 'keys', keys: ['CtrlO'] });
  captures.editExpanded = saveCapture(rawDir, '06-edit-expanded', captureFrame(waitFor('expanded edit diff', (text) => text.includes('+1 beta'))));
  runAction({ kind: 'keys', keys: ['CtrlO'] });
  captures.grep = saveCapture(rawDir, '07-grep', captureFrame(waitFor('grep row', (text) => text.includes('◇ Search "TUI_SKIN"'))));
  captures.find = saveCapture(rawDir, '08-find', captureFrame(waitFor('find row', (text) => text.includes('◇ Find "*.txt"'))));
  captures.ls = saveCapture(rawDir, '09-ls', captureFrame(waitFor('ls row', (text) => text.includes('◇ List .'))));
  captures.done = saveCapture(rawDir, '10-done', captureFrame(waitFor('tools done', (text) => text.includes('TUI_SKIN_TOOLS_DONE'))));
}

function driveStreamTurn(rawDir, captures) {
  waitFor('agent idle before the stream', (text) => text.includes(PLACEHOLDER));
  runAction({ kind: 'send', text: 'SLOW reply' });
  captures.streaming = saveCapture(rawDir, '11-streaming', captureFrame(waitFor('mid-stream frame', (text) => text.includes('esc to stop') && text.includes('SLOW ') && !text.includes('TUI_SKIN_REPLY_OK'))));
  runAction({ kind: 'keys', keys: ['Escape'] });
  captures.cancelled = saveCapture(rawDir, '12-cancelled', captureFrame(waitFor('idle after cancel', (text) => text.includes(PLACEHOLDER) && !text.includes('esc to stop'))));
}

function driveSlowTool(rawDir, captures) {
  runAction({ kind: 'send', text: 'run slow' });
  captures.widget = saveCapture(rawDir, '13-widget', captureFrame(waitFor('activity widget', (text) => text.includes(SLOW_WIDGET))));
  captures.settled = saveCapture(rawDir, '14-widget-done', captureFrame(waitFor('slow tool settled', (text) => text.includes('TUI_SKIN_SLOW_DONE') && text.includes(PLACEHOLDER) && !text.includes('esc to stop'))));
}

function driveThinkingReloadQuit(rawDir, captures) {
  runAction({ kind: 'keys', keys: ['ShiftTab'] });
  captures.thinking = saveCapture(rawDir, '15-thinking', captureFrame(waitFor('thinking row', (text) => text.includes('(shift+tab to cycle)'))));
  runAction({ kind: 'send', text: '/reload' });
  captures.reloaded = saveCapture(rawDir, '16-reloaded', captureFrame(waitFor('reloaded frame', (text) => text.includes(PLACEHOLDER))));
  runAction({ kind: 'keys', keys: ['CtrlC'] });
  runAction({ kind: 'keys', keys: ['CtrlC'] });
  captures.quit = saveCapture(rawDir, '17-quit', captureFrame(waitFor('pi exit', (text) => text.includes('PI-EXITED-'))));
}

function driveIdleStreamSlowThinkingQuit(rawDir, captures) {
  waitFor('idle frame', (text) => text.includes('Pi Coding Agent'));
  captures.idle = saveCapture(rawDir, '00-idle', captureFrame());
  driveStreamTurn(rawDir, captures);
  driveSlowTool(rawDir, captures);
  driveThinkingReloadQuit(rawDir, captures);
}

function writeReadReceipt(receipts, captures) {
  receipts.assertVerdict({
    surfaceId: 'TS-RENDER-1',
    package: PACKAGE,
    expected: 'a read call renders a custom call row and ctrl+o expands its custom result body',
    observed: `collapsed row ${JSON.stringify(findRow(captures.read, '◇ Read README.md').trim())}; expanded body ${JSON.stringify(findRow(captures.readExpanded, 'TUI_SKIN_PLAINTEXT').trim())}`,
    evidence: captures.readExpanded,
    check: () => {
      assert.match(findRow(captures.read, '◇ Read README.md'), /^◇ Read README\.md\s*$/, 'read call row is not the custom call row');
      assert.ok(!read(captures.read).includes('TUI_SKIN_PLAINTEXT'), 'collapsed read row leaked its body');
      const expanded = read(captures.readExpanded);
      assert.ok(expanded.includes('TUI_SKIN_PLAINTEXT'), 'ctrl+o did not expand the read body');
      assert.ok(expanded.includes('# Reference UI smoke'), 'expanded read body lost the file content');
    },
  });
}

function writeEditReceipt(receipts, captures) {
  const diffRows = read(captures.editExpanded)
    .split('\n')
    .filter((line) => /^[+-]\d/.test(line.trim()))
    .map((line) => line.trim());
  receipts.assertVerdict({
    surfaceId: 'TS-RENDER-4',
    package: PACKAGE,
    expected: 'an edit call renders a custom call row and a custom diff row',
    observed: `call row ${JSON.stringify(findRow(captures.edit, '◇ Edit note.txt').trim())}; diff rows ${JSON.stringify(diffRows)}`,
    evidence: captures.editExpanded,
    check: () => {
      assert.match(findRow(captures.edit, '◇ Edit note.txt'), /^◇ Edit note\.txt\s*$/, 'edit call row is not the custom row');
      assert.ok(read(captures.editExpanded).includes('-1 alpha'), 'expanded edit lost the removed line');
      assert.ok(read(captures.editExpanded).includes('+1 beta'), 'expanded edit lost the added line');
    },
  });
}

function writeSimpleRowReceipts(receipts, captures, rawDir) {
  const allRows = JSON.stringify(
    read(captures.done)
      .split('\n')
      .filter((line) => line.includes('◇'))
      .map((line) => line.trim()),
  );
  for (const [surfaceId, expected, key, literal, pattern] of SIMPLE_RENDERERS) {
    const row = findRow(captures[key], literal).trim();
    receipts.assertVerdict({
      surfaceId,
      package: PACKAGE,
      expected,
      observed: `row ${JSON.stringify(row)}${surfaceId === 'TS-RENDER-6' ? `; all custom rows ${allRows}` : ''}`,
      evidence: surfaceId === 'TS-RENDER-6' ? rawDir : captures[key],
      check: () => assert.match(row, pattern, `${literal} row is not the custom row`),
    });
  }
}

function writeWorkingIndicatorReceipt(receipts, captures) {
  receipts.assertVerdict({
    surfaceId: 'TS-UI-5',
    package: PACKAGE,
    expected: 'the working indicator animates glyph frames beside the label "Working"',
    observed: `running band ${JSON.stringify(bandRow(captures.widget).trim())}; settled frame has no Working row: ${!read(captures.settled).includes('Working')}`,
    evidence: captures.widget,
    check: () => {
      assert.match(bandRow(captures.widget), /Working/, 'Working label missing while the agent runs');
      assert.match(bandRow(captures.widget), /[·•●]/, 'no working glyph in the band');
      assert.ok(!read(captures.settled).includes('Working'), 'Working label survived the settled turn');
    },
  });
}

function writeAgentLifecycleReceipts(receipts, captures) {
  receipts.assertVerdict({
    surfaceId: 'TS-EVT-3',
    package: PACKAGE,
    expected: 'agent_start marks the agent running so the frame shows a live turn',
    observed: `streaming frame has ${JSON.stringify(
      read(captures.streaming)
        .split('\n')
        .find((line) => line.includes('esc to stop'))
        .trim(),
    )} and band ${JSON.stringify(bandRow(captures.streaming).trim())}`,
    evidence: captures.streaming,
    check: () => {
      const streaming = read(captures.streaming);
      assert.ok(streaming.includes('esc to stop'), 'streaming frame has no interrupt hint');
      assert.ok(streaming.includes('SLOW '), 'streaming frame has no partial reply');
      assert.match(bandRow(captures.streaming), /Working/, 'streaming frame does not show the running state');
    },
  });
  receipts.assertVerdict({
    surfaceId: 'TS-EVT-4',
    package: PACKAGE,
    expected: 'agent_settled marks the agent idle after escape cancels the stream',
    observed: `cancelled frame row ${JSON.stringify(
      read(captures.cancelled)
        .split('\n')
        .find((line) => line.includes(PLACEHOLDER))
        .trim(),
    )}; esc-to-stop present: ${read(captures.cancelled).includes('esc to stop')}; reply marker present: ${read(captures.cancelled).includes('TUI_SKIN_REPLY_OK')}`,
    evidence: captures.cancelled,
    check: () => {
      const cancelled = read(captures.cancelled);
      assert.ok(cancelled.includes(PLACEHOLDER), 'editor did not return to the idle placeholder');
      assert.ok(!cancelled.includes('esc to stop'), 'interrupt hint survived the cancel');
      assert.ok(!cancelled.includes('TUI_SKIN_REPLY_OK'), 'the cancelled reply still completed');
      assert.ok(!cancelled.includes('Working'), 'working indicator survived the cancel');
    },
  });
}

function writeToolHookReceipts(receipts, captures) {
  receipts.assertVerdict({
    surfaceId: 'TS-EVT-5',
    package: PACKAGE,
    expected: 'tool_execution_start adds a live activity row for the running tool',
    observed: `live row ${JSON.stringify(findRow(captures.widget, SLOW_WIDGET).trim())}`,
    evidence: captures.widget,
    check: () => {
      assert.ok(read(captures.widget).includes(SLOW_WIDGET), 'no live activity row for the running bash tool');
    },
  });
  receipts.assertVerdict({
    surfaceId: 'TS-EVT-6',
    package: PACKAGE,
    expected: 'tool_execution_end finishes the activity row and leaves the transcript row',
    observed: `settled frame has ${JSON.stringify(findRow(captures.settled, 'TUI_SKIN_SLOW_DONE').trim())} and live-bound row present: ${read(captures.settled).includes('Running sleep 4')}`,
    evidence: captures.settled,
    check: () => {
      const settled = read(captures.settled);
      assert.ok(settled.includes('TUI_SKIN_SLOW_DONE'), 'slow turn never finished');
      assert.ok(!settled.split('\n').some((line) => line.includes('● Running')), 'live activity row survived the tool end');
    },
  });
}

function writeShutdownReceipts(receipts, captures) {
  receipts.assertVerdict({
    surfaceId: 'TS-EVT-7',
    package: PACKAGE,
    expected: 'a thinking-level change repaints the footer with the mode row',
    observed: `pre-change frame has mode row: ${read(captures.idle).includes('(shift+tab to cycle)')}; cycled row ${JSON.stringify(
      read(captures.thinking)
        .split('\n')
        .find((line) => line.includes('(shift+tab to cycle)'))
        .trim(),
    )}`,
    evidence: captures.thinking,
    check: () => {
      assert.ok(!read(captures.idle).includes('(shift+tab to cycle)'), 'mode row was already visible before the change');
      const cycled = read(captures.thinking);
      assert.match(cycled.split('\n').find((line) => line.includes('(shift+tab to cycle)')) ?? '', /^ {2}\S.* \(shift\+tab to cycle\)$/);
      assert.ok(cycled.includes(FOOTER_MODEL), 'footer model row disappeared after the change');
    },
  });
  receipts.assertVerdict({
    surfaceId: 'TS-EVT-2',
    package: PACKAGE,
    expected: 'session_shutdown uninstalls every surface idempotently with a clean exit',
    observed: `reload header count ${
      read(captures.reloaded)
        .split('\n')
        .filter((line) => line.includes('Pi Coding Agent')).length
    }; quit tail ${JSON.stringify(
      read(captures.quit)
        .split('\n')
        .filter((line) => line.includes('PI-EXITED-')),
    )}`,
    evidence: captures.quit,
    check: () => {
      const reloaded = read(captures.reloaded);
      assert.equal(reloaded.split('\n').filter((line) => line.includes('Pi Coding Agent')).length, 1, 'reload left a duplicate header');
      const quit = read(captures.quit);
      assert.ok(quit.includes('PI-EXITED-0'), `pi did not exit cleanly: ${JSON.stringify(quit.split('\n').filter((line) => line.includes('PI-EXITED-')))}`);
      for (const marker of ['presentation cleanup failed', 'TypeError', 'ReferenceError', 'Unhandled', '    at ']) {
        assert.ok(!quit.includes(marker), `quit output contains ${JSON.stringify(marker)}`);
      }
    },
  });
}

export default async function piTuiSkinFlow(context) {
  const { rawDir, receipts, log } = context;
  requireTmux();
  piBinary();
  const captures = {};
  startSession({ tools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'powershell'], env: { PI_TUI_SKIN_SMOKE_TURN_MS: '800' } });
  try {
    waitFor('idle frame', (text) => text.includes('Pi Coding Agent'));
    driveToolRows(rawDir, captures);
  } finally {
    cleanup();
  }
  startSession({});
  try {
    driveIdleStreamSlowThinkingQuit(rawDir, captures);
  } finally {
    cleanup();
  }
  writeReadReceipt(receipts, captures);
  writeEditReceipt(receipts, captures);
  writeSimpleRowReceipts(receipts, captures, rawDir);
  writeWorkingIndicatorReceipt(receipts, captures);
  writeAgentLifecycleReceipts(receipts, captures);
  writeToolHookReceipts(receipts, captures);
  writeShutdownReceipts(receipts, captures);
  log(`✓ ${receipts.receipts().length} flow receipts written`);
}
