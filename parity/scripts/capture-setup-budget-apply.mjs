#!/usr/bin/env node
// Captures setup-budget-apply: re-run /setup-pstack on a mixed real-slug fixture,
// choose a target budget, and score effort-token mapping vs aliases. Real PTY both sides.
// Restores the locked reference rule after each side.
//
// Usage:
//   node scripts/capture-setup-budget-apply.mjs [--budget=large|medium|small|unlimited]
//                                               [--effort=xhigh|high|medium|max]
//                                               [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/setup-budget-apply/
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitScreen, waitSettled } from './journey-helpers.mjs';

const BUDGETS = {
  large: { effort: 'xhigh', choice: 'large — xhigh reasoning', fixtureKind: 'medium' },
  medium: { effort: 'high', choice: 'medium — high reasoning', fixtureKind: 'medium' },
  small: { effort: 'medium', choice: 'small — medium reasoning', fixtureKind: 'high' },
  // Claude-only Cursor fixture: Grok tops out at xhigh under unlimited, which would
  // fail an all-to-max oracle. Pi already uses claude-subscription Claude models.
  unlimited: { effort: 'max', choice: 'unlimited — max reasoning', fixtureKind: 'claude-medium' },
};

function parseCli(argv) {
  let only = '--both';
  let budget = 'large';
  let effortOverride = null;
  for (const arg of argv) {
    if (arg === '--cursor-only' || arg === '--pi-only' || arg === '--both') only = arg;
    else if (arg.startsWith('--budget=')) budget = arg.slice('--budget='.length);
    else if (arg.startsWith('--effort=')) effortOverride = arg.slice('--effort='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: capture-setup-budget-apply.mjs [--budget=large|medium|small|unlimited] [--effort=xhigh|high|medium|max] [--cursor-only|--pi-only|--both]',
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  if (!BUDGETS[budget]) {
    console.error(`Unknown --budget=${budget}. Expected one of: ${Object.keys(BUDGETS).join(', ')}`);
    process.exit(1);
  }
  const expectedEffort = BUDGETS[budget].effort;
  if (effortOverride && effortOverride !== expectedEffort) {
    console.error(`--effort=${effortOverride} does not match --budget=${budget} (expected ${expectedEffort})`);
    process.exit(1);
  }
  return { only, budget, effort: expectedEffort, meta: BUDGETS[budget] };
}

const { only, budget: TARGET_BUDGET, effort: TARGET_EFFORT, meta: TARGET_META } = parseCli(process.argv.slice(2));

const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'setup-budget-apply');
const GEOMETRY = { rows: 36, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const ALIAS_ROLES = {
  'bug-fix': 'auto',
  'how explorer': 'inherit-parent',
};

const fixtureFileFor = (side, fixtureKind) => {
  if (fixtureKind === 'medium') return side === 'cursor' ? 'fixture-cursor.mdc' : 'fixture-pi.mdc';
  if (fixtureKind === 'claude-medium') {
    return side === 'cursor' ? 'fixture-cursor-claude-medium.mdc' : 'fixture-pi.mdc';
  }
  return side === 'cursor' ? `fixture-cursor-${fixtureKind}.mdc` : `fixture-pi-${fixtureKind}.mdc`;
};

const instructionFor = (side) =>
  [
    side === 'cursor'
      ? 'Read ~/.cursor/rules/pstack-models.mdc from disk before answering. Do not invent the current table.'
      : 'Call pstack_setup action state (or read $PI_CODING_AGENT_DIR/pstack/models.mdc) before answering. Do not invent the current table.',
    `Budget choice: ${TARGET_META.choice}.`,
    TARGET_BUDGET === 'unlimited'
      ? 'If the selector shows unlimited — keep max, that is the unlimited option. Choose it and still write budget unlimited (max) with remapped real slugs.'
      : null,
    TARGET_META.fixtureKind === 'high'
      ? 'The current rule already has real model values at high effort plus bug-fix: auto and how explorer: inherit-parent.'
      : 'The current rule already has real model values at medium effort plus bug-fix: auto and how explorer: inherit-parent.',
    side === 'cursor'
      ? `Apply effort mapping only: every real slug becomes its ${TARGET_EFFORT} form (…-${TARGET_EFFORT} or …-${TARGET_EFFORT}-fast; panel list entries included).`
      : `Apply effort mapping only: every real value becomes provider/id:${TARGET_EFFORT} (panel list entries included). Pass those remapped values as roleOverrides on pstack_setup write. The write tool does not remap for you.`,
    'Do not replace real model values with inherit-parent or auto.',
    'Keep bug-fix as auto and how explorer as inherit-parent exactly.',
    side === 'cursor'
      ? TARGET_META.fixtureKind === 'claude-medium'
        ? 'The fixture uses only Claude slugs that support max. Remap every real slug to its max form and write.'
        : 'Prefer the full entitled model list (for example cursor-agent --list-models) when checking availability, not only the short Task subset.'
      : `The fixture uses only claude-subscription Claude models already in availableModels. Remap those to :${TARGET_EFFORT} and write. Do not stop to ask which option.`,
    'Accept that remapped table and write the rule. Decline any verification skill offer.',
  ]
    .filter(Boolean)
    .join(' ');

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

function effortToken(value) {
  if (!value || value === 'inherit-parent' || value === 'auto') return null;
  const colon = value.match(/:(off|minimal|low|medium|high|xhigh|max)$/);
  if (colon) return colon[1];
  const slug = value.match(/-(max|xhigh|high|medium|low)(-fast)?$/);
  return slug ? slug[1] : null;
}

function splitEntries(value) {
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function scoreBudgetApply(beforeText, afterText) {
  const before = parseRoles(beforeText);
  const after = parseRoles(afterText);
  const budgetBefore = parseBudget(beforeText);
  const budgetAfter = parseBudget(afterText);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const realEntries = [];
  const aliasEntries = [];
  const failures = [];

  for (const role of keys) {
    const beforeValue = before[role] ?? '';
    const afterValue = after[role] ?? '';
    const beforeParts = splitEntries(beforeValue);
    const afterParts = splitEntries(afterValue);
    if (beforeParts.length !== afterParts.length) {
      failures.push({ role, reason: 'entry-count-changed', before: beforeValue, after: afterValue });
    }
    const n = Math.max(beforeParts.length, afterParts.length);
    for (let i = 0; i < n; i += 1) {
      const from = beforeParts[i];
      const to = afterParts[i];
      if (!from && !to) continue;
      if (from === 'inherit-parent' || from === 'auto' || to === 'inherit-parent' || to === 'auto') {
        aliasEntries.push({ role, index: i, from, to, preserved: from === to });
        if (from !== to) failures.push({ role, index: i, reason: 'alias-changed', from, to });
        continue;
      }
      const fromEffort = effortToken(from);
      const toEffort = effortToken(to);
      const ok = toEffort === TARGET_EFFORT;
      realEntries.push({ role, index: i, from, to, fromEffort, toEffort, mapped: ok });
      if (!ok) failures.push({ role, index: i, reason: 'effort-not-target', from, to, toEffort, expected: TARGET_EFFORT });
    }
  }

  for (const [role, expected] of Object.entries(ALIAS_ROLES)) {
    if (after[role] !== expected) {
      failures.push({ role, reason: 'alias-role-missing-or-wrong', expected, actual: after[role] ?? null });
    }
  }

  const budgetOk = typeof budgetAfter === 'string' && budgetAfter.startsWith(`${TARGET_BUDGET} (`);
  if (!budgetOk) failures.push({ reason: 'budget-not-target', budgetAfter, expectedPrefix: `${TARGET_BUDGET} (` });

  return {
    budgetBefore,
    budgetAfter,
    budgetOk,
    realEntries,
    aliasEntries,
    realMappedCount: realEntries.filter((entry) => entry.mapped).length,
    realTotal: realEntries.length,
    aliasesPreserved: aliasEntries.every((entry) => entry.preserved) && failures.every((f) => f.reason !== 'alias-changed' && f.reason !== 'alias-role-missing-or-wrong'),
    panelMapped: realEntries.filter((entry) => /runners|cross-judge|reviewers/.test(entry.role)).every((entry) => entry.mapped),
    pass: failures.length === 0,
    failures,
  };
}

function observeScreen(lines) {
  const text = lines.join('\n');
  return {
    writeCard: /Edited pstack-models\.mdc/i.test(text),
    askQuestion: /› \[/.test(text) || /Clarifying Questions/i.test(text),
    chatForm: /Reply with a number|Reply with one of those (four )?labels|Pick a budget:/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: `setup-pstack:budget-apply-${TARGET_BUDGET}`,
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
  const backupPath = `${referenceRulePath}.setup-budget-apply-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, lockedBytes);
  }
  await writeFile(piRulePath, lockedBytes);
}

async function answerBudgetApply(attempt, dir, side) {
  const instruction = instructionFor(side);
  // Prefer Reply / AskQuestion needles. "Pick a budget:" paints mid-stream while Working.
  const chatFormNeedles = [
    'Reply with a number',
    'Reply with one of those four labels',
    'Reply with one of those labels',
  ];
  const first = await waitEither(attempt, GEOMETRY, ['› [', 'Edited pstack-models.mdc', ...chatFormNeedles], 300_000);
  // Wait out the spinner so the free-text reply is accepted.
  const settleDeadline = Date.now() + 90_000;
  while (Date.now() < settleDeadline) {
    const lines = await screenLines(attempt, GEOMETRY);
    const text = lines.join('\n');
    if (!/[\u2800-\u28FF]/.test(text) && !/\bWorking\b/.test(text) && !/\bThinking\b/.test(text)) break;
    await sleep(200);
  }
  await dumpScreen(attempt, dir, '01-question', GEOMETRY);

  if (first === 'Edited pstack-models.mdc') return { path: 'already-wrote' };

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
    attempt.input(Buffer.from(instruction), 'literal_user');
    await sleep(400);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(800);
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

  attempt.input(Buffer.from(instruction), 'literal_user');
  attempt.input(Buffer.from('\r'), 'literal_user');
  return { path: 'chatform' };
}

async function runSide(side, fixtureBytes, fixtureDigest, lockedBytes) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.setup-budget-apply-backup`;
  await mkdir(dir, { recursive: true });
  await writeFile(backupPath, lockedBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  let attempt;
  const observations = { side, path: null, screens: {}, targetBudget: TARGET_BUDGET, targetEffort: TARGET_EFFORT };
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

    const drive = await answerBudgetApply(attempt, dir, side);
    observations.path = drive.path;

    // Write-card title can scroll away on Pi. Treat file budget change or confirmation prose as success.
    const remappedNeedle = new RegExp(`Remapped to :${TARGET_EFFORT}`, 'i');
    const writeDeadline = Date.now() + 360_000;
    let sawWrite = false;
    while (Date.now() < writeDeadline) {
      const lines = await screenLines(attempt, GEOMETRY);
      const text = lines.join('\n');
      if (/Edited pstack-models\.mdc/i.test(text) || remappedNeedle.test(text) || /rule is written/i.test(text)) {
        sawWrite = true;
        break;
      }
      try {
        const live = await readFile(rulePath, 'utf8');
        if (live.includes(`# budget: ${TARGET_BUDGET} (`) && live !== fixtureBytes) {
          sawWrite = true;
          break;
        }
      } catch {
        // ignore transient read errors
      }
      await sleep(200);
    }
    if (!sawWrite) throw new Error('Timed out waiting for budget-apply write (screen or rule file).');
    await dumpScreen(attempt, dir, '02-write-card', GEOMETRY);
    observations.screens.writeCard = observeScreen(await screenLines(attempt, GEOMETRY));
    // Snapshot immediately. Pi can still be settling, and restore must not race the read.
    let after = await readFile(rulePath, 'utf8');
    await writeFile(join(dir, 'rule-after-on-write-card.mdc'), after);

    await waitSettled(attempt, GEOMETRY, 240_000).catch(() => {});
    await sleep(2_000);
    await dumpScreen(attempt, dir, '03-after-write', GEOMETRY);

    const offer = await waitEither(attempt, GEOMETRY, ['verification skill', 'verification-skill', 'Add a follow-up', '›'], 60_000).catch(
      () => null,
    );
    if (offer && /verification/i.test(offer)) {
      attempt.input(Buffer.from('No\r'), 'literal_user');
      await sleep(1000);
    }

    // Prefer a post-settle rule that records the target budget; keep the write-card snapshot as fallback.
    const settleDeadline = Date.now() + 30_000;
    while (Date.now() < settleDeadline) {
      const candidate = await readFile(rulePath, 'utf8');
      if (candidate.includes(`# budget: ${TARGET_BUDGET} (`)) {
        after = candidate;
        break;
      }
      await sleep(250);
    }
    if (!after.includes(`# budget: ${TARGET_BUDGET} (`)) {
      const snap = await readFile(join(dir, 'rule-after-on-write-card.mdc'), 'utf8');
      if (snap.includes(`# budget: ${TARGET_BUDGET} (`)) after = snap;
    }

    const afterDigest = digestBytes(Buffer.from(after));
    await writeFile(join(dir, 'rule-before.mdc'), fixtureBytes);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    const score = scoreBudgetApply(fixtureBytes, after);
    observations.score = score;

    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    const result = {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      fixtureDigest,
      afterDigest,
      wrote: after !== fixtureBytes,
      score,
      observations,
      identity: JSON.parse(await readFile(join(attempt.dir, 'identity.json'), 'utf8')),
    };
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
      attempt = undefined;
    }
    await restoreLocked(lockedBytes);
    return result;
  } catch (error) {
    try {
      const emergency = await readFile(rulePath, 'utf8');
      await writeFile(join(dir, 'rule-after-emergency.mdc'), emergency);
      await writeFile(join(dir, 'rule-before.mdc'), fixtureBytes);
    } catch {
      // best-effort
    }
    throw error;
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
    const current = await sha256(referenceRulePath).catch(() => null);
    if (current !== LOCKED_FIXTURE_DIGEST) await restoreLocked(lockedBytes);
  }
}

const lockedBytes = await readFile(referenceRulePath, 'utf8');
const lockedDigest = await sha256(referenceRulePath);
if (lockedDigest !== LOCKED_FIXTURE_DIGEST) {
  console.error(`Reference rule digest ${lockedDigest} does not match locked fixture ${LOCKED_FIXTURE_DIGEST}`);
  process.exit(1);
}

await mkdir(evidenceRoot, { recursive: true });
const cursorFixtureName = fixtureFileFor('cursor', TARGET_META.fixtureKind);
const piFixtureName = fixtureFileFor('pi', TARGET_META.fixtureKind);
const cursorFixturePath = join(evidenceRoot, cursorFixtureName);
const piFixturePath = join(evidenceRoot, piFixtureName);
const cursorFixture = await readFile(cursorFixturePath, 'utf8');
const piFixture = await readFile(piFixturePath, 'utf8');
const cursorFixtureDigest = digestBytes(Buffer.from(cursorFixture));
const piFixtureDigest = digestBytes(Buffer.from(piFixture));

const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
const results = [];
for (const side of sides) {
  const fixtureBytes = side === 'cursor' ? cursorFixture : piFixture;
  const fixtureDigest = side === 'cursor' ? cursorFixtureDigest : piFixtureDigest;
  const result = await runSide(side, fixtureBytes, fixtureDigest, lockedBytes);
  results.push(result);
  console.log(JSON.stringify(result));
}

const restoredDigest = await sha256(referenceRulePath);
const resultsPath = join(evidenceRoot, `capture-results-${TARGET_BUDGET}.json`);
let mergedResults = results;
if (only === '--cursor-only' || only === '--pi-only') {
  try {
    const prior = JSON.parse(await readFile(resultsPath, 'utf8'));
    if (prior.targetBudget === TARGET_BUDGET && Array.isArray(prior.results)) {
      const keepSide = only === '--cursor-only' ? 'pi' : 'cursor';
      const kept = prior.results.filter((entry) => entry.side === keepSide);
      mergedResults = [...kept, ...results];
    }
  } catch {
    // no prior results file
  }
}
const out = {
  scenario: `setup-pstack:budget-apply-${TARGET_BUDGET}`,
  scenarioId: 'setup-budget-apply',
  requirementIds: ['PSTACK-SETUP-BUDGET-APPLY-001'],
  targetBudget: TARGET_BUDGET,
  targetEffort: TARGET_EFFORT,
  fixtureKind: TARGET_META.fixtureKind,
  cursorFixturePath: cursorFixtureName,
  piFixturePath: piFixtureName,
  instructionCursor: instructionFor('cursor'),
  instructionPi: instructionFor('pi'),
  cursorFixtureDigest,
  piFixtureDigest,
  lockedFixtureDigest: LOCKED_FIXTURE_DIGEST,
  restoredLockedDigest: restoredDigest,
  results: mergedResults,
};
await writeFile(resultsPath, `${JSON.stringify(out, null, 2)}\n`);
if (TARGET_BUDGET === 'large') {
  await writeFile(join(evidenceRoot, 'capture-results.json'), `${JSON.stringify(out, null, 2)}\n`);
}
console.log(JSON.stringify(out));
if (restoredDigest !== LOCKED_FIXTURE_DIGEST) {
  console.error('Failed to restore locked reference rule digest');
  process.exit(2);
}
