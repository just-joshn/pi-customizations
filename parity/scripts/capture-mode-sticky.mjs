#!/usr/bin/env node
// Captures PSTACK-MODE-STICKY-001: Pi `/poteto-mode sticky <task>` plus follow-up,
// and Cursor slash-menu Option+Enter (`\x1b\r` / siblings) toward Custom Mode.
// Screens are the oracle. Reuses recorder + journey-helpers.
//
// Usage: node scripts/capture-mode-sticky.mjs [--cursor-only|--pi-only]
// Evidence root: parity/evidence/mode-sticky/
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitScreen } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'mode-sticky');
const GEOMETRY = { rows: 36, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const FIRST_TASK = 'Reply with exactly the three words: sticky mode on. Do no other work.';
const FOLLOWUP = 'Reply with exactly the digit 7. Do no other work.';
// Documented Option+Enter for Cursor terminal setup; prior probes also tried these.
const CURSOR_OPTION_ENTER_SEQUENCES = [
  { name: 'esc-cr', bytes: Buffer.from('\x1b\r') },
  { name: 'esc-lf', bytes: Buffer.from('\x1b\n') },
  { name: 'csi-27-13', bytes: Buffer.from('\x1b[27;3;13~') },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assistantSaid(lines, phrase) {
  const needle = phrase.toLowerCase();
  return lines.some((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('/') || trimmed.startsWith('→') || trimmed.startsWith('│')) return false;
    if (/Reply with exactly/i.test(trimmed)) return false;
    return trimmed.toLowerCase() === needle || trimmed.toLowerCase().includes(needle);
  });
}

function observe(lines) {
  const text = lines.join('\n');
  return {
    usedSkill: /Used poteto-mode/i.test(text),
    usedAny: /Used [a-z0-9-]+/i.test(text),
    customModeChrome: /Custom Mode|Use as Mode|Mode active|exiting the mode/i.test(text),
    piStickyBadge: /👑/.test(text) || /Poteto Mode/i.test(text),
    slashMenuOpen: /→ \/poteto-mode\s+poteto/i.test(text) || (text.includes('/poteto-help') && text.includes('/poteto-mode') && text.includes('→ /')),
    composerHasPoteto: /→ \/poteto-mode\s*$/m.test(text) || /→ \/poteto-mode\s/.test(text),
    followUpReady: /Add a follow-up|^\s*›/m.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
    firstReply: assistantSaid(lines, 'sticky mode on'),
    secondReply: lines.some((line) => line.replace(/[┃│]/g, '').trim() === '7'),
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath, scenarioRef }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef,
    fixtureRef: { path: fixturePath, digest: fixtureDigest },
    artifactPaths: [],
    launch: { argv, cwd, env },
    geometry: GEOMETRY,
  };
}

const cursorSpec = (fixtureDigest) =>
  spec({
    side: 'cursor',
    cwd: join(root, 'fixtures', 'first-run'),
    argv: [
      localBin('cursor-agent'),
      '--plugin-dir',
      join(root, 'reference', 'cursor-plugins', 'pstack'),
      '--plugin-dir',
      join(root, 'reference', 'cursor-plugins', 'cursor-team-kit'),
    ],
    env: { TERM: 'xterm-256color', HOME: process.env.HOME ?? '', PATH: process.env.PATH ?? '' },
    fixtureDigest,
    fixturePath: referenceRulePath,
    scenarioRef: 'mode-sticky:option-enter',
  });

const piSpec = (fixtureDigest) =>
  spec({
    side: 'pi',
    cwd: join(root, 'fixtures', 'first-run'),
    argv: [localBin('pi'), '--model', 'claude-subscription/claude-sonnet-5-5:medium'],
    env: {
      TERM: 'xterm-256color',
      HOME: process.env.HOME ?? '',
      PATH: process.env.PATH ?? '',
      PI_CODING_AGENT_DIR: piAgentDir,
    },
    fixtureDigest,
    fixturePath: piRulePath,
    scenarioRef: 'mode-sticky:poteto-mode-sticky',
  });

