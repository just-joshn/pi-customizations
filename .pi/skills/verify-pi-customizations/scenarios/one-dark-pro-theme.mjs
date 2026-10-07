import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanupProbes, makeLayout, runIsolatedPi, saveCapture, startProbe, waitForCapture } from './lib/tui-probe.mjs';

const PACKAGE = 'extensions/pi-one-dark-pro-theme';
const ACCENT = '\u001b[38;2;97;175;239m';
const DIM = '\u001b[38;2;107;113;125m';
const USER_MESSAGE_BG = '\u001b[48;2;44;49;60m';
const TOOL_SUCCESS_BG = '\u001b[48;2;32;61;73m';
const BUILT_IN_DARK_ACCENT = '\u001b[38;2;138;190;183m';

function read(path) {
  return readFileSync(path, 'utf8');
}

function readAnsi(path) {
  return read(path.replace(/\.txt$/, '.ansi.txt'));
}

function probeArgs(providerPath, { verbose = false, useTheme = false } = {}) {
  const args = ['--extension', providerPath, '--model', 'smoke/scripted'];
  if (verbose) args.push('--verbose');
  if (useTheme) args.push('--use-theme', 'one-dark-pro-flat');
  return [...args, '--no-session', '-a', '-nc'];
}

function frame(probe, plain) {
  return { plain, ansi: probe.captureAnsi(), ...probe.paneSize() };
}

function openThemePicker(probe) {
  probe.send('/settings');
  probe.type('theme');
  probe.keys('Enter');
  return waitForCapture(probe.capture, 'theme picker', (text) => text.includes('Select a theme') && text.includes('one-dark-pro-flat'), { timeoutMs: 30_000 });
}

function driveInstallRegistration(repoRoot, layout, rawDir, receipts) {
  const installOut = runIsolatedPi(layout, ['install', join(repoRoot, PACKAGE)]);
  const installPath = join(rawDir, 'install.txt');
  writeFileSync(installPath, installOut);
  const listOut = runIsolatedPi(layout, ['list']);
  const listPath = join(rawDir, 'list.txt');
  writeFileSync(listPath, listOut);

  const provider = join(repoRoot, PACKAGE, 'test', 'harness', 'scripted-provider.ts');
  const probe = startProbe({ layout, piArgs: probeArgs(provider) });
  let pickerPath = '';
  try {
    waitForCapture(probe.capture, 'installed idle', (text) => text.includes('scripted'), { timeoutMs: 30_000 });
    pickerPath = saveCapture(rawDir, '01-picker-registered', frame(probe, openThemePicker(probe)));
  } finally {
    probe.stop();
  }
  const installed = installOut.split('\n').find((line) => line.startsWith('Installed')) ?? '';
  const listed = listOut.split('\n').find((line) => line.includes(PACKAGE)) ?? '';
  const pickerLine =
    read(pickerPath)
      .split('\n')
      .find((line) => line.includes('one-dark-pro-flat'))
      ?.trim() ?? '';
  receipts.assertVerdict({
    surfaceId: 'OD-INSTALL-1',
    package: PACKAGE,
    expected: 'pi install of the package registers its theme through the pi.themes glob',
    observed: `install: ${JSON.stringify(installed)}; list: ${JSON.stringify(listed.trim())}; picker row: ${JSON.stringify(pickerLine)}`,
    evidence: pickerPath,
    check: () => {
      assert.match(installOut, /^Installed /m, 'pi install did not report an Installed line');
      assert.ok(listOut.includes(PACKAGE), 'pi list does not show the package');
      assert.ok(pickerLine.includes('one-dark-pro-flat'), 'theme picker does not list one-dark-pro-flat');
    },
  });
}

function driveAppliedTheme(repoRoot, layout, rawDir, receipts) {
  const provider = join(repoRoot, PACKAGE, 'test', 'harness', 'scripted-provider.ts');
  const probe = startProbe({ layout, piArgs: probeArgs(provider, { verbose: true, useTheme: true }) });
  let themedPath = '';
  let pickerPath = '';
  try {
    waitForCapture(probe.captureAnsi, 'themed frame', (text) => text.includes(ACCENT), { timeoutMs: 30_000 });
    probe.send('go');
    waitForCapture(probe.capture, 'scripted reply', (text) => text.includes('Theme smoke complete.'), { timeoutMs: 30_000 });
    themedPath = saveCapture(rawDir, '02-theme-applied', { plain: probe.capture(), ansi: probe.captureAnsi(), ...probe.paneSize() });
    pickerPath = saveCapture(rawDir, '03-theme-selected', frame(probe, openThemePicker(probe)));
  } finally {
    probe.stop();
  }
  const themed = readAnsi(themedPath);
  const pickerLine =
    read(pickerPath)
      .split('\n')
      .find((line) => line.includes('one-dark-pro-flat'))
      ?.trim() ?? '';
  receipts.assertVerdict({
    surfaceId: 'OD-THEME-1',
    package: PACKAGE,
    expected: 'the one-dark-pro-flat theme applies its One Dark Pro Flat dark palette in a real session',
    observed: `accent ${ACCENT} present; dim ${DIM} present; user box ${USER_MESSAGE_BG} present: ${themed.includes(USER_MESSAGE_BG)}; tool surface ${TOOL_SUCCESS_BG} present: ${themed.includes(TOOL_SUCCESS_BG)}; built-in dark accent present: ${themed.includes(BUILT_IN_DARK_ACCENT)}; picker row: ${JSON.stringify(pickerLine)}`,
    evidence: themedPath,
    check: () => {
      assert.ok(themed.includes(ACCENT), 'the one-dark-pro-flat accent never reached the terminal');
      assert.ok(themed.includes(DIM), 'the one-dark-pro-flat dim tier never reached the terminal');
      assert.ok(themed.includes(USER_MESSAGE_BG), 'the one-dark-pro-flat user message box never reached the terminal');
      assert.ok(themed.includes(TOOL_SUCCESS_BG), 'the one-dark-pro-flat tool success surface never reached the terminal');
      assert.ok(!themed.includes(BUILT_IN_DARK_ACCENT), 'the built-in dark accent reached the terminal');
      assert.match(pickerLine, /✓ one-dark-pro-flat/, 'the theme picker does not mark one-dark-pro-flat active');
    },
  });
}

export default async function oneDarkProTheme(context) {
  const { repoRoot, rawDir, receipts, log } = context;
  const layout = makeLayout('one-dark-pro');
  try {
    driveInstallRegistration(repoRoot, layout, rawDir, receipts);
    driveAppliedTheme(repoRoot, layout, rawDir, receipts);
  } finally {
    cleanupProbes();
  }
  log(`✓ ${receipts.receipts().length} one-dark-pro receipts written`);
}
