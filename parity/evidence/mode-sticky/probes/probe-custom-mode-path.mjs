#!/usr/bin/env node
// Probe every Meta+Enter byte sequence cursor-agent recognizes, plus flag chrome.
// Owned path for u-cursor-custom-mode-path. Does not edit ledgers.
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { startAttempt } from '../../../recorder/index.mjs';
import { dumpScreen, waitScreen } from '../../../scripts/journey-helpers.mjs';

const root = new URL('../../../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const evidenceRoot = join(root, 'evidence', 'mode-sticky', 'probes');
const GEOMETRY = { rows: 36, cols: 120 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Sequences from cursor-agent 2026.10.01-e373342 1322.index.js meta-enter detector `k`.
const META_ENTER = [
  { name: 'esc-cr', bytes: Buffer.from('\x1b\r') },
  { name: 'esc-lf', bytes: Buffer.from('\x1b\n') },
  { name: 'csi-13-3', bytes: Buffer.from('\x1b[13;3~') },
  { name: 'csi-13-3-bare', bytes: Buffer.from('[13;3~') },
  { name: 'csi-27-3-13', bytes: Buffer.from('\x1b[27;3;13~') },
  { name: 'csi-27-3-13-bare', bytes: Buffer.from('[27;3;13~') },
  { name: 'csi-13-3u', bytes: Buffer.from('\x1b[13;3u') },
  { name: 'csi-13-3u-bare', bytes: Buffer.from('[13;3u') },
];

function observe(lines) {
  const text = lines.join('\n');
  return {
    tipReady: /Tip:/i.test(text),
    slashMenuOpen:
      /→ \/poteto-mode\s+poteto/i.test(text) ||
      (text.includes('/poteto-help') && text.includes('/poteto-mode') && text.includes('→ /')),
    composerHasPoteto: /→ \/poteto-mode\s*$/m.test(text) || /→ \/poteto-mode\s/.test(text),
    modeFooterHint: /option\+enter to use as mode|enter to attach/i.test(text),
    customModeChrome: /Custom Mode|Use as Mode|Mode active|exiting the mode/i.test(text),
    usedSkill: /Used poteto-mode/i.test(text),
  };
}

async function runProbe({ label, extraArgv = [], extraEnv = {} }) {
  const labelDir = join(evidenceRoot, label);
  await mkdir(labelDir, { recursive: true });
  const attempt = await startAttempt({
    root: labelDir,
    side: 'cursor',
    scenarioRef: `cursor-custom-mode-path:${label}`,
    fixtureRef: { path: 'n/a', digest: 'sha256:probe' },
    artifactPaths: [],
    launch: {
      argv: [
        localBin('cursor-agent'),
        ...extraArgv,
        '--plugin-dir',
        join(root, 'reference', 'cursor-plugins', 'pstack'),
        '--plugin-dir',
        join(root, 'reference', 'cursor-plugins', 'cursor-team-kit'),
      ],
      cwd: join(root, 'fixtures', 'first-run'),
      env: {
        TERM: 'xterm-256color',
        HOME: process.env.HOME ?? '',
        PATH: process.env.PATH ?? '',
        ...extraEnv,
      },
    },
    geometry: GEOMETRY,
  });
  const dir = attempt.dir;

  const probes = [];
  try {
    await waitScreen(attempt, GEOMETRY, 'Tip:', 90_000);
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);

    attempt.input(Buffer.from('/poteto-mode'), 'literal_user');
    await sleep(1200);
    await waitScreen(attempt, GEOMETRY, '/poteto-mode', 30_000);
    const menuLines = await dumpScreen(attempt, dir, '01-slash-menu', GEOMETRY);
    const menuObs = observe(menuLines);

    let customMode = false;
    for (const [index, seq] of META_ENTER.entries()) {
      attempt.input(seq.bytes, 'literal_user');
      await sleep(900);
      const screenName = `02-meta-enter-${index}-${seq.name}`;
      const lines = await dumpScreen(attempt, dir, screenName, GEOMETRY);
      const obs = observe(lines);
      probes.push({ sequence: seq.name, hex: seq.bytes.toString('hex'), screen: screenName, ...obs });
      if (obs.customModeChrome) {
        customMode = true;
        break;
      }
      if (!obs.slashMenuOpen && !obs.composerHasPoteto) {
        attempt.input(Buffer.from('/poteto-mode'), 'literal_user');
        await sleep(1200);
        await dumpScreen(attempt, dir, `02b-reopen-after-${seq.name}`, GEOMETRY);
      } else if (!obs.slashMenuOpen && obs.composerHasPoteto) {
        attempt.input(Buffer.from('\x15'), 'literal_user');
        await sleep(200);
        attempt.input(Buffer.from('/poteto-mode'), 'literal_user');
        await sleep(1200);
        await dumpScreen(attempt, dir, `02b-reopen-after-${seq.name}`, GEOMETRY);
      }
    }

    const finalLines = await dumpScreen(attempt, dir, '03-final', GEOMETRY);
    const observations = {
      label,
      menu: menuObs,
      metaEnterProbes: probes,
      customModeReached: customMode,
      final: observe(finalLines),
      note: customMode
        ? 'Custom Mode chrome observed.'
        : 'No Custom Mode chrome after all Meta+Enter sequences recognized by cursor-agent.',
    };
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(labelDir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    return { attemptId: attempt.id, dir, labelDir, observations };
  } finally {
    await attempt.cancel().catch(() => {});
    await attempt.done().catch(() => {});
  }
}

const results = [];
results.push(await runProbe({ label: 'baseline-meta-enter' }));

// Production builds set constants.Cu=false, so overrides are ignored. Still measure.
results.push(
  await runProbe({
    label: 'statsig-override-glass-custom-modes',
    extraArgv: ['--statsig-overrides', JSON.stringify({ featureFlags: { glass_custom_modes: true } })],
  }),
);

const summary = {
  schema: 1,
  scenarioRef: 'cursor-custom-mode-path',
  results: results.map((r) => ({
    label: r.observations.label,
    attemptId: r.attemptId,
    attemptDir: r.dir,
    customModeReached: r.observations.customModeReached,
    modeFooterHint: r.observations.menu.modeFooterHint,
    sequencesTried: r.observations.metaEnterProbes.map((p) => ({
      name: p.sequence,
      hex: p.hex,
      customModeChrome: p.customModeChrome,
      slashMenuOpen: p.slashMenuOpen,
      modeFooterHint: p.modeFooterHint,
    })),
  })),
};
await writeFile(join(evidenceRoot, 'probe-custom-mode-path-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