async function restoreRule(bytes) {
  const backupPath = `${referenceRulePath}.mode-sticky-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function waitReplyOrReady(attempt, needles, timeoutMs) {
  try {
    return await waitEither(attempt, GEOMETRY, needles, timeoutMs);
  } catch (error) {
    const lines = await screenLines(attempt, GEOMETRY);
    return { timedOut: true, message: error.message, lines };
  }
}

async function runCursor(ruleBytes, ruleDigest) {
  const side = 'cursor';
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.mode-sticky-backup`;
  await mkdir(dir, { recursive: true });
  await writeFile(backupPath, ruleBytes);
  const observations = {};
  const optionEnterProbes = [];
  let attempt;
  try {
    await writeFile(referenceRulePath, ruleBytes);
    attempt = await startAttempt(await cursorSpec(ruleDigest));
    await waitScreen(attempt, GEOMETRY, 'Tip:', 90_000);
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);
    observations.ready = observe(await screenLines(attempt, GEOMETRY));

    attempt.input(Buffer.from('/poteto-mode'), 'literal_user');
    await sleep(1200);
    await waitScreen(attempt, GEOMETRY, '/poteto-mode', 30_000);
    await dumpScreen(attempt, dir, '01-slash-menu', GEOMETRY);
    observations.slashMenu = observe(await screenLines(attempt, GEOMETRY));

    let customMode = false;
    for (const [index, seq] of CURSOR_OPTION_ENTER_SEQUENCES.entries()) {
      attempt.input(seq.bytes, 'literal_user');
      await sleep(900);
      const screenName = `02-option-enter-${index}-${seq.name}`;
      await dumpScreen(attempt, dir, screenName, GEOMETRY);
      const obs = observe(await screenLines(attempt, GEOMETRY));
      optionEnterProbes.push({ sequence: seq.name, hex: seq.bytes.toString('hex'), screen: screenName, ...obs });
      if (obs.customModeChrome) {
        customMode = true;
        break;
      }
      // Re-open slash menu if the sequence cleared or dirtied the composer without Custom Mode.
      if (!obs.slashMenuOpen && !obs.composerHasPoteto) {
        attempt.input(Buffer.from('/poteto-mode'), 'literal_user');
        await sleep(1200);
        await dumpScreen(attempt, dir, `02b-reopen-after-${seq.name}`, GEOMETRY);
      } else if (!obs.slashMenuOpen && obs.composerHasPoteto) {
        // Composer still has /poteto-mode; try to reopen menu with another slash fragment.
        attempt.input(Buffer.from('\x15'), 'literal_user'); // Ctrl+U clear line if supported
        await sleep(200);
        attempt.input(Buffer.from('/poteto-mode'), 'literal_user');
        await sleep(1200);
        await dumpScreen(attempt, dir, `02b-reopen-after-${seq.name}`, GEOMETRY);
      }
    }
    observations.optionEnterProbes = optionEnterProbes;
    observations.afterOptionEnter = optionEnterProbes.at(-1) ?? null;
    observations.customModeReached = customMode;

    if (customMode) {
      attempt.input(Buffer.from(` ${FIRST_TASK}`), 'literal_user');
      await sleep(400);
      await dumpScreen(attempt, dir, '03-before-first-submit', GEOMETRY);
      attempt.input(Buffer.from('\r'), 'literal_user');
      await sleep(3000);
      await dumpScreen(attempt, dir, '04-after-first-submit', GEOMETRY);
      const firstDeadline = Date.now() + 420_000;
      while (Date.now() < firstDeadline) {
        const lines = await screenLines(attempt, GEOMETRY);
        if (assistantSaid(lines, 'sticky mode on') && !/[\u2800-\u28FF]/.test(lines.join('\n'))) break;
        await sleep(400);
      }
      await sleep(1000);
      await dumpScreen(attempt, dir, '05-after-first-turn', GEOMETRY);
      observations.afterFirstTurn = observe(await screenLines(attempt, GEOMETRY));

      attempt.input(Buffer.from(FOLLOWUP), 'literal_user');
      await sleep(300);
      attempt.input(Buffer.from('\r'), 'literal_user');
      await sleep(2000);
      await dumpScreen(attempt, dir, '06-after-followup-submit', GEOMETRY);
      const secondDeadline = Date.now() + 300_000;
      while (Date.now() < secondDeadline) {
        const lines = await screenLines(attempt, GEOMETRY);
        if (lines.some((line) => line.trim() === '7') && !/[\u2800-\u28FF]/.test(lines.join('\n'))) break;
        await sleep(400);
      }
      await sleep(1000);
      await dumpScreen(attempt, dir, '07-after-second-turn', GEOMETRY);
      observations.afterSecondTurn = observe(await screenLines(attempt, GEOMETRY));
    } else {
      await dumpScreen(attempt, dir, '03-harness-limitation', GEOMETRY);
      observations.harnessLimitation =
        'No tested Option+Enter / Alt+Enter byte sequence selected Custom Mode from the slash menu in this PTY harness.';
    }

    const after = await readFile(referenceRulePath, 'utf8');
    const afterDigest = await sha256(referenceRulePath);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      ruleUnchanged: afterDigest === ruleDigest,
      afterDigest,
      fixtureDigest: ruleDigest,
      observations,
    };
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
    await restoreRule(ruleBytes);
  }
}

