#!/usr/bin/env node
/**
 * F-014 composite rows, verified as whole rows in one real-Pi session.
 *
 * F-014 recorded five rows whose receipts asserted only part of the row text.
 * This scenario adds the missing observations without narrowing the rows:
 * every surface's individual uninstall across two reload cycles, the activity
 * widget line while the agent runs, both footer repaint triggers, a nonzero
 * context percentage, and the working animation inside the custom editor.
 *
 * The checks are pure predicates over the drive observations so the mutation
 * control can evaluate all of them per mutant. The default export below drives
 * the live entrypoint and writes the receipts.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { piBinary, requireTmux } from '../../../../extensions/pi-tui-skin/scripts/lib/tmux-driver.mjs';
import { COMPOSITE_IDLE_PLACEHOLDER, COMPOSITE_MODEL, COMPOSITE_MODEL_ALT, COMPOSITE_MODEL_COMMAND, COMPOSITE_PACKAGE, COMPOSITE_THINKING_HINT, COMPOSITE_WIDGET_LINE, runCompositeSession } from './lib/pi-tui-skin-composite-drive.mjs';

/** The eight cleanup calls `uninstall` issues, each with its reset argument. */
export const COMPOSITE_CLEANUPS = [
  { method: 'setWidget', isReset: (args) => args[0] === 'tui-skin.activity' && (args.length === 1 || args[1] === null) },
  { method: 'setEditorComponent', isReset: (args) => args[0] === null },
  { method: 'setFooter', isReset: (args) => args[0] === null },
  { method: 'setHeader', isReset: (args) => args[0] === null },
  { method: 'setWorkingMessage', isReset: (args) => args.length === 0 },
  { method: 'setWorkingIndicator', isReset: (args) => args.length === 0 },
  { method: 'setWorkingVisible', isReset: (args) => args[0] === true },
  { method: 'setHiddenThinkingLabel', isReset: (args) => args.length === 0 },
];

const QUIT_ERROR_MARKERS = ['presentation cleanup failed', 'TypeError', 'ReferenceError', 'Unhandled', '    at '];
const MODE_ROW = /^ {2}\S.* \(shift\+tab to cycle\)$/;
const MODEL_PERCENT_ROW = /^ {2}Reference UI Scripted · [1-9]\d*%$/;
const LOCATION_ROW = /^ {2}\/\S+\/workspace · \S+$/;

function condition(ok, message) {
  return { ok, message };
}

function outcome(conditions, observed) {
  const failed = conditions.filter((entry) => !entry.ok).map((entry) => entry.message);
  return { ok: failed.length === 0, detail: failed.length === 0 ? observed : failed.join('; ') };
}

function mutateSource(srcDir, relativePath, replace) {
  const file = join(srcDir, relativePath);
  const text = readFileSync(file, 'utf8');
  const next = replace(text);
  if (next === text) throw new Error(`mutation did not change ${relativePath}`);
  writeFileSync(file, next);
}

export const COMPOSITE_MUTATIONS = [
  {
    name: 'cleanup-missing-surface',
    expectFailed: ['TS-EVT-2'],
    apply: (srcDir) => mutateSource(srcDir, 'ui/install-ui.ts', (text) => text.replace("  ['setFooter', (ui) => ui.setFooter(undefined)],\n", '')),
  },
  {
    name: 'cleanup-not-idempotent',
    expectFailed: ['TS-EVT-2'],
    apply: (srcDir) => mutateSource(srcDir, 'ui/install-ui.ts', (text) => text.replace('      if (!installed) return;\n      installed = false;', '      installed = false;')),
  },
  {
    name: 'no-agent-start',
    expectFailed: ['TS-EVT-3'],
    apply: (srcDir) => mutateSource(srcDir, 'lifecycle/register-lifecycle.ts', (text) => text.replace("  pi.on('agent_start', () => {\n    deps.store.setAgentRunning(Date.now());\n  });\n\n", '')),
  },
  {
    name: 'no-activity-widget',
    expectFailed: ['TS-EVT-3'],
    apply: (srcDir) => mutateSource(srcDir, 'ui/install-ui.ts', (text) => text.replace('      installActivityWidget(ctx, store, capture);\n', '')),
  },
  {
    name: 'stale-footer-model',
    expectFailed: ['TS-EVT-7'],
    apply: (srcDir) =>
      mutateSource(srcDir, 'ui/footer.ts', (text) =>
        text
          // biome-ignore lint/security/noSecrets: mutation needles are production source text, not credentials
          .replace('const startingLevel = readThinking(ctx)?.level;', 'const startingLevel = readThinking(ctx)?.level;\n  const startingModel = readModel(ctx);')
          .replace('const model = readModel(ctx);', 'const model = startingModel;'),
      ),
  },
  {
    name: 'no-mode-row',
    expectFailed: ['TS-EVT-7', 'TS-UI-3'],
    apply: (srcDir) => mutateSource(srcDir, 'ui/footer.ts', (text) => text.replace('        if (thinking !== undefined && thinking.level !== startingLevel) {', '        if (false) {')),
  },
  {
    name: 'no-context-percentage',
    expectFailed: ['TS-UI-3'],
    apply: (srcDir) => mutateSource(srcDir, 'ui/footer.ts', (text) => text.replace("if (typeof percent === 'number' && percent > 0) segments.push(", 'if (false) segments.push(')),
  },
  {
    name: 'no-embedded-working-band',
    expectFailed: ['TS-UI-4'],
    apply: (srcDir) => mutateSource(srcDir, 'ui/editor.ts', (text) => text.replace('{ embedWorkingStatus: true, paddingX: PADDING_X }', '{ embedWorkingStatus: false, paddingX: PADDING_X }')),
  },
];

