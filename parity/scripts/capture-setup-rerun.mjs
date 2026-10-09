#!/usr/bin/env node
// Captures journey family 02: re-run /setup-pstack on a mixed-role fixture, mutate
// one role, assert unrelated roles and settings stay put, then probe model identity
// on a follow-up turn. Real PTY both sides. Restores the locked reference rule.
//
// Usage: node scripts/capture-setup-rerun.mjs [--cursor-only|--pi-only]
// Evidence root: parity/evidence/setup-rerun/
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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
const piSettingsPath = join(piAgentDir, 'settings.json');
const evidenceRoot = join(root, 'evidence', 'setup-rerun');
const GEOMETRY = { rows: 36, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const MUTATE_ROLE = 'feature, refactoring';
const MUTATE_TO = 'auto';
const KEEP_ROLE = 'bug-fix';
const KEEP_VALUE = 'auto';
const FOLLOWUP =
  'Reply with exactly one line that starts with MODEL-ID-CHECK and then your model identifier. Do no other work.';

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

function parseBudget(ruleText) {
  const match = ruleText.match(/^# budget:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

function roleDiff(beforeText, afterText) {
  const before = parseRoles(beforeText);
  const after = parseRoles(afterText);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changed = [];
  const unchanged = [];
  for (const key of keys) {
    if (before[key] === after[key]) unchanged.push(key);
    else changed.push({ role: key, from: before[key] ?? null, to: after[key] ?? null });
  }
  return {
    budgetBefore: parseBudget(beforeText),
    budgetAfter: parseBudget(afterText),
    changed,
    unchangedCount: unchanged.length,
    keepRolePreserved: before[KEEP_ROLE] === KEEP_VALUE && after[KEEP_ROLE] === KEEP_VALUE,
    mutateRoleApplied: after[MUTATE_ROLE] === MUTATE_TO && before[MUTATE_ROLE] !== MUTATE_TO,
    mutateRoleFinal: after[MUTATE_ROLE] ?? null,
  };
}

function observeScreen(lines) {
  const text = lines.join('\n');
  return {
    writeCard: /Edited pstack-models\.mdc/i.test(text),
    askQuestion: /› \[/.test(text) || /Clarifying Questions/i.test(text),
    chatForm: /Reply with a number|Reply with one of those four labels|Pick a budget:/i.test(text),
    modelIdCheck: lines.some((line) => /MODEL-ID-CHECK/i.test(line) && !/Reply with exactly/i.test(line)),
    statusModel: (text.match(/claude-[a-z0-9.-]+|composer-[a-z0-9.-]+|gpt-[a-z0-9.-]+|grok-[a-z0-9.-]+/i) || [])[0] ?? null,
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function buildMixedFixture(lockedBytes) {
  const lines = lockedBytes.split('\n').map((line) => (line.startsWith('bug-fix:') ? `bug-fix: ${KEEP_VALUE}` : line));
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'setup-pstack:rerun-mutate-one-role',
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
  const backupPath = `${referenceRulePath}.setup-rerun-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, lockedBytes);
  }
  await writeFile(piRulePath, lockedBytes);
}

async function answerBudgetAndMutate(attempt, dir) {
  const chatFormNeedles = ['Reply with a number', 'Reply with one of those four labels', 'Pick a budget:'];
  const first = await waitEither(attempt, GEOMETRY, ['› [', 'Edited pstack-models.mdc', ...chatFormNeedles], 300_000);
  await dumpScreen(attempt, dir, '01-question', GEOMETRY);

  if (first === 'Edited pstack-models.mdc') return { path: 'already-wrote' };

  if (first === '› [') {
    // Prefer free-text Other when present; otherwise accept budget via Space/Enter then steer roles.
    attempt.input(Buffer.from('\x1b[B'), 'literal_user');
    await sleep(200);
    attempt.input(Buffer.from('\x1b[B'), 'literal_user');
    await sleep(200);
    attempt.input(Buffer.from('\x1b[B'), 'literal_user');
    await sleep(200);
    attempt.input(Buffer.from('\x1b[B'), 'literal_user');
    await sleep(200);
    // Land on Other if available, else stay on last budget option and submit.
    attempt.input(Buffer.from(' '), 'literal_user');
    await sleep(200);
    // Type the full instruction into Other / as the answer payload when the panel accepts text.
    const instruction = `small. Change only "${MUTATE_ROLE}" to ${MUTATE_TO}. Keep "${KEEP_ROLE}" as ${KEEP_VALUE}. Leave every other role unchanged. Accept and write. No verification skill.`;
    attempt.input(Buffer.from(instruction), 'literal_user');
    await sleep(400);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(800);
    // If a second panel appears, send the same instruction again via Other/free text.
    for (let panel = 2; panel <= 6; panel += 1) {
      const wrote = await waitEither(
        attempt,
        GEOMETRY,
        ['Edited pstack-models.mdc', '› [', ...chatFormNeedles],
        120_000,
      ).catch(() => null);
      await dumpScreen(attempt, dir, `0${panel}-panel`, GEOMETRY);
      if (wrote === 'Edited pstack-models.mdc') return { path: 'askquestion-wrote' };
      if (wrote === '› [') {
        attempt.input(Buffer.from('\x1b[B'), 'literal_user');
        await sleep(150);
        attempt.input(Buffer.from('\x1b[B'), 'literal_user');
        await sleep(150);
        attempt.input(Buffer.from('\x1b[B'), 'literal_user');
        await sleep(150);
        attempt.input(Buffer.from(' '), 'literal_user');
        await sleep(200);
        attempt.input(Buffer.from(instruction), 'literal_user');
        await sleep(300);
        attempt.input(Buffer.from('\r'), 'literal_user');
        continue;
      }
      if (chatFormNeedles.includes(wrote)) {
        attempt.input(Buffer.from(instruction), 'literal_user');
        attempt.input(Buffer.from('\r'), 'literal_user');
        continue;
      }
      break;
    }
    return { path: 'askquestion-driven' };
  }

  // Chat-form path: one explicit instruction covering budget + single-role mutation.
  const instruction = [
    'Budget: keep small — medium reasoning.',
    `Change only the role "${MUTATE_ROLE}" to ${MUTATE_TO}.`,
    `Keep "${KEEP_ROLE}" exactly as ${KEEP_VALUE}.`,
    'Leave every other role unchanged.',
    'Accept and write the rule. Decline any verification skill offer.',
  ].join(' ');
  attempt.input(Buffer.from(instruction), 'literal_user');
  attempt.input(Buffer.from('\r'), 'literal_user');
  return { path: 'chatform' };
}

async function runSide(side, mixedBytes, mixedDigest, lockedBytes, settingsDigestBefore) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.setup-rerun-backup`;
  await mkdir(dir, { recursive: true });
  await writeFile(backupPath, lockedBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const canaryPath = join(evidenceRoot, 'canary-unrelated-settings.json');
  const canaryBefore = await readFile(canaryPath);
  const canaryDigestBefore = digestBytes(canaryBefore);
  let attempt;
  const observations = { side, path: null, screens: {} };
  try {
    await writeFile(rulePath, mixedBytes);
    attempt = await startAttempt(side === 'cursor' ? await cursorSpec(mixedDigest) : await piSpec(mixedDigest));
    if (side === 'cursor') await waitScreen(attempt, GEOMETRY, 'Tip:', 90_000);
    else await waitScreen(attempt, GEOMETRY, 'first-run', 120_000);
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);
    observations.screens.ready = observeScreen(await screenLines(attempt, GEOMETRY));

    attempt.input(Buffer.from('/setup-pstack'), 'literal_user');
    await sleep(800);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(400);
    attempt.input(Buffer.from('\r'), 'literal_user');

    const drive = await answerBudgetAndMutate(attempt, dir);
    observations.path = drive.path;

    await waitScreen(attempt, GEOMETRY, 'Edited pstack-models.mdc', 360_000);
    await dumpScreen(attempt, dir, '02-write-card', GEOMETRY);
    observations.screens.writeCard = observeScreen(await screenLines(attempt, GEOMETRY));
    await waitSettled(attempt, GEOMETRY, 240_000).catch(() => {});
    await sleep(2_000);
    await dumpScreen(attempt, dir, '03-after-write', GEOMETRY);

    // Decline verification offer if it appears.
    const offer = await waitEither(attempt, GEOMETRY, ['verification skill', 'verification-skill', 'Add a follow-up', '›'], 60_000).catch(
      () => null,
    );
    if (offer && /verification/i.test(offer)) {
      attempt.input(Buffer.from('No\r'), 'literal_user');
      await sleep(1000);
    }

    attempt.input(Buffer.from(FOLLOWUP), 'literal_user');
    await sleep(300);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '04-followup-submit', GEOMETRY);

    const followDeadline = Date.now() + 300_000;
    while (Date.now() < followDeadline) {
      const lines = await screenLines(attempt, GEOMETRY);
      const obs = observeScreen(lines);
      if (obs.modelIdCheck && !obs.working) break;
      await sleep(400);
    }
    await sleep(1000);
    await dumpScreen(attempt, dir, '05-followup-reply', GEOMETRY);
    observations.screens.followup = observeScreen(await screenLines(attempt, GEOMETRY));

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-before.mdc'), mixedBytes);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    const diff = roleDiff(mixedBytes, after);
    observations.roleDiff = diff;

    const canaryAfter = await readFile(canaryPath);
    const canaryDigestAfter = digestBytes(canaryAfter);
    const settingsAfter = await sha256(piSettingsPath);
    observations.unrelated = {
      canaryUnchanged: canaryDigestBefore === canaryDigestAfter,
      canaryDigestBefore,
      canaryDigestAfter,
      piSettingsUnchanged: settingsDigestBefore === settingsAfter,
      piSettingsDigestBefore: settingsDigestBefore,
      piSettingsDigestAfter: settingsAfter,
    };

    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      fixtureDigest: mixedDigest,
      afterDigest,
      wrote: after !== mixedBytes,
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
const mixedBytes = buildMixedFixture(lockedBytes);
const mixedDigest = digestBytes(Buffer.from(mixedBytes));
await writeFile(join(evidenceRoot, 'fixture-mixed.mdc'), mixedBytes);
const canary = {
  purpose: 'byte-stable unrelated settings canary for journey-family-02',
  note: 'setup-pstack must not rewrite this file',
  nonce: 'setup-rerun-canary-v1',
};
await writeFile(join(evidenceRoot, 'canary-unrelated-settings.json'), `${JSON.stringify(canary, null, 2)}\n`);
await copyFile(join(evidenceRoot, 'canary-unrelated-settings.json'), join(evidenceRoot, 'canary-unrelated-settings.before.json'));
const settingsDigestBefore = await sha256(piSettingsPath);

const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
const results = [];
for (const side of sides) {
  const result = await runSide(side, mixedBytes, mixedDigest, lockedBytes, settingsDigestBefore);
  results.push(result);
  console.log(JSON.stringify(result));
}

const restoredDigest = await sha256(referenceRulePath);
const out = {
  scenario: 'setup-pstack:rerun-mutate-one-role',
  family: 'journey-family-02-rerun-setup-role-config',
  fixtureDigest: mixedDigest,
  lockedFixtureDigest: LOCKED_FIXTURE_DIGEST,
  restoredLockedDigest: restoredDigest,
  mutateRole: MUTATE_ROLE,
  mutateTo: MUTATE_TO,
  keepRole: KEEP_ROLE,
  keepValue: KEEP_VALUE,
  followup: FOLLOWUP,
  results,
};
await writeFile(join(evidenceRoot, 'capture-results.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out));
if (restoredDigest !== LOCKED_FIXTURE_DIGEST) {
  console.error('Failed to restore locked reference rule digest');
  process.exit(2);
}
