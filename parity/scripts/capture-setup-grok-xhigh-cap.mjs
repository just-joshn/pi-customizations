#!/usr/bin/env node
// Captures PSTACK-SETUP-GROK-XHIGH-CAP-001: under budget unlimited, Grok real slugs
// stay at xhigh (including grok-*-xhigh-fast); non-Grok real slugs may go to max;
// aliases unchanged. Real PTY both sides. Serializes ~/.cursor/rules/pstack-models.mdc
// via parity-lock and restores the locked digest after each side.
//
// Usage:
//   node scripts/capture-setup-grok-xhigh-cap.mjs [--cursor-only|--pi-only|--both]
//                                                [--pi-fixture=mixed|claude-only]
// Evidence root: parity/evidence/setup-grok-xhigh-cap/
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitScreen, waitSettled } from './journey-helpers.mjs';

function parseCli(argv) {
  let only = '--both';
  let piFixture = 'mixed';
  for (const arg of argv) {
    if (arg === '--cursor-only' || arg === '--pi-only' || arg === '--both') only = arg;
    else if (arg.startsWith('--pi-fixture=')) piFixture = arg.slice('--pi-fixture='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: capture-setup-grok-xhigh-cap.mjs [--cursor-only|--pi-only|--both] [--pi-fixture=mixed|claude-only]',
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  if (piFixture !== 'mixed' && piFixture !== 'claude-only') {
    console.error(`Unknown --pi-fixture=${piFixture}. Expected mixed|claude-only`);
    process.exit(1);
  }
  return { only, piFixture };
}

const { only, piFixture: PI_FIXTURE } = parseCli(process.argv.slice(2));

const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const sharedRuleLockPath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc.parity-lock');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'setup-grok-xhigh-cap');
const GEOMETRY = { rows: 36, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const TARGET_BUDGET = 'unlimited';
const ALIAS_ROLES = {
  'bug-fix': 'auto',
  'how explorer': 'inherit-parent',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function digestBytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function isGrokValue(value) {
  return /grok/i.test(value) || /^xai\//i.test(value);
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

function scoreGrokXhighCap(beforeText, afterText) {
  const before = parseRoles(beforeText);
  const after = parseRoles(afterText);
  const budgetBefore = parseBudget(beforeText);
  const budgetAfter = parseBudget(afterText);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const grokEntries = [];
  const nonGrokEntries = [];
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
      const toEffort = effortToken(to);
      const fromEffort = effortToken(from);
      const grok = isGrokValue(from) || isGrokValue(to);
      if (grok) {
        const ok = toEffort === 'xhigh';
        grokEntries.push({ role, index: i, from, to, fromEffort, toEffort, cappedXhigh: ok });
        if (!ok) failures.push({ role, index: i, reason: 'grok-not-xhigh', from, to, toEffort, expected: 'xhigh' });
        if (toEffort === 'max') failures.push({ role, index: i, reason: 'grok-went-to-max', from, to });
      } else {
        const ok = toEffort === 'max';
        nonGrokEntries.push({ role, index: i, from, to, fromEffort, toEffort, mappedMax: ok });
        if (!ok) failures.push({ role, index: i, reason: 'non-grok-not-max', from, to, toEffort, expected: 'max' });
      }
    }
  }

  for (const [role, expected] of Object.entries(ALIAS_ROLES)) {
    if (after[role] !== expected) {
      failures.push({ role, reason: 'alias-role-missing-or-wrong', expected, actual: after[role] ?? null });
    }
  }

  const budgetOk = typeof budgetAfter === 'string' && budgetAfter.startsWith(`${TARGET_BUDGET} (`);
  if (!budgetOk) failures.push({ reason: 'budget-not-target', budgetAfter, expectedPrefix: `${TARGET_BUDGET} (` });

  const grokPresent = grokEntries.length > 0;
  if (!grokPresent) failures.push({ reason: 'no-grok-real-slug-after' });

  return {
    budgetBefore,
    budgetAfter,
    budgetOk,
    grokEntries,
    nonGrokEntries,
    aliasEntries,
    grokPresent,
    grokCappedCount: grokEntries.filter((entry) => entry.cappedXhigh).length,
    grokTotal: grokEntries.length,
    nonGrokMaxCount: nonGrokEntries.filter((entry) => entry.mappedMax).length,
    nonGrokTotal: nonGrokEntries.length,
    aliasesPreserved:
      aliasEntries.every((entry) => entry.preserved) &&
      failures.every((f) => f.reason !== 'alias-changed' && f.reason !== 'alias-role-missing-or-wrong'),
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
    unavailable: /Unavailable model|not in availableModels|configure Pi provider/i.test(text),
  };
}

function instructionFor(side) {
  // Pi AskQuestion Other rejects long dual-question instruction blobs (see c91e2ff6).
  // Keep Pi text close to the proven budget-apply wording; name the Grok xhigh cap explicitly.
  if (side === 'pi') {
    return [
      'Call pstack_setup action state (or read $PI_CODING_AGENT_DIR/pstack/models.mdc) before answering. Do not invent the current table.',
      'Budget choice: unlimited — max reasoning. Write # budget: unlimited (max).',
      'Current roles already have real medium-effort values including xai/grok-4.7:medium and claude-subscription/claude-*:medium, plus bug-fix: auto and how explorer: inherit-parent.',
      'Apply effort mapping only: every Claude real value becomes provider/id:max; every xai/grok real value becomes provider/id:xhigh (never :max). Panel list entries included.',
      'Pass those remapped values as roleOverrides on pstack_setup write. The write tool does not remap for you.',
      'Do not replace real model values with inherit-parent or auto.',
      'Keep bug-fix as auto and how explorer as inherit-parent exactly.',
      'If any Grok slug is unavailable / not in availableModels, report that and stop. Do not drop Grok from the table to force a write.',
      'Accept that remapped table and write the rule. Do not stop to ask which option. Decline any verification skill offer.',
    ].join(' ');
  }
  return [
    'Re-read ~/.cursor/rules/pstack-models.mdc from disk now. It is NOT all inherit-parent.',
    'Budget choice already selected or to select: unlimited — max reasoning (selector label may say unlimited — keep max). Write # budget: unlimited (max).',
    'On-disk roles already include real medium-effort slugs: grok-4.7-medium-fast and claude-opus-5-5-medium, plus bug-fix: auto and how explorer: inherit-parent.',
    'Under unlimited, remap every real slug to its highest supported effort at or below max.',
    'Grok tops out at xhigh. Remap every Grok real slug to grok-4.7-xhigh-fast. Never write grok-*-max. Keep panel list Grok entries at xhigh too.',
    'Non-Grok Claude real slugs that support max become claude-opus-5-5-max, including panel lists.',
    'Do not replace real model values with inherit-parent or auto.',
    'Keep bug-fix as auto and how explorer as inherit-parent exactly.',
    'Write the full remapped table to the rule file now. Decline any verification skill offer.',
  ].join(' ');
}

const BUDGET_PICK = '1';

function acquireSharedRuleLock() {
  const child = spawn(
    'python3',
    [
      '-c',
      `
import fcntl, signal, sys, time
path = sys.argv[1]
pid = sys.argv[2]
fh = open(path, "w")
try:
    fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError as exc:
    sys.stderr.write(f"busy:{exc}\\n")
    sys.exit(2)
fh.write(f"{pid}\\n{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}\\nsetup-grok-xhigh-cap\\n")
fh.flush()
sys.stdout.write("locked\\n")
sys.stdout.flush()
signal.pause()
`,
      sharedRuleLockPath,
      String(process.pid),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (message) => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(message));
    };
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('locked') && !settled) {
        settled = true;
        resolve({
          release: () => {
            child.kill('SIGTERM');
          },
        });
      }
    });
    child.stderr.on('data', (chunk) => {
      fail(`Could not lock ${sharedRuleLockPath}: ${String(chunk).trim()}`);
    });
    child.on('exit', (code) => {
      fail(`lock helper exited early code=${code}`);
    });
    setTimeout(() => fail(`lock helper timed out for ${sharedRuleLockPath}`), 5_000);
  });
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'setup-pstack:grok-xhigh-cap-unlimited',
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
  const backupPath = `${referenceRulePath}.setup-grok-xhigh-cap-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, lockedBytes);
  }
  await writeFile(piRulePath, lockedBytes);
}

async function waitQuiet(attempt, ms = 90_000) {
  const settleDeadline = Date.now() + ms;
  while (Date.now() < settleDeadline) {
    const lines = await screenLines(attempt, GEOMETRY);
    const text = lines.join('\n');
    if (!/[\u2800-\u28FF]/.test(text) && !/\bWorking\b/.test(text) && !/\bThinking\b/.test(text)) return;
    await sleep(200);
  }
}

async function submitText(attempt, text, { doubleEnter = false } = {}) {
  attempt.input(Buffer.from(text), 'literal_user');
  await sleep(300);
  attempt.input(Buffer.from('\r'), 'literal_user');
  await sleep(400);
  if (doubleEnter) {
    // Cursor long pastes often sit as "[Pasted text #N]" until a second Enter.
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(600);
  }
}

async function selectOtherAndType(attempt, text, downs) {
  for (let i = 0; i < downs; i += 1) {
    attempt.input(Buffer.from('\x1b[B'), 'literal_user');
    await sleep(200);
  }
  attempt.input(Buffer.from(' '), 'literal_user');
  await sleep(200);
  attempt.input(Buffer.from(text), 'literal_user');
  await sleep(400);
  attempt.input(Buffer.from('\r'), 'literal_user');
  await sleep(800);
}

async function selectFocusedOption(attempt) {
  attempt.input(Buffer.from(' '), 'literal_user');
  await sleep(250);
  attempt.input(Buffer.from('\r'), 'literal_user');
  await sleep(800);
}

async function answerBudgetApply(attempt, dir, side) {
  const instruction = instructionFor(side);
  const chatFormNeedles = [
    'Reply with a number',
    'Reply with one of those four labels',
    'Reply with one of those labels',
    'reply with one label',
    'Pick a budget',
  ];
  const refuseNeedles = [
    "I haven't written",
    'not acting on it',
    'Which budget do you want',
  ];
  const first = await waitEither(attempt, GEOMETRY, ['› [', 'Edited pstack-models.mdc', ...chatFormNeedles], 300_000);
  await waitQuiet(attempt);
  await dumpScreen(attempt, dir, '01-question', GEOMETRY);

  if (first === 'Edited pstack-models.mdc') return { path: 'already-wrote' };

  if (first === '› [') {
    if (side === 'pi') {
      // Mixed fixture asks Question 1 of 2. Dual Other blobs were refused (c91e2ff6).
      // Space-select unlimited (already focused), Enter to role-confirm, then Other+type.
      await selectFocusedOption(attempt);
      await dumpScreen(attempt, dir, '01b-after-unlimited', GEOMETRY);
      const second = await waitEither(
        attempt,
        GEOMETRY,
        ['› [', 'Edited pstack-models.mdc', 'Unavailable model', ...chatFormNeedles, ...refuseNeedles],
        180_000,
      ).catch(() => null);
      await dumpScreen(attempt, dir, '01c-role-or-next', GEOMETRY);
      if (second === 'Edited pstack-models.mdc') return { path: 'askquestion-wrote' };
      if (second === 'Unavailable model') return { path: 'askquestion-unavailable' };
      if (second === '› [') {
        // Role-confirm: Accept / Change / Other → Down×2, Space, type, Enter.
        await selectOtherAndType(attempt, instruction, 2);
        await dumpScreen(attempt, dir, '01d-after-role-other', GEOMETRY);
      } else if (second && (chatFormNeedles.includes(second) || refuseNeedles.includes(second))) {
        await submitText(attempt, instruction);
      }
      for (let panel = 2; panel <= 7; panel += 1) {
        const wrote = await waitEither(
          attempt,
          GEOMETRY,
          ['Edited pstack-models.mdc', '› [', 'Unavailable model', ...chatFormNeedles, ...refuseNeedles],
          180_000,
        ).catch(() => null);
        await dumpScreen(attempt, dir, `0${panel}-panel`, GEOMETRY);
        if (wrote === 'Edited pstack-models.mdc') return { path: 'askquestion-wrote' };
        if (wrote === 'Unavailable model') return { path: 'askquestion-unavailable' };
        if (wrote === '› [') {
          await selectOtherAndType(attempt, instruction, 2);
          continue;
        }
        if (wrote && (chatFormNeedles.includes(wrote) || refuseNeedles.includes(wrote))) {
          await submitText(attempt, instruction);
          continue;
        }
        break;
      }
      return { path: 'askquestion-unlimited-then-other' };
    }

    // Cursor AskQuestion (rare): proven Other drive.
    await selectOtherAndType(attempt, instruction, 4);
    await dumpScreen(attempt, dir, '01b-after-other', GEOMETRY);
    for (let panel = 2; panel <= 6; panel += 1) {
      const wrote = await waitEither(
        attempt,
        GEOMETRY,
        ['Edited pstack-models.mdc', '› [', 'Unavailable model', ...chatFormNeedles],
        180_000,
      ).catch(() => null);
      await dumpScreen(attempt, dir, `0${panel}-panel`, GEOMETRY);
      if (wrote === 'Edited pstack-models.mdc') return { path: 'askquestion-wrote' };
      if (wrote === 'Unavailable model') return { path: 'askquestion-unavailable' };
      if (wrote === '› [') {
        await selectOtherAndType(attempt, instruction, 3);
        continue;
      }
      if (wrote && chatFormNeedles.includes(wrote)) {
        await submitText(attempt, instruction, { doubleEnter: true });
        continue;
      }
      break;
    }
    return { path: 'askquestion-driven' };
  }

  // Cursor chat-form: pick unlimited by number first (short, reliably submits),
  // then send the remapped-table instruction on the next quiet prompt.
  await submitText(attempt, BUDGET_PICK, { doubleEnter: true });
  await waitQuiet(attempt, 180_000);
  await dumpScreen(attempt, dir, '01b-after-budget-pick', GEOMETRY);
  const afterPick = await waitEither(
    attempt,
    GEOMETRY,
    ['Edited pstack-models.mdc', '› [', 'Accept as-is', 'Current roles', ...chatFormNeedles, 'Add a follow-up'],
    180_000,
  ).catch(() => null);
  if (afterPick === 'Edited pstack-models.mdc') return { path: 'chatform-budget-wrote' };
  if (afterPick === '› [') {
    await selectOtherAndType(attempt, instruction, 3);
    return { path: 'chatform-then-askquestion' };
  }
  await submitText(attempt, instruction, { doubleEnter: true });
  return { path: 'chatform-two-step' };
}

async function runSide(side, fixtureBytes, fixtureDigest, lockedBytes) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.setup-grok-xhigh-cap-backup`;
  await mkdir(dir, { recursive: true });
  await writeFile(backupPath, lockedBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  let attempt;
  const observations = {
    side,
    path: null,
    screens: {},
    targetBudget: TARGET_BUDGET,
    grokCap: true,
  };
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

    // Do not match instruction prose that contains "Remap" / "budget: unlimited".
    const writeDeadline = Date.now() + 360_000;
    let sawWrite = false;
    let sawUnavailable = false;
    while (Date.now() < writeDeadline) {
      const lines = await screenLines(attempt, GEOMETRY);
      const text = lines.join('\n');
      if (/Unavailable model|not in availableModels|configure Pi provider/i.test(text)) {
        sawUnavailable = true;
        observations.screens.unavailable = observeScreen(lines);
      }
      // Do not match instruction prose ("Remap", "Write # budget"). Require write card or file change.
      if (/Edited pstack-models\.mdc/i.test(text)) {
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
    if (!sawWrite) {
      await dumpScreen(attempt, dir, '02-timeout', GEOMETRY);
      const err = new Error(
        sawUnavailable
          ? 'Timed out waiting for write; screen showed Unavailable model / missing provider.'
          : 'Timed out waiting for unlimited budget-apply write (screen or rule file).',
      );
      err.code = sawUnavailable ? 'GROK_UNAVAILABLE' : 'WRITE_TIMEOUT';
      throw err;
    }
    await dumpScreen(attempt, dir, '02-write-card', GEOMETRY);
    observations.screens.writeCard = observeScreen(await screenLines(attempt, GEOMETRY));
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
    const score = scoreGrokXhighCap(fixtureBytes, after);
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
      await writeFile(join(dir, 'error.json'), `${JSON.stringify({ message: String(error), code: error.code ?? null }, null, 2)}\n`);
    } catch {
      // best-effort
    }
    throw error;
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
    // Always restore both host rule paths after a side, including GROK_UNAVAILABLE / WRITE_TIMEOUT.
    await restoreLocked(lockedBytes).catch(() => {});
  }
}

