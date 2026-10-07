import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { captureFrame, capturePane, cleanup, pause, piBinary, requireTmux, runAction, startSession } from '../../../../extensions/pi-tui-skin/scripts/lib/tmux-driver.mjs';
import { runCompositeClosure } from './lib/pi-tui-skin-composite-closure.mjs';
import { saveCapture, waitForCapture } from './lib/tui-probe.mjs';

const ESC = '\u001b';
const TEXT_SGR = `${ESC}[38;2;212;212;216m`;
const RESET_SGR = `${ESC}[39m`;
const FILL_SGR = `${ESC}[38;2;21;21;21m`;
const HEADER_TEXT = 'Pi Coding Agent';
const PLACEHOLDER = '→ Plan, search, build anything';
const FOOTER_MODEL = 'Reference UI Scripted';
const ACTIVITY = '● Running sleep 4 && echo SLOW_MARKER_LATE';

function lines(path) {
  return readFileSync(path, 'utf8').split('\n');
}

function ansiLines(path) {
  return readFileSync(path.replace(/\.txt$/, '.ansi.txt'), 'utf8').split('\n');
}

/** The exact painted header span: two-space indent, the text-role escape, the header text, the theme reset. */
function headerPaint(path) {
  const line = ansiLines(path).find((candidate) => candidate.includes(HEADER_TEXT)) ?? '';
  const start = line.indexOf(HEADER_TEXT);
  if (start === -1) return { present: false, span: '', prefix: '', trailing: '' };
  const end = start + HEADER_TEXT.length;
  return { present: true, span: line.slice(0, end + RESET_SGR.length), prefix: line.slice(0, start), trailing: line.slice(end) };
}

function findRow(path, pattern) {
  return lines(path).find((line) => pattern.test(line)) ?? '';
}

function workingBand(text) {
  return (
    String(text)
      .split('\n')
      .find((line) => line.includes('Working') && /[·•●]/.test(line)) ?? ''
  );
}

function waitFor(label, predicate) {
  return waitForCapture(capturePane, label, predicate);
}

function driveDefaultSession(rawDir, captures) {
  startSession({});
  try {
    waitFor('idle header', (text) => text.includes('Pi Coding Agent'));
    captures.idle = saveCapture(rawDir, '01-idle', captureFrame());

    runAction({ kind: 'send', text: 'run slow' });
    captures.running = saveCapture(rawDir, '02-running', captureFrame(waitFor('activity widget', (text) => text.includes(ACTIVITY))));
    const glyphs = new Set();
    for (let sample = 0; sample < 8; sample += 1) {
      const match = /[·•●]/.exec(workingBand(capturePane()));
      if (match) glyphs.add(match[0]);
      pause(150);
    }
    assert.ok(glyphs.size >= 2, `working indicator sampled only ${[...glyphs].join(',') || 'no'} glyph(s)`);

    runAction({ kind: 'keys', keys: ['Escape'] });
    waitFor('idle after abort', (text) => !text.includes('esc to stop'));
    captures.aborted = saveCapture(rawDir, '03-aborted', captureFrame());

    runAction({ kind: 'resize', size: [24, 8] });
    captures.tiny = saveCapture(rawDir, '04-tiny', captureFrame(waitFor('tiny frame', (text) => text.includes('Reference UI Scripted'))));
    runAction({ kind: 'resize', size: [200, 60] });
    captures.wide = saveCapture(rawDir, '05-wide', captureFrame(waitFor('wide frame', (text) => text.includes('Pi Coding Agent'))));
    runAction({ kind: 'resize', size: [110, 36] });
    waitFor('restored frame', (text) => text.includes(PLACEHOLDER));

    runAction({ kind: 'type', text: 'hello world' });
    captures.typed = saveCapture(rawDir, '06-typed', captureFrame(waitFor('typed composer', (text) => text.includes('→ hello world'))));

    runAction({ kind: 'keys', keys: ['ShiftTab'] });
    captures.thinking = saveCapture(rawDir, '07-thinking', captureFrame(waitFor('thinking row', (text) => text.includes('(shift+tab to cycle)'))));

    runAction({ kind: 'keys', keys: ['CtrlC'] });
    waitFor('empty editor', (text) => text.includes(PLACEHOLDER));
    runAction({ kind: 'send', text: '/settings' });
    runAction({ kind: 'type', text: 'theme' });
    runAction({ kind: 'keys', keys: ['Enter'] });
    captures.picker = saveCapture(rawDir, '08-theme-picker', captureFrame(waitFor('theme picker', (text) => text.includes('Select a theme') && text.includes('tui-skin'))));
  } finally {
    cleanup();
  }
}

