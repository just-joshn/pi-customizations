#!/usr/bin/env node
// Captures PSTACK-MODE-ONE-MESSAGE-001: select /poteto-mode from the slash menu with
// plain Enter, run one attached turn, then a follow-up ordinary message. Records
// screens so one-message vs sticky chrome can be judged from the real PTY, not a
// self-report. Reuses the recorder stack and journey-helpers waits.
//
// Usage: node scripts/capture-mode-one-message.mjs [--cursor-only|--pi-only]
// Evidence root: parity/evidence/mode-one-message/
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
const evidenceRoot = join(root, 'evidence', 'mode-one-message');
const GEOMETRY = { rows: 36, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const FIRST_TASK = 'Reply with exactly the three words: one message only. Do no other work.';
const FOLLOWUP = 'Reply with exactly the digit 4. Do no other work.';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assistantSaid(lines, phrase) {
  // User echo lines start with /poteto-mode or the follow-up prompt text; require a bare reply line.
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
    customModeChrome: /Custom Mode|Use as Mode/i.test(text),
    piStickyBadge: /👑/.test(text) || /Poteto Mode/i.test(text),
    slashMenuOpen: /→ \/poteto-mode\s+poteto/i.test(text) || (text.includes('/poteto-help') && text.includes('/poteto-mode') && text.includes('→ /')),
    composerHasPoteto: /→ \/poteto-mode\s*$/m.test(text) || /→ \/poteto-mode\s/.test(text),
    followUpReady: /Add a follow-up|^\s*›/m.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
    firstReply: assistantSaid(lines, 'one message only'),
    secondReply: lines.some((line) => line.trim() === '4'),
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'mode-one-message:plain-enter',
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
  });

async function restoreRule(bytes) {
  const backupPath = `${referenceRulePath}.mode-one-message-backup`;
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
  const backupPath = `${referenceRulePath}.mode-one-message-backup`;
  await mkdir(dir, { recursive: true });
  await writeFile(backupPath, ruleBytes);
  const observations = {};
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

    // Plain Enter on the selected slash entry (requirement trigger).
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(800);
    await dumpScreen(attempt, dir, '02-after-plain-enter', GEOMETRY);
    observations.afterPlainEnter = observe(await screenLines(attempt, GEOMETRY));

    attempt.input(Buffer.from(` ${FIRST_TASK}`), 'literal_user');
    await sleep(400);
    await dumpScreen(attempt, dir, '03-before-first-submit', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(3000);
    await dumpScreen(attempt, dir, '04-after-first-submit', GEOMETRY);
    const firstDeadline = Date.now() + 420_000;
    while (Date.now() < firstDeadline) {
      const lines = await screenLines(attempt, GEOMETRY);
      if (assistantSaid(lines, 'one message only') && !/[\u2800-\u28FF]/.test(lines.join('\n'))) break;
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
      if (lines.some((line) => line.trim() === '4') && !/[\u2800-\u28FF]/.test(lines.join('\n'))) break;
      await sleep(400);
    }
    await sleep(1000);
    await dumpScreen(attempt, dir, '07-after-second-turn', GEOMETRY);
    observations.afterSecondTurn = observe(await screenLines(attempt, GEOMETRY));

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
  const backupPath = `${referenceRulePath}.mode-one-message-backup`;
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

    // Same literal user intent as Cursor: /poteto-mode then plain Enter with a task.
    // Plain /poteto-mode is one-message; sticky is /poteto-mode sticky.
    attempt.input(Buffer.from(`/poteto-mode ${FIRST_TASK}`), 'literal_user');
    await sleep(800);
    await dumpScreen(attempt, dir, '01-typed', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(3000);
    await dumpScreen(attempt, dir, '02-after-plain-enter', GEOMETRY);
    observations.afterPlainEnter = observe(await screenLines(attempt, GEOMETRY));
    await waitReplyOrReady(attempt, ['one message only', '👑', 'Poteto Mode', '›'], 420_000);
    await sleep(1500);
    await dumpScreen(attempt, dir, '03-after-first-turn', GEOMETRY);
    observations.afterFirstTurn = observe(await screenLines(attempt, GEOMETRY));

    attempt.input(Buffer.from(FOLLOWUP), 'literal_user');
    await sleep(300);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '04-after-followup-submit', GEOMETRY);
    await waitReplyOrReady(attempt, ['›', ' 4', '\n4\n', '👑'], 300_000);
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
const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
const results = [];
for (const side of sides) {
  const result = side === 'cursor' ? await runCursor(preRule, preDigest) : await runPi(preRule, preDigest);
  results.push(result);
  console.log(JSON.stringify(result));
}
console.log(JSON.stringify({ scenario: 'mode-one-message:plain-enter', fixtureDigest: preDigest, firstTask: FIRST_TASK, followup: FOLLOWUP, results }));
