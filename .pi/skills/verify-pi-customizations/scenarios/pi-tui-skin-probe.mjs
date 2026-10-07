import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROBE_PROVIDER_SOURCE } from './lib/probe-provider.mjs';
import { cleanupProbes, makeLayout, saveCapture, startProbe, waitForCapture } from './lib/tui-probe.mjs';

const PACKAGE = 'extensions/pi-tui-skin';
const PLACEHOLDER = '→ Plan, search, build anything';
const PAIR_WIDGET = '● Running 2 commands';
const POWERSHELL_ROW = '◇ PowerShell Write-Output PROBE_PWSH';

function read(path) {
  return readFileSync(path, 'utf8');
}

function waitFor(probe, label, predicate) {
  return waitForCapture(probe.capture, label, predicate);
}

function probeArgs(repoRoot, providerPath) {
  const pkg = join(repoRoot, PACKAGE);
  return ['--extension', join(pkg, 'src/index.ts'), '--theme', join(pkg, 'themes/tui-skin.json'), '--use-theme', 'tui-skin', '--extension', providerPath, '--model', 'upi-probe/probe', '--no-session', '-a', '-nc'];
}

function drivePowerShell(probe, rawDir) {
  probe.send('powershell row');
  return saveCapture(rawDir, '01-powershell', { plain: waitFor(probe, 'powershell call row', (text) => text.includes(POWERSHELL_ROW)), ansi: probe.captureAnsi(), ...probe.paneSize() });
}

function driveSlowPair(probe, rawDir, captures) {
  probe.send('slow pair');
  captures.widget = saveCapture(rawDir, '02-widget', { plain: waitFor(probe, 'running pair widget', (text) => text.includes(PAIR_WIDGET)), ansi: probe.captureAnsi(), ...probe.paneSize() });
  captures.settled = saveCapture(rawDir, '03-widget-done', {
    plain: waitFor(probe, 'pair settled', (text) => text.includes('PROBE_PAIR_DONE') && text.includes(PLACEHOLDER) && !text.includes('esc to stop')),
    ansi: probe.captureAnsi(),
    ...probe.paneSize(),
  });
}

function driveThinking(probe, rawDir, captures) {
  probe.send('think');
  captures.thinking = saveCapture(rawDir, '04-thinking', {
    plain: waitFor(probe, 'hidden thinking label', (text) => text.includes('PROBE_THINK_DONE') && text.includes(PLACEHOLDER) && !text.includes('esc to stop')),
    ansi: probe.captureAnsi(),
    ...probe.paneSize(),
  });
}

function thinkingLabel(path) {
  return (
    read(path)
      .split('\n')
      .find((line) => /^\s*Thinking\s*$/.test(line)) ?? ''
  );
}

function writePowerShellReceipt(receipts, captures) {
  const powershell = read(captures.powershell);
  const observed = `powershell row ${JSON.stringify(
    powershell
      .split('\n')
      .find((line) => line.includes(POWERSHELL_ROW))
      ?.trim(),
  )}; result row ${JSON.stringify(
    powershell
      .split('\n')
      .find((line) => line.trim().startsWith('Error'))
      ?.trim(),
  )}`;
  const check = () => {
    assert.match(powershell, /◇ PowerShell Write-Output PROBE_PWSH\s*$/m, 'powershell call row is not the custom row');
    assert.ok(!powershell.includes('Unknown tool'), 'pi rejected the powershell call before rendering it');
  };
  try {
    check();
  } catch (error) {
    receipts.write({
      surfaceId: 'TS-RENDER-3',
      package: PACKAGE,
      expected: 'a powershell call renders the custom PowerShell row',
      observed,
      evidence: captures.powershell,
      verdict: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  receipts.write({
    surfaceId: 'TS-RENDER-3',
    package: PACKAGE,
    expected: 'a powershell call renders the custom PowerShell row',
    observed,
    evidence: captures.powershell,
    verdict: 'env-limited',
    reason: 'Pi on darwin ships no powershell tool, so the custom powershell renderer cannot be exercised; the observed row is the unknown-tool fallback',
  });
}

function writeWidgetReceipt(receipts, captures) {
  const widget = read(captures.widget);
  const settled = read(captures.settled);
  receipts.assertVerdict({
    surfaceId: 'TS-UI-6',
    package: PACKAGE,
    expected: 'the activity widget renders a live "Running 2 commands" line for parallel tools',
    observed: `live widget line ${JSON.stringify(
      widget
        .split('\n')
        .find((line) => line.includes(PAIR_WIDGET))
        ?.trim(),
    )}; settled frame still shows the widget: ${settled.includes(PAIR_WIDGET)}`,
    evidence: captures.widget,
    check: () => {
      assert.ok(widget.includes(PAIR_WIDGET), 'activity widget did not count the two running commands');
      assert.ok(widget.includes('◇ Bash sleep 4 && echo PROBE_SLOW_A'), 'first parallel tool row missing');
      assert.ok(widget.includes('◇ Bash sleep 4 && echo PROBE_SLOW_B'), 'second parallel tool row missing');
      assert.ok(!settled.includes(PAIR_WIDGET), 'activity widget survived both tools finishing');
    },
  });
}

function writeThinkingReceipt(receipts, captures) {
  const thinking = read(captures.thinking);
  receipts.assertVerdict({
    surfaceId: 'TS-UI-7',
    package: PACKAGE,
    expected: 'a hidden thinking block renders the collapsed label "Thinking"',
    observed: `label line ${JSON.stringify(thinkingLabel(captures.thinking).trim())}; reply ${JSON.stringify(
      thinking
        .split('\n')
        .find((line) => line.includes('PROBE_THINK_DONE'))
        ?.trim(),
    )}; thinking body visible: ${thinking.includes('PROBE_THINKING_BODY')}`,
    evidence: captures.thinking,
    check: () => {
      assert.match(thinking, /^\s*Thinking\s*$/m, 'collapsed thinking label missing');
      assert.ok(thinking.includes('PROBE_THINK_DONE'), 'thinking turn produced no reply');
      assert.ok(!thinking.includes('PROBE_THINKING_BODY'), 'hidden thinking body leaked into the pane');
    },
  });
}

export default async function piTuiSkinProbe(context) {
  const { repoRoot, rawDir, receipts, log } = context;
  const layout = makeLayout('skin-probe', { hideThinkingBlock: true });
  const providerPath = join(layout.root, 'probe-provider.ts');
  writeFileSync(providerPath, PROBE_PROVIDER_SOURCE);
  const probe = startProbe({ layout, piArgs: probeArgs(repoRoot, providerPath) });
  const captures = {};
  try {
    waitFor(probe, 'idle frame', (text) => text.includes('Pi Coding Agent'));
    captures.powershell = drivePowerShell(probe, rawDir);
    waitFor(probe, 'powershell turn settled', (text) => text.includes('PROBE_PWSH_DONE') && text.includes(PLACEHOLDER) && !text.includes('esc to stop'));
    driveSlowPair(probe, rawDir, captures);
    driveThinking(probe, rawDir, captures);
  } finally {
    cleanupProbes();
  }
  writePowerShellReceipt(receipts, captures);
  writeWidgetReceipt(receipts, captures);
  writeThinkingReceipt(receipts, captures);
  log(`✓ ${receipts.receipts().length} probe receipts written`);
}