function drivePackageSession(rawDir, captures) {
  startSession({ packageLoad: true });
  try {
    waitFor('package idle header', (text) => text.includes('Pi Coding Agent'));
    captures.packageIdle = saveCapture(rawDir, '09-package-idle', captureFrame());
    runAction({ kind: 'send', text: '/settings' });
    runAction({ kind: 'type', text: 'theme' });
    runAction({ kind: 'keys', keys: ['Enter'] });
    captures.packagePicker = saveCapture(rawDir, '10-package-picker', captureFrame(waitFor('package theme picker', (text) => text.includes('✓ tui-skin'))));
  } finally {
    cleanup();
  }
}

function driveNonGitSession(rawDir, captures) {
  startSession({ git: false });
  try {
    waitFor('non-git header', (text) => text.includes('Pi Coding Agent'));
    captures.nonGit = saveCapture(rawDir, '11-non-git', captureFrame());
  } finally {
    cleanup();
  }
}

function driveNoColorSession(rawDir, captures) {
  startSession({ env: { NO_COLOR: '1' } });
  try {
    waitFor('no-color header', (text) => text.includes('Pi Coding Agent'));
    captures.noColor = saveCapture(rawDir, '12-no-color', captureFrame());
  } finally {
    cleanup();
  }
}

function writeThemeReceipt(receipts, captures, rawDir) {
  const header = headerPaint(captures.idle);
  const idleBand = ansiLines(captures.idle).find((line) => line.includes('▄')) ?? '';
  const picker = readFileSync(captures.picker, 'utf8');
  receipts.assertVerdict({
    surfaceId: 'TS-THEME-1',
    package: 'extensions/pi-tui-skin',
    expected: 'session start installs the tui-skin theme, and the theme is selectable as an active entry in the theme list',
    observed: `exact header bytes ${JSON.stringify(header.span)}; composer band carries ${JSON.stringify(FILL_SGR)}: ${idleBand.includes(FILL_SGR)}; picker line: ${JSON.stringify(picker.split('\n').find((line) => line.includes('tui-skin')))}`,
    evidence: rawDir,
    check: () => {
      assert.ok(header.present, `${HEADER_TEXT} not found in the ANSI capture`);
      assert.equal(header.prefix, `  ${TEXT_SGR}`, `header prefix is not two spaces plus the skin text-role escape: ${JSON.stringify(header.prefix)}`);
      assert.ok(header.trailing.startsWith(RESET_SGR), `header text is not closed by the theme reset: ${JSON.stringify(header.trailing)}`);
      assert.ok(idleBand.includes(FILL_SGR), `composer band does not carry the composer fill: ${JSON.stringify(idleBand)}`);
      assert.match(picker, /✓ tui-skin/, 'theme picker does not mark tui-skin active');
    },
  });
}

function writeHeaderReceipt(receipts, captures) {
  receipts.assertVerdict({
    surfaceId: 'TS-UI-2',
    package: 'extensions/pi-tui-skin',
    expected: 'session start renders the "Pi Coding Agent" banner with the pi version and one tip',
    observed: `first three pane rows: ${JSON.stringify(lines(captures.idle).slice(0, 3))}`,
    evidence: captures.idle,
    check: () => {
      const [title, version, tip] = lines(captures.idle);
      assert.equal(title, '  Pi Coding Agent');
      assert.match(version ?? '', /^ {2}v\d+\.\d+\.\d+$/);
      assert.match(tip ?? '', /^ {2}Tip: \S/);
    },
  });
}

