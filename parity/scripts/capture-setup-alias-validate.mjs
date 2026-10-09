#!/usr/bin/env node
// Captures alias acceptance + unavailable-slug validate for
// PSTACK-SETUP-ALIAS-ALWAYS-VALID-001 and PSTACK-SETUP-VALIDATE-001.
// Real PTY both sides. Restores the locked reference rule.
//
// Usage: node scripts/capture-setup-alias-validate.mjs [--cursor-only|--pi-only]
// Evidence root: parity/evidence/setup-alias-validate/
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitScreen, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'setup-alias-validate');
const GEOMETRY = { rows: 36, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const UNAVAILABLE_SLUG = 'parity-unavailable-model-zzz';
const MUTATE_ROLE = 'bug-fix';
const KEEP_ALIAS_ROLE = 'feature, refactoring';
const KEEP_ALIAS_VALUE = 'inherit-parent';
const AUTO_ROLE = 'perf-issue';
const AUTO_VALUE = 'auto';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function digestBytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function parseRoles(ruleText) {
  const roles = {};
  for (const line of ruleText.split('\n')) {
    const match = line.match(/^([^:#]+):\s*(.+)$/);
    if (!match) continue;
    const key = match[1].trim();
    if (key === 'description' || key === 'alwaysApply') continue;
    roles[key] = match[2].trim();
  }
  return roles;
}

function buildAliasFixture(lockedBytes) {
  const lines = lockedBytes.split('\n').map((line) => {
    if (line.startsWith(`${AUTO_ROLE}:`)) return `${AUTO_ROLE}: ${AUTO_VALUE}`;
    if (line.startsWith(`${MUTATE_ROLE}:`)) return `${MUTATE_ROLE}: inherit-parent`;
    return line;
  });
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

function observeScreen(lines) {
  const text = lines.join('\n');
  return {
    writeCard: /Edited pstack-models\.mdc/i.test(text),
    askQuestion: /› \[/.test(text) || /Clarifying Questions/i.test(text),
    chatForm: /Reply with a number|Reply with one of those four labels|Pick a budget:/i.test(text),
    unavailableMention: new RegExp(UNAVAILABLE_SLUG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text),
    unavailableRejected:
      /Unavailable model/i.test(text) ||
      /not (in|among) the (detected|available)/i.test(text) ||
      /not available/i.test(text) ||
      /stop and ask/i.test(text) ||
      /ask again/i.test(text) ||
      /choose again/i.test(text) ||
      /needs? a choice/i.test(text) ||
      /invalid model/i.test(text),
    aliasMention: /inherit-parent/i.test(text) || /\bauto\b/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function scoreRule(beforeText, afterText) {
  const before = parseRoles(beforeText);
  const after = parseRoles(afterText);
  const afterValues = Object.values(after);
  const unavailablePersisted = afterValues.some((value) => value.split(',').map((part) => part.trim()).includes(UNAVAILABLE_SLUG));
  const aliasValues = afterValues.filter((value) => {
    const parts = value.split(',').map((part) => part.trim());
    return parts.every((part) => part === 'inherit-parent' || part === 'auto');
  });
  return {
    wrote: afterText !== beforeText,
    unavailablePersisted,
    keepAliasPreserved: after[KEEP_ALIAS_ROLE] === KEEP_ALIAS_VALUE,
    autoRoleValue: after[AUTO_ROLE] ?? null,
    mutateRoleValue: after[MUTATE_ROLE] ?? null,
    aliasOnlyTable: afterValues.length > 0 && aliasValues.length === afterValues.length,
    inheritParentCount: afterValues.filter((value) => value === 'inherit-parent').length,
    autoCount: afterValues.filter((value) => value === 'auto').length,
    beforeDigest: digestBytes(Buffer.from(beforeText)),
    afterDigest: digestBytes(Buffer.from(afterText)),
  };
}

function scoreOracles(observations, ruleScore) {
  const screens = Object.values(observations.screens ?? {});
  const anyUnavailableRejected = screens.some((screen) => screen.unavailableRejected);
  const anyUnavailableMention = screens.some((screen) => screen.unavailableMention);
  const anyWriteCard = screens.some((screen) => screen.writeCard);
  const aliasAlwaysValid =
    ruleScore.keepAliasPreserved &&
    (ruleScore.autoRoleValue === AUTO_VALUE || ruleScore.inheritParentCount > 0) &&
    !ruleScore.unavailablePersisted;
  const validateStop =
    !ruleScore.unavailablePersisted &&
    ((anyUnavailableRejected && anyUnavailableMention) || (anyUnavailableMention && !anyWriteCard && !ruleScore.wrote));
  return {
    aliasAlwaysValid,
    validateUnavailableStopsWrite: validateStop,
    notes: {
      anyUnavailableRejected,
      anyUnavailableMention,
      anyWriteCard,
      wrote: ruleScore.wrote,
      unavailablePersisted: ruleScore.unavailablePersisted,
    },
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'setup-pstack:alias-and-unavailable-validate',
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

async function restoreLocked(lockedBytes) {
  const backupPath = `${referenceRulePath}.setup-alias-validate-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, lockedBytes);
  }
  await writeFile(piRulePath, lockedBytes);
}

const INSTRUCTION = [
  `Keep budget small — medium reasoning.`,
  `Keep "${KEEP_ALIAS_ROLE}" as ${KEEP_ALIAS_VALUE}.`,
  `Keep "${AUTO_ROLE}" as ${AUTO_VALUE}.`,
  `Set only "${MUTATE_ROLE}" to the real slug ${UNAVAILABLE_SLUG}.`,
  `Then accept and write if validation allows.`,
  `If ${UNAVAILABLE_SLUG} is not in the detected set, stop the write and ask again.`,
  `Do not invent detected models. Decline any verification skill offer.`,
].join(' ');

async function answerBudgetAndProbe(attempt, dir) {
  const chatFormNeedles = ['Reply with a number', 'Reply with one of those four labels', 'Pick a budget:'];
  const first = await waitEither(attempt, GEOMETRY, ['› [', 'Edited pstack-models.mdc', 'Unavailable model', ...chatFormNeedles], 300_000);
  await dumpScreen(attempt, dir, '01-question', GEOMETRY);

  if (first === 'Edited pstack-models.mdc') return { path: 'already-wrote' };
  if (first === 'Unavailable model') return { path: 'tool-rejected-early' };

  if (first === '› [') {
    attempt.input(Buffer.from('\x1b[B'), 'literal_user');
    await sleep(200);
    attempt.input(Buffer.from('\x1b[B'), 'literal_user');
    await sleep(200);
    attempt.input(Buffer.from('\x1b[B'), 'literal_user');
    await sleep(200);
    attempt.input(Buffer.from('\x1b[B'), 'literal_user');
    await sleep(200);
    attempt.input(Buffer.from(' '), 'literal_user');
    await sleep(200);
    attempt.input(Buffer.from(INSTRUCTION), 'literal_user');
    await sleep(400);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(800);
    for (let panel = 2; panel <= 8; panel += 1) {
      const next = await waitEither(
        attempt,
        GEOMETRY,
        ['Edited pstack-models.mdc', 'Unavailable model', '› [', ...chatFormNeedles],
        180_000,
      ).catch(() => null);
      await dumpScreen(attempt, dir, `0${panel}-panel`, GEOMETRY);
      if (next === 'Edited pstack-models.mdc') return { path: 'askquestion-wrote' };
      if (next === 'Unavailable model') return { path: 'askquestion-tool-rejected' };
      if (next === '› [') {
        attempt.input(Buffer.from('\x1b[B'), 'literal_user');
        await sleep(150);
        attempt.input(Buffer.from('\x1b[B'), 'literal_user');
        await sleep(150);
        attempt.input(Buffer.from('\x1b[B'), 'literal_user');
        await sleep(150);
        attempt.input(Buffer.from(' '), 'literal_user');
        await sleep(200);
        attempt.input(Buffer.from(INSTRUCTION), 'literal_user');
        await sleep(300);
        attempt.input(Buffer.from('\r'), 'literal_user');
        continue;
      }
      if (chatFormNeedles.includes(next)) {
        attempt.input(Buffer.from(INSTRUCTION), 'literal_user');
        attempt.input(Buffer.from('\r'), 'literal_user');
        continue;
      }
      break;
    }
    return { path: 'askquestion-driven' };
  }

  attempt.input(Buffer.from(INSTRUCTION), 'literal_user');
  attempt.input(Buffer.from('\r'), 'literal_user');
  return { path: 'chatform' };
}

async function runSide(side, fixtureBytes, fixtureDigest, lockedBytes) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.setup-alias-validate-backup`;
  await mkdir(dir, { recursive: true });
  await writeFile(backupPath, lockedBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  let attempt;
  const observations = { side, path: null, screens: {}, instruction: INSTRUCTION, unavailableSlug: UNAVAILABLE_SLUG };
  try {
    await writeFile(rulePath, fixtureBytes);
    attempt = await startAttempt(side === 'cursor' ? await cursorSpec(fixtureDigest) : await piSpec(fixtureDigest));
    if (side === 'cursor') await waitScreen(attempt, GEOMETRY, 'Tip:', 90_000);
    else await waitScreen(attempt, GEOMETRY, 'first-run', 120_000);
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);
    observations.screens.ready = observeScreen(await screenLines(attempt, GEOMETRY));

    attempt.input(Buffer.from('/setup-pstack'), 'literal_user');
    await sleep(800);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(400);
    attempt.input(Buffer.from('\r'), 'literal_user');

    const drive = await answerBudgetAndProbe(attempt, dir);
    observations.path = drive.path;

    // Wait for write, tool rejection, or a settled re-ask without write.
    const terminal = await waitEither(
      attempt,
      GEOMETRY,
      ['Edited pstack-models.mdc', 'Unavailable model', 'ask again', 'Ask again', 'choose again', 'not available', 'needs a choice'],
      360_000,
    ).catch(async () => {
      await waitSettled(attempt, GEOMETRY, 120_000).catch(() => {});
      return null;
    });
    await dumpScreen(attempt, dir, '09-terminal', GEOMETRY);
    observations.screens.terminal = observeScreen(await screenLines(attempt, GEOMETRY));
    observations.terminalNeedle = terminal;

    if (terminal === 'Edited pstack-models.mdc') {
      await dumpScreen(attempt, dir, '10-write-card', GEOMETRY);
      observations.screens.writeCard = observeScreen(await screenLines(attempt, GEOMETRY));
      await waitSettled(attempt, GEOMETRY, 180_000).catch(() => {});
      await sleep(1500);
      await dumpScreen(attempt, dir, '11-after-write', GEOMETRY);
      observations.screens.afterWrite = observeScreen(await screenLines(attempt, GEOMETRY));
    } else {
      await waitSettled(attempt, GEOMETRY, 180_000).catch(() => {});
      await sleep(1500);
      await dumpScreen(attempt, dir, '10-no-write-settled', GEOMETRY);
      observations.screens.noWriteSettled = observeScreen(await screenLines(attempt, GEOMETRY));
      // One follow-up nudge so a silent reject still shows re-ask language if present.
      attempt.input(Buffer.from(`Confirm: do not write ${UNAVAILABLE_SLUG}. Re-ask for a detected slug or keep inherit-parent/auto.`), 'literal_user');
      attempt.input(Buffer.from('\r'), 'literal_user');
      await sleep(2000);
      await waitSettled(attempt, GEOMETRY, 180_000).catch(() => {});
      await dumpScreen(attempt, dir, '11-followup', GEOMETRY);
      observations.screens.followup = observeScreen(await screenLines(attempt, GEOMETRY));
    }

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-before.mdc'), fixtureBytes);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    const ruleScore = scoreRule(fixtureBytes, after);
    observations.ruleScore = ruleScore;
    observations.oracles = scoreOracles(observations, ruleScore);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      fixtureDigest,
      afterDigest,
      observations,
      identity: JSON.parse(await readFile(join(attempt.dir, 'identity.json'), 'utf8')),
    };
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
    await restoreLocked(lockedBytes);
  }
}

const lockedBytes = await readFile(referenceRulePath, 'utf8');
const lockedDigest = await sha256(referenceRulePath);
if (lockedDigest !== LOCKED_FIXTURE_DIGEST) {
  console.error(`Reference rule digest ${lockedDigest} does not match locked fixture ${LOCKED_FIXTURE_DIGEST}`);
  process.exit(1);
}

await mkdir(evidenceRoot, { recursive: true });
const fixtureBytes = buildAliasFixture(lockedBytes);
const fixtureDigest = digestBytes(Buffer.from(fixtureBytes));
await writeFile(join(evidenceRoot, 'fixture-alias-mixed.mdc'), fixtureBytes);

const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
const results = [];
for (const side of sides) {
  const result = await runSide(side, fixtureBytes, fixtureDigest, lockedBytes);
  results.push(result);
  console.log(JSON.stringify({ side: result.side, attemptId: result.attemptId, oracles: result.observations.oracles, ruleScore: result.observations.ruleScore }));
}

const restoredDigest = await sha256(referenceRulePath);
const out = {
  scenario: 'setup-pstack:alias-and-unavailable-validate',
  requirementIds: ['PSTACK-SETUP-ALIAS-ALWAYS-VALID-001', 'PSTACK-SETUP-VALIDATE-001'],
  fixtureDigest,
  lockedFixtureDigest: LOCKED_FIXTURE_DIGEST,
  restoredLockedDigest: restoredDigest,
  unavailableSlug: UNAVAILABLE_SLUG,
  instruction: INSTRUCTION,
  results,
};
await writeFile(join(evidenceRoot, 'capture-results.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ ...out, results: results.map((r) => ({ side: r.side, attemptId: r.attemptId, oracles: r.observations.oracles })) }));
if (restoredDigest !== LOCKED_FIXTURE_DIGEST) {
  console.error('Failed to restore locked reference rule digest');
  process.exit(2);
}