export const COMPOSITE_CHECKS = [
  {
    surfaceId: 'TS-EVT-2',
    expected: 'Uninstalls every surface idempotently',
    evidence: (observations) => observations.rawDir,
    run: (observations) => {
      const starts = observations.observer.filter((record) => record.event === 'session_start');
      const teardowns = observations.observer.filter((record) => record.event === 'session_shutdown');
      const repeats = observations.observer.filter((record) => record.event === 'session_shutdown_repeat');
      const conditions = [condition(starts.length === 3 && teardowns.length === 3 && repeats.length === 3, `expected 3 install/teardown cycles with 3 repeated invocations, saw ${starts.length}/${teardowns.length}/${repeats.length}`)];
      for (const [index, teardown] of teardowns.entries()) {
        for (const cleanup of COMPOSITE_CLEANUPS) {
          const calls = teardown.calls.filter((call) => call.method === cleanup.method && cleanup.isReset(call.args));
          conditions.push(condition(calls.length === 1, `teardown ${index + 1} issued ${calls.length} reset calls for ${cleanup.method}`));
        }
      }
      for (const [index, repeat] of repeats.entries()) {
        conditions.push(condition(repeat.calls.length === 0, `repeated invocation ${index + 1} issued ${repeat.calls.length} cleanup calls`));
        conditions.push(condition(repeat.error === null, `repeated invocation ${index + 1} raised ${JSON.stringify(repeat.error)}`));
      }
      for (const [cycle, count] of Object.entries(observations.headerCounts)) {
        conditions.push(condition(count === 1, `${cycle} frame rendered ${count} headers`));
      }
      conditions.push(condition(observations.frames.reload1.includes(COMPOSITE_IDLE_PLACEHOLDER) && observations.frames.reload2.includes(COMPOSITE_IDLE_PLACEHOLDER), 'a reload frame lost the editor placeholder'));
      conditions.push(condition(observations.quitMarkers.includes('PI-EXITED-0'), `quit frame printed ${JSON.stringify(observations.quitMarkers)}`));
      for (const marker of QUIT_ERROR_MARKERS) {
        conditions.push(condition(!observations.frames.quit.includes(marker), `quit frame contains ${JSON.stringify(marker)}`));
      }
      const observed = `${starts.length} installs and ${teardowns.length} teardowns across two reloads and quit; every teardown issued one reset call for each of ${COMPOSITE_CLEANUPS.length} surfaces (${COMPOSITE_CLEANUPS.map((cleanup) => cleanup.method).join(', ')}); each repeated invocation issued ${repeats.map((repeat) => repeat.calls.length).join('/')} cleanup calls with error ${JSON.stringify(repeats.map((repeat) => repeat.error))}; reload header counts ${JSON.stringify(observations.headerCounts)}; quit markers ${JSON.stringify(observations.quitMarkers)}`;
      return outcome(conditions, observed);
    },
  },
  {
    surfaceId: 'TS-EVT-3',
    expected: 'Marks agent running for the activity widget',
    evidence: (observations) => observations.captures.running,
    run: (observations) => {
      const running = observations.frames.running;
      const settled = observations.frames.settled;
      const conditions = [
        condition(running.includes('esc to stop'), 'running frame lost the live-turn interrupt hint'),
        condition(running.includes(COMPOSITE_WIDGET_LINE), `running frame lost the activity widget line ${JSON.stringify(COMPOSITE_WIDGET_LINE)}`),
        condition(!settled.includes(COMPOSITE_WIDGET_LINE), 'activity widget line survived the settled turn'),
      ];
      const observed = `running frame has live-turn hint: ${running.includes('esc to stop')}; activity widget line ${JSON.stringify(COMPOSITE_WIDGET_LINE)} present: ${running.includes(COMPOSITE_WIDGET_LINE)}; widget line after settle: ${settled.includes(COMPOSITE_WIDGET_LINE)}`;
      return outcome(conditions, observed);
    },
  },
  {
    surfaceId: 'TS-EVT-7',
    expected: 'Repaints footer',
    evidence: (observations) => observations.captures.switched,
    run: (observations) => {
      const { afterTurnModelRow, afterSwitchModelRow, thinkingRow } = observations.footer;
      const conditions = [
        condition(!observations.frames.idle.includes(COMPOSITE_THINKING_HINT), 'mode row was already visible before the thinking change'),
        condition(MODE_ROW.test(thinkingRow), `thinking change did not repaint the mode row, saw ${JSON.stringify(thinkingRow)}`),
        condition(afterTurnModelRow.includes(COMPOSITE_MODEL) && !afterTurnModelRow.includes(COMPOSITE_MODEL_ALT), `footer model row before the change is ${JSON.stringify(afterTurnModelRow)}`),
        condition(afterSwitchModelRow.includes(COMPOSITE_MODEL_ALT), `model change did not repaint the footer, saw ${JSON.stringify(afterSwitchModelRow)}`),
      ];
      const observed = `mode row after shift+tab ${JSON.stringify(thinkingRow)}; model row ${JSON.stringify(afterTurnModelRow)} became ${JSON.stringify(afterSwitchModelRow)} after /model ${COMPOSITE_MODEL_COMMAND}`;
      return outcome(conditions, observed);
    },
  },
  {
    surfaceId: 'TS-UI-3',
    expected: 'Thinking-level row, model + context percentage row, location row',
    evidence: (observations) => observations.captures.settled,
    run: (observations) => {
      const { afterTurnModelRow, thinkingRow, locationRow } = observations.footer;
      const conditions = [
        condition(MODEL_PERCENT_ROW.test(afterTurnModelRow), `model row has no nonzero context percentage, saw ${JSON.stringify(afterTurnModelRow)}`),
        condition(LOCATION_ROW.test(locationRow), `location row is ${JSON.stringify(locationRow)}`),
        condition(MODE_ROW.test(thinkingRow), `thinking-level row is ${JSON.stringify(thinkingRow)}`),
      ];
      const observed = `model row ${JSON.stringify(afterTurnModelRow)}; location row ${JSON.stringify(locationRow)}; thinking-level row ${JSON.stringify(thinkingRow)}`;
      return outcome(conditions, observed);
    },
  },
  {
    surfaceId: 'TS-UI-4',
    expected: 'Custom prompt editor with a working-animation band',
    evidence: (observations) => observations.captures.running,
    run: (observations) => {
      const idleBand = observations.frames.idle.split('\n').find((line) => /^ *[▄]{4,} *$/.test(line)) ?? '';
      const bandGlyphs = observations.band.glyphs;
      const conditions = [
        condition(idleBand.length > 0, 'idle frame has no filled composer band'),
        condition(observations.band.rows.length > 0, 'running frame has no band row carrying the working status'),
        condition(bandGlyphs.length >= 2, `running band showed ${bandGlyphs.length} distinct working glyph(s): ${bandGlyphs.join('') || 'none'}`),
      ];
      const observed = `idle composer band ${JSON.stringify(idleBand.trim())}; running band rows ${JSON.stringify(observations.band.rows)}; distinct glyphs ${JSON.stringify(bandGlyphs)}`;
      return outcome(conditions, observed);
    },
  },
];

export default async function piTuiSkinComposite(context) {
  const { repoRoot, rawDir, receipts, log } = context;
  requireTmux();
  piBinary();
  const observations = runCompositeSession({ repoRoot, rawDir });
  for (const check of COMPOSITE_CHECKS) {
    const result = check.run(observations);
    receipts.assertVerdict({
      surfaceId: check.surfaceId,
      package: COMPOSITE_PACKAGE,
      expected: check.expected,
      observed: result.detail,
      evidence: check.evidence(observations),
      check: () => {
        assert.ok(result.ok, result.detail);
      },
    });
  }
  log(`✓ ${receipts.receipts().length} composite receipts written`);
}