function writeFooterReceipt(receipts, captures, rawDir, composite) {
  const full = composite.result('TS-UI-3');
  receipts.assertVerdict({
    surfaceId: 'TS-UI-3',
    package: 'extensions/pi-tui-skin',
    expected: 'Thinking-level row, model + context percentage row, location row',
    observed: `idle model row ${JSON.stringify(findRow(captures.idle, /^ {2}Reference UI Scripted/))}; idle location row ${JSON.stringify(findRow(captures.idle, /^ {2}(\/|~)/))}; cycled mode row ${JSON.stringify(lines(captures.thinking).find((line) => line.includes('shift+tab to cycle')))}; non-git location row ${JSON.stringify(findRow(captures.nonGit, /^ {2}(\/|~)/))}; whole-row composite observation: ${full.detail}`,
    evidence: rawDir,
    check: () => {
      assert.equal(findRow(captures.idle, /^ {2}Reference UI Scripted/), `  ${FOOTER_MODEL}`);
      assert.match(findRow(captures.idle, /^ {2}(\/|~)/), / · smoke-main$/);
      assert.match(lines(captures.thinking).find((line) => line.includes('shift+tab to cycle')) ?? '', /^ {2}\S.* \(shift\+tab to cycle\)$/);
      const nonGit = findRow(captures.nonGit, /^ {2}(\/|~)/);
      assert.ok(!nonGit.includes('smoke-main'), `non-git location row kept a branch: ${JSON.stringify(nonGit)}`);
      assert.match(nonGit, /pi-tui-skin-ws-/, `non-git location row lost the workspace: ${JSON.stringify(nonGit)}`);
      assert.ok(full.ok, full.detail);
    },
  });
}

function writeComposerReceipt(receipts, captures, rawDir, composite) {
  const full = composite.result('TS-UI-4');
  const idle = lines(captures.idle);
  receipts.assertVerdict({
    surfaceId: 'TS-UI-4',
    package: 'extensions/pi-tui-skin',
    expected: 'Custom prompt editor with a working-animation band',
    observed: `idle placeholder row ${JSON.stringify(idle.find((line) => line.includes(PLACEHOLDER)))}; typed row ${JSON.stringify(lines(captures.typed).find((line) => line.includes('hello world')))}; 24x8 row ${JSON.stringify(lines(captures.tiny).find((line) => line.includes('→ Plan')))}; 200x60 row ${JSON.stringify(lines(captures.wide).find((line) => line.includes(PLACEHOLDER)))}; NO_COLOR keeps ${JSON.stringify(lines(captures.noColor).find((line) => line.includes(PLACEHOLDER)))}; whole-row composite observation: ${full.detail}`,
    evidence: rawDir,
    check: () => {
      assert.ok(idle.some((line) => line.includes(PLACEHOLDER)));
      assert.ok(idle.filter((line) => /^ *[▄]{4,} *$/.test(line)).length >= 1, 'no top composer band');
      assert.ok(idle.filter((line) => /^ *[▀]{4,} *$/.test(line)).length >= 1, 'no bottom composer band');
      const typed = lines(captures.typed);
      assert.ok(
        typed.some((line) => line.includes('→ hello world')),
        'typed text is not on the prompt row',
      );
      assert.ok(!typed.some((line) => line.includes(PLACEHOLDER)), 'the placeholder still shows over typed text');
      assert.ok(
        lines(captures.tiny).some((line) => line.includes('→ Plan')),
        '24x8 lost the prompt glyph',
      );
      assert.ok(
        lines(captures.wide).some((line) => line.includes(PLACEHOLDER)),
        '200x60 lost the placeholder',
      );
      const noColor = readFileSync(captures.noColor, 'utf8');
      assert.ok(noColor.includes(PLACEHOLDER), 'NO_COLOR dropped the placeholder');
      assert.ok(full.ok, full.detail);
    },
  });
}

