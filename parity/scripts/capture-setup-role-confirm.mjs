#!/usr/bin/env node
// Captures /setup-pstack role confirmation (PSTACK-SETUP-ROLE-CONFIRM-001): after budget,
// before write, dump the confirm screen and score whether every role is shown with its
// model and whether accept/change is asked. Real PTY both sides. Restores locked fixture.
//
// Usage: node scripts/capture-setup-role-confirm.mjs [--cursor-only|--pi-only]
// Evidence root: parity/evidence/setup-role-confirm/
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
const evidenceRoot = join(root, 'evidence', 'setup-role-confirm');
const GEOMETRY = { rows: 64, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';

const ROLE_CONFIRM_NEEDLES = [
  'Accept as-is',
  'Change specific roles',
  'accept as-is',
  'change specific roles',
  'Current roles',
  'Roles:',
  'Roles keep',
  'keep all as',
];
const BUDGET_NEEDLES = [
  '› [',
  'Pick a budget',
  'Choose a budget',
  'Reply with a number',
  'Reply with one of those four',
  'unlimited — max reasoning',
  'small — medium reasoning',
];
const WRITE_NEEDLE = 'Edited pstack-models.mdc';

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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function roleModelOnText(text, role, model) {
  const roleRe = escapeRegExp(role);
  const modelRe = escapeRegExp(model);
  // Colon form: "feature, refactoring: inherit-parent"
  if (new RegExp(`${roleRe}\\s*[:=]\\s*${modelRe}`).test(text)) return 'role:model';
  // Markdown/table cell form: "| role | model |" or "│ role │ model │"
  if (new RegExp(`${roleRe}\\s*[|│]\\s*${modelRe}`).test(text)) return 'table-cells';
  // Same line contains both after whitespace collapse.
  const flat = text.replace(/\s+/g, ' ');
  if (flat.includes(role) && flat.includes(model) && new RegExp(`${roleRe}.{0,80}${modelRe}`).test(flat)) {
    return 'same-line';
  }
  return null;
}

function scoreRoleConfirm(lines, expectedRoles) {
  const text = lines.join('\n');
  const listed = [];
  const missing = [];
  for (const [role, model] of Object.entries(expectedRoles)) {
    const form = roleModelOnText(text, role, model);
    if (form) listed.push({ role, model, form });
    else if (text.includes(role)) listed.push({ role, model, form: 'role-name-only' });
    else missing.push({ role, model });
  }
  const acceptPrompt =
    /Accept as-is/i.test(text) ||
    /accept as-is/i.test(text) ||
    (/Change specific roles/i.test(text) && /Accept/i.test(text));
  const changePrompt = /Change specific roles/i.test(text) || /change specific/i.test(text);
  const summaryOnly =
    (/All \d+ roles (are )?currently (run )?inherit-parent/i.test(text) ||
      /All \d+ roles are currently inherit-parent/i.test(text) ||
      /all inherit-parent/i.test(text) ||
      /every role is currently inherit-parent/i.test(text) ||
      /Almost every role is already inherit-parent/i.test(text) ||
      /keep all as inherit-parent/i.test(text)) &&
    listed.filter((row) => row.form !== 'role-name-only').length < Object.keys(expectedRoles).length;
  const askQuestion = /› \[/.test(text) || /Clarifying Questions/i.test(text);
  const writeCard = new RegExp(WRITE_NEEDLE, 'i').test(text);
  const roleModelPairs = listed.filter((row) => row.form !== 'role-name-only').length;
  return {
    expectedRoleCount: Object.keys(expectedRoles).length,
    rolesListedAnyForm: listed.length,
    rolesListedWithModel: roleModelPairs,
    rolesMissing: missing,
    acceptOrChangePrompt: acceptPrompt || changePrompt,
    acceptPrompt,
    changePrompt,
    summaryOnly,
    askQuestion,
    writeCardOnSameScreen: writeCard,
    everyRoleShownWithModel: roleModelPairs === Object.keys(expectedRoles).length && missing.length === 0,
  };
}

function observe(lines) {
  const text = lines.join('\n');
  return {
    writeCard: new RegExp(WRITE_NEEDLE, 'i').test(text),
    askQuestion: /› \[/.test(text) || /Clarifying Questions/i.test(text),
    chatForm: /Reply with a number|Reply with one of those four labels|Pick a budget:/i.test(text),
    acceptPrompt: /Accept as-is/i.test(text),
    changePrompt: /Change specific roles/i.test(text),
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'setup-pstack:role-confirm',
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
  const backupPath = `${referenceRulePath}.setup-role-confirm-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, lockedBytes);
  }
  await writeFile(piRulePath, lockedBytes);
}

async function answerBudgetOnly(attempt, dir) {
  const first = await waitEither(
    attempt,
    GEOMETRY,
    [...BUDGET_NEEDLES, WRITE_NEEDLE, ...ROLE_CONFIRM_NEEDLES],
    300_000,
  ).catch(async (error) => {
    await dumpScreen(attempt, dir, '01-budget-timeout', GEOMETRY);
    throw error;
  });
  await dumpScreen(attempt, dir, '01-budget', GEOMETRY);
  if (first === WRITE_NEEDLE) return { path: 'wrote-before-budget-answer', first };
  if (ROLE_CONFIRM_NEEDLES.includes(first) || /Accept as-is|Change specific|Current roles|Roles:/i.test(first)) {
    return { path: 'confirm-before-budget-answer', first };
  }
  if (first === '› [') {
    // Select small (4th budget option), submit to advance to role question without accepting roles.
    for (let i = 0; i < 3; i += 1) {
      attempt.input(Buffer.from('\x1b[B'), 'literal_user');
      await sleep(150);
    }
    attempt.input(Buffer.from(' '), 'literal_user');
    await sleep(200);
    attempt.input(Buffer.from('\r'), 'literal_user');
    return { path: 'askquestion-budget', first };
  }
  // Chat-form: keep current small budget only. Do not send accept yet.
  attempt.input(Buffer.from('small — medium reasoning'), 'literal_user');
  attempt.input(Buffer.from('\r'), 'literal_user');
  return { path: 'chatform-budget', first };
}

async function waitRoleConfirmOrWrite(attempt, dir, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let panel = 2;
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observe(last);
    if (obs.writeCard) {
      await dumpScreen(attempt, dir, '02-role-confirm-or-write', GEOMETRY);
      return { kind: 'wrote-before-confirm', lines: last, obs };
    }
    const confirmHit = ROLE_CONFIRM_NEEDLES.some((needle) => last.some((line) => line.includes(needle)));
    if (confirmHit && !obs.writeCard) {
      // Let the table finish streaming; Cursor often paints roles while still Working.
      await waitSettled(attempt, GEOMETRY, 90_000).catch(() => {});
      await sleep(800);
      last = await dumpScreen(attempt, dir, '02-role-confirm', GEOMETRY);
      return { kind: 'role-confirm', lines: last, obs: observe(last) };
    }
    // Pi may still be on a later AskQuestion panel after budget.
    if (obs.askQuestion && panel <= 6) {
      await dumpScreen(attempt, dir, `0${panel}-panel`, GEOMETRY);
      panel += 1;
      // If this panel is still budget-shaped, re-select small; if role-shaped, stop dumping and return above next loop.
      const text = last.join('\n');
      if (/Choose a budget|Pick a budget/i.test(text) && !/Accept as-is|Change specific/i.test(text)) {
        for (let i = 0; i < 3; i += 1) {
          attempt.input(Buffer.from('\x1b[B'), 'literal_user');
          await sleep(120);
        }
        attempt.input(Buffer.from(' '), 'literal_user');
        await sleep(150);
        attempt.input(Buffer.from('\r'), 'literal_user');
      }
    }
    await sleep(250);
  }
  await dumpScreen(attempt, dir, '02-timeout', GEOMETRY);
  return { kind: 'timeout', lines: last, obs: observe(last) };
}

async function acceptRoles(attempt, confirmObs) {
  const lines = await screenLines(attempt, GEOMETRY);
  const text = lines.join('\n');
  if (confirmObs.askQuestion || /› \[/.test(text)) {
    // Cursor may sit on Other after budget. Walk up to Accept as-is, then Space/Enter.
    for (let i = 0; i < 4; i += 1) {
      attempt.input(Buffer.from('\x1b[A'), 'literal_user');
      await sleep(120);
    }
    attempt.input(Buffer.from(' '), 'literal_user');
    await sleep(200);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(400);
    // If still on the panel (Other was selected), type accept via Other.
    const after = (await screenLines(attempt, GEOMETRY)).join('\n');
    if (/› \[/.test(after) && /Other:/i.test(after)) {
      attempt.input(Buffer.from('Accept as-is (all inherit-parent)'), 'literal_user');
      await sleep(200);
      attempt.input(Buffer.from('\r'), 'literal_user');
      return 'askquestion-other-accept';
    }
    return 'askquestion-accept';
  }
  attempt.input(Buffer.from('Accept as-is. Keep every role inherit-parent. Write the rule. Decline verification skill.'), 'literal_user');
  attempt.input(Buffer.from('\r'), 'literal_user');
  return 'chatform-accept';
}

async function runSide(side, lockedBytes, lockedDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.setup-role-confirm-backup`;
  await mkdir(dir, { recursive: true });
  await writeFile(backupPath, lockedBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const expectedRoles = parseRoles(lockedBytes);
  let attempt;
  const observations = { side, expectedRoles, screens: {} };
  try {
    await writeFile(rulePath, lockedBytes);
    attempt = await startAttempt(side === 'cursor' ? await cursorSpec(lockedDigest) : await piSpec(lockedDigest));
    if (side === 'cursor') await waitScreen(attempt, GEOMETRY, 'Tip:', 90_000);
    else await waitScreen(attempt, GEOMETRY, 'first-run', 120_000);
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);

    attempt.input(Buffer.from('/setup-pstack'), 'literal_user');
    await sleep(800);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(400);
    attempt.input(Buffer.from('\r'), 'literal_user');

    const digestBeforeBudget = await sha256(rulePath);
    const budget = await answerBudgetOnly(attempt, dir);
    observations.budgetPath = budget.path;
    observations.digestAfterBudgetAnswer = await sha256(rulePath);
    observations.wroteDuringBudget = observations.digestAfterBudgetAnswer !== digestBeforeBudget;

    const confirm = await waitRoleConfirmOrWrite(attempt, dir, 300_000);
    observations.confirmKind = confirm.kind;
    observations.screens.confirm = observe(confirm.lines);
    const score = scoreRoleConfirm(confirm.lines, expectedRoles);
    observations.roleConfirmScore = score;
    await writeFile(join(dir, 'role-confirm-score.json'), `${JSON.stringify(score, null, 2)}\n`);

    const digestBeforeAccept = await sha256(rulePath);
    observations.digestBeforeAccept = digestBeforeAccept;
    observations.writeBeforeConfirm =
      confirm.kind === 'wrote-before-confirm' || score.writeCardOnSameScreen || digestBeforeAccept !== lockedDigest;

    let acceptPath = null;
    try {
      if (confirm.kind === 'role-confirm') {
        acceptPath = await acceptRoles(attempt, confirm.obs);
        observations.acceptPath = acceptPath;
        const wrote = await waitScreen(attempt, GEOMETRY, WRITE_NEEDLE, 300_000)
          .then(() => true)
          .catch(() => false);
        await dumpScreen(attempt, dir, wrote ? '03-write-card' : '03-no-write', GEOMETRY);
        observations.screens.writeCard = observe(await screenLines(attempt, GEOMETRY));
        observations.writeCardSeen = wrote;
      } else if (confirm.kind === 'wrote-before-confirm') {
        await dumpScreen(attempt, dir, '03-write-card', GEOMETRY);
        observations.screens.writeCard = observe(confirm.lines);
        observations.acceptPath = 'none-wrote-first';
        observations.writeCardSeen = true;
      } else {
        acceptPath = await acceptRoles(attempt, confirm.obs);
        observations.acceptPath = acceptPath;
        const wrote = await waitScreen(attempt, GEOMETRY, WRITE_NEEDLE, 180_000)
          .then(() => true)
          .catch(() => false);
        await dumpScreen(attempt, dir, wrote ? '03-write-card' : '03-no-write', GEOMETRY);
        observations.screens.writeCard = observe(await screenLines(attempt, GEOMETRY));
        observations.writeCardSeen = wrote;
      }

      await waitSettled(attempt, GEOMETRY, 180_000).catch(() => {});
      await sleep(1500);
      await dumpScreen(attempt, dir, '04-settled', GEOMETRY);
    } catch (error) {
      observations.acceptError = String(error?.message ?? error);
      await dumpScreen(attempt, dir, '03-accept-error', GEOMETRY).catch(() => {});
    }

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-before.mdc'), lockedBytes);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    observations.afterDigest = afterDigest;
    observations.wrote = after !== lockedBytes;
    observations.writeOnlyAfterConfirm =
      confirm.kind === 'role-confirm' && !observations.writeBeforeConfirm && observations.wrote;

    for (const name of [
      '00-ready',
      '01-budget',
      '02-role-confirm',
      '02-role-confirm-or-write',
      '03-write-card',
      '03-no-write',
      '04-settled',
    ]) {
      try {
        await copyFile(join(dir, `screen-${name}.txt`), join(attempt.dir, `screen-${name}.txt`));
      } catch {
        // optional dump
      }
    }
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(attempt.dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(attempt.dir, 'role-confirm-score.json'), `${JSON.stringify(score, null, 2)}\n`);

    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      fixtureDigest: lockedDigest,
      afterDigest,
      wrote: after !== lockedBytes,
      observations,
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
await writeFile(join(evidenceRoot, 'fixture-locked.mdc'), lockedBytes);

const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
const results = [];
for (const side of sides) {
  const result = await runSide(side, lockedBytes, lockedDigest);
  results.push(result);
  console.log(JSON.stringify(result));
}

const restoredDigest = await sha256(referenceRulePath);
const out = {
  scenario: 'setup-pstack:role-confirm',
  scenarioId: 'setup-role-confirm',
  requirementIds: ['PSTACK-SETUP-ROLE-CONFIRM-001'],
  fixtureDigest: lockedDigest,
  restoredLockedDigest: restoredDigest,
  results,
};
await writeFile(join(evidenceRoot, 'capture-results.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out));
if (restoredDigest !== LOCKED_FIXTURE_DIGEST) {
  console.error('Failed to restore locked reference rule digest');
  process.exit(2);
}