const lockedBytes = await readFile(referenceRulePath, 'utf8');
const lockedDigest = await sha256(referenceRulePath);
if (lockedDigest !== LOCKED_FIXTURE_DIGEST) {
  console.error(`Reference rule digest ${lockedDigest} does not match locked fixture ${LOCKED_FIXTURE_DIGEST}`);
  process.exit(1);
}

const lock = await acquireSharedRuleLock();
try {
  await mkdir(evidenceRoot, { recursive: true });
  const cursorFixturePath = join(evidenceRoot, 'fixture-cursor.mdc');
  const piFixtureName = PI_FIXTURE === 'claude-only' ? 'fixture-pi-claude-only.mdc' : 'fixture-pi.mdc';
  const piFixturePath = join(evidenceRoot, piFixtureName);
  const cursorFixture = await readFile(cursorFixturePath, 'utf8');
  const piFixture = await readFile(piFixturePath, 'utf8');
  const cursorFixtureDigest = digestBytes(Buffer.from(cursorFixture));
  const piFixtureDigest = digestBytes(Buffer.from(piFixture));

  if (!/grok/i.test(cursorFixture)) {
    console.error('Cursor fixture must include a Grok real slug');
    process.exit(1);
  }
  if (PI_FIXTURE === 'mixed' && !/grok/i.test(piFixture)) {
    console.error('Pi mixed fixture must include a Grok real slug');
    process.exit(1);
  }

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
  const resultsPath = join(evidenceRoot, 'capture-results.json');
  let mergedResults = results;
  if (only === '--cursor-only' || only === '--pi-only') {
    try {
      const prior = JSON.parse(await readFile(resultsPath, 'utf8'));
      if (Array.isArray(prior.results)) {
        const keepSide = only === '--cursor-only' ? 'pi' : 'cursor';
        const kept = prior.results.filter((entry) => entry.side === keepSide);
        mergedResults = [...kept, ...results];
      }
    } catch {
      // no prior results file
    }
  }
  const out = {
    scenario: 'setup-pstack:grok-xhigh-cap-unlimited',
    scenarioId: 'setup-grok-xhigh-cap',
    requirementIds: ['PSTACK-SETUP-GROK-XHIGH-CAP-001'],
    targetBudget: TARGET_BUDGET,
    piFixture: PI_FIXTURE,
    cursorFixturePath: 'fixture-cursor.mdc',
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
  console.log(JSON.stringify(out));
  if (restoredDigest !== LOCKED_FIXTURE_DIGEST) {
    console.error('Failed to restore locked reference rule digest');
    process.exit(2);
  }
} finally {
  lock.release();
}