function writeInstallReceipts(receipts, captures, rawDir) {
  const idle = readFileSync(captures.idle, 'utf8');
  receipts.assertVerdict({
    surfaceId: 'TS-EVT-1',
    package: 'extensions/pi-tui-skin',
    expected: 'session_start installs the header, footer, editor, working indicator, and activity widget',
    observed: `idle has header+band+footer; running frame has ${JSON.stringify(workingBand(readFileSync(captures.running, 'utf8')))} and ${JSON.stringify(lines(captures.running).find((line) => line.includes(ACTIVITY)))}; NO_COLOR frame has no ESC byte`,
    evidence: captures.running,
    check: () => {
      assert.ok(idle.includes('Pi Coding Agent') && idle.includes(PLACEHOLDER) && idle.includes(FOOTER_MODEL), 'idle chrome is incomplete');
      const running = readFileSync(captures.running, 'utf8');
      assert.ok(running.includes(ACTIVITY), 'activity widget never showed the running tool');
      assert.match(workingBand(running), /Working/, 'working indicator label missing');
      const noColor = readFileSync(captures.noColor, 'utf8');
      assert.ok(!noColor.includes('\u001b'), 'NO_COLOR pane contains a raw ESC byte');
      assert.ok(!noColor.includes('[38;2;'), 'NO_COLOR pane contains a persisted SGR color');
      assert.ok(noColor.includes('Pi Coding Agent'), 'NO_COLOR pane lost the header');
    },
  });
  receipts.assertVerdict({
    surfaceId: 'TS-INSTALL-1',
    package: 'extensions/pi-tui-skin',
    expected: 'loading the package through its manifest installs the extension and the theme together',
    observed: `package-load exact header bytes ${JSON.stringify(headerPaint(captures.packageIdle).span)}; package picker line ${JSON.stringify(
      readFileSync(captures.packagePicker, 'utf8')
        .split('\n')
        .find((line) => line.includes('tui-skin')),
    )}`,
    evidence: rawDir,
    check: () => {
      const header = headerPaint(captures.packageIdle);
      assert.ok(header.present, `${HEADER_TEXT} not found in the package-load capture`);
      assert.equal(header.prefix, `  ${TEXT_SGR}`, `package load did not paint the header with the skin text role: ${JSON.stringify(header.prefix)}`);
      assert.ok(header.trailing.startsWith(RESET_SGR), `package-load header text is not closed by the theme reset: ${JSON.stringify(header.trailing)}`);
      assert.ok(readFileSync(captures.packageIdle, 'utf8').includes(PLACEHOLDER), 'package load did not install the editor');
      assert.match(readFileSync(captures.packagePicker, 'utf8'), /✓ tui-skin/, 'package load did not register the theme');
    },
  });
}

export default async function piTuiSkinChrome(context) {
  const { rawDir, receipts, log, repoRoot } = context;
  requireTmux();
  piBinary();
  const captures = {};
  try {
    driveDefaultSession(rawDir, captures);
    drivePackageSession(rawDir, captures);
    driveNonGitSession(rawDir, captures);
    driveNoColorSession(rawDir, captures);
  } finally {
    cleanup();
  }
  const composite = runCompositeClosure({ repoRoot, rawDir });
  writeThemeReceipt(receipts, captures, rawDir);
  writeHeaderReceipt(receipts, captures);
  writeFooterReceipt(receipts, captures, rawDir, composite);
  writeComposerReceipt(receipts, captures, rawDir, composite);
  writeInstallReceipts(receipts, captures, rawDir);
  log(`✓ ${receipts.receipts().length} chrome receipts written`);
}