async function runPi(ruleBytes, ruleDigest) {
  const side = 'pi';
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.mode-sticky-backup`;
  await mkdir(dir, { recursive: true });
  await writeFile(backupPath, ruleBytes);
  const observations = {};
  let attempt;
  try {
    await writeFile(piRulePath, ruleBytes);
    attempt = await startAttempt(await piSpec(ruleDigest));
    await waitScreen(attempt, GEOMETRY, 'first-run', 120_000);
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);
    observations.ready = observe(await screenLines(attempt, GEOMETRY));

    attempt.input(Buffer.from(`/poteto-mode sticky ${FIRST_TASK}`), 'literal_user');
    await sleep(800);
    await dumpScreen(attempt, dir, '01-typed', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(3000);
    await dumpScreen(attempt, dir, '02-after-sticky-submit', GEOMETRY);
    observations.afterStickySubmit = observe(await screenLines(attempt, GEOMETRY));
    await waitReplyOrReady(attempt, ['sticky mode on', '👑', 'Poteto Mode', '›'], 420_000);
    await sleep(1500);
    await dumpScreen(attempt, dir, '03-after-first-turn', GEOMETRY);
    observations.afterFirstTurn = observe(await screenLines(attempt, GEOMETRY));

    attempt.input(Buffer.from(FOLLOWUP), 'literal_user');
    await sleep(300);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '04-after-followup-submit', GEOMETRY);
    await waitReplyOrReady(attempt, ['›', ' 7', '\n7\n', '👑', 'Poteto Mode'], 300_000);
    await sleep(1500);
    await dumpScreen(attempt, dir, '05-after-second-turn', GEOMETRY);
    observations.afterSecondTurn = observe(await screenLines(attempt, GEOMETRY));

    const after = await readFile(piRulePath, 'utf8');
    const afterDigest = await sha256(piRulePath);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      ruleUnchanged: afterDigest === ruleDigest,
      afterDigest,
      fixtureDigest: ruleDigest,
      observations,
    };
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
    await restoreRule(ruleBytes);
  }
}

const preRule = await readFile(referenceRulePath, 'utf8');
const preDigest = await sha256(referenceRulePath);
if (preDigest !== LOCKED_FIXTURE_DIGEST) {
  console.error(`Reference rule digest ${preDigest} does not match the locked fixture ${LOCKED_FIXTURE_DIGEST}`);
  process.exit(1);
}
await mkdir(evidenceRoot, { recursive: true });
const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
const results = [];
for (const side of sides) {
  const result = side === 'cursor' ? await runCursor(preRule, preDigest) : await runPi(preRule, preDigest);
  results.push(result);
  console.log(JSON.stringify(result));
}
console.log(
  JSON.stringify({
    scenario: 'mode-sticky',
    fixtureDigest: preDigest,
    firstTask: FIRST_TASK,
    followup: FOLLOWUP,
    cursorOptionEnterSequences: CURSOR_OPTION_ENTER_SEQUENCES.map((s) => ({ name: s.name, hex: s.bytes.toString('hex') })),
    results,
  }),
);
