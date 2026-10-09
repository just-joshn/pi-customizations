#!/usr/bin/env node
// Captures PSTACK-SETUP-VERIFY-OFFER-001: after /setup-pstack confirm+write on a
// project with neither verify-* skill nor harness, observe the one-time offer to
// generate via /create-verification-skill. Default answers no (continue without
// pushing). --yes answers yes and waits for create-verification-skill to attach.
// Real PTY both sides. Restores the locked reference rule.
//
// Usage:
//   node scripts/capture-setup-verify-offer.mjs [--both|--cursor-only|--pi-only] [--no|--yes]
// Evidence root: parity/evidence/setup-verify-offer/
import { access, chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitScreen, waitSettled } from './journey-helpers.mjs';

const argvFlags = new Set(process.argv.slice(2));
const branch = argvFlags.has('--yes') ? 'yes' : 'no';
const only = argvFlags.has('--cursor-only')
  ? '--cursor-only'
  : argvFlags.has('--pi-only')
    ? '--pi-only'
    : '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const sharedRuleLockPath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc.parity-lock');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'setup-verify-offer');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const WRITE_NEEDLE = 'Edited pstack-models.mdc';
const OFFER_NEEDLES = [
  'create-verification-skill',
  'verification skill',
  'project-local verification',
  'verify-*',
  'want a project-local',
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
const ROLE_CONFIRM_NEEDLES = [
  'Accept as-is',
  'Change specific roles',
  'accept as-is',
  'change specific roles',
  'Current roles',
  'Roles:',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function digestBytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function peerSetupCaptures() {
  try {
    const out = execFileSync('ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf8' });
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const pid = Number(line.split(/\s+/, 1)[0]);
        return { pid, command: line.slice(String(pid).length).trim() };
      })
      .filter((row) => Number.isFinite(row.pid))
      .filter((row) => row.pid !== process.pid && row.pid !== process.ppid)
      .filter((row) => !/(^|[\/\s])(zsh|bash|sh)\b/.test(row.command))
      .filter((row) => !/\bbuiltin\b/.test(row.command))
      .filter((row) => /(^|[\/\s])node(\s+|$).*parity\/scripts\/capture-setup-[^\s]*\.mjs\b/.test(row.command));
  } catch {
    return [];
  }
}

function acquireSharedRuleLock() {
  const child = spawn(
    'python3',
    [
      '-c',
      `
import fcntl, os, signal, sys, time
path = sys.argv[1]
pid = sys.argv[2]
fh = open(path, "w")
try:
    fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError as exc:
    sys.stderr.write(f"busy:{exc}\\n")
    sys.exit(2)
fh.write(f"{pid}\\n{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}\\nsetup-verify-offer\\n")
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

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureFixture() {
  await mkdir(fixtureApp, { recursive: true });
  const hello = join(fixtureApp, 'hello.sh');
  const readme = join(fixtureApp, 'README.md');
  if (!(await pathExists(hello))) {
    await writeFile(hello, '#!/bin/sh\necho HELLO-SETUP-VERIFY-OFFER\n');
  }
  await chmod(hello, 0o755).catch(() => {});
  if (!(await pathExists(readme))) {
    await writeFile(
      readme,
      '# hello-cli\n\nTiny CLI fixture for setup-verify-offer capture. No verify-* skill and no harness.\n',
    );
  }
  await rm(join(fixtureApp, '.cursor', 'skills'), { recursive: true, force: true });
  await rm(join(fixtureApp, '.pi', 'skills'), { recursive: true, force: true });
}

function observeOffer(lines) {
  const text = lines.join('\n');
  const offerHit = OFFER_NEEDLES.find((needle) => text.toLowerCase().includes(needle.toLowerCase()));
  const createAttached =
    /\[skill\]\s*create-verification/i.test(text) ||
    /Running create-verification-skill/i.test(text) ||
    /Invoking \/create-verification-skill/i.test(text) ||
    (/\/create-verification-skill\b/i.test(text) &&
      /Writing .*SKILL\.md|## Launch|feature map|verify-[a-z0-9-]+\/SKILL/i.test(text));
  return {
    writeCard: new RegExp(WRITE_NEEDLE, 'i').test(text),
    askQuestion: /› \[/.test(text) || /Clarifying Questions/i.test(text),
    chatForm: /Reply with a number|Reply with one of those four labels|Pick a budget:/i.test(text),
    offerHit: offerHit ?? null,
    offered: Boolean(offerHit),
    createAttached,
    declinedLanguage:
      /skipped (the )?(optional )?(step of )?offering/i.test(text) ||
      /decline(d)? (any )?verification/i.test(text) ||
      /without (offering|pushing)/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function skillPaths(side) {
  return side === 'cursor'
    ? [
        join(fixtureApp, '.cursor', 'skills'),
        join(fixtureApp, '.cursor', 'skills', 'verify-hello-cli', 'SKILL.md'),
      ]
    : [join(fixtureApp, '.pi', 'skills'), join(fixtureApp, '.pi', 'skills', 'verify-hello-cli', 'SKILL.md')];
}

async function anyVerifySkillOnDisk(side) {
  const [skillsRoot] = skillPaths(side);
  if (!(await pathExists(skillsRoot))) return false;
  try {
    const listing = execFileSync('find', [skillsRoot, '-type', 'f', '-name', 'SKILL.md'], {
      encoding: 'utf8',
    });
    return listing
      .split('\n')
      .filter(Boolean)
      .some((path) => /verify-/i.test(path));
  } catch {
    return false;
  }
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'setup-pstack:verify-offer',
    fixtureRef: { path: fixturePath, digest: fixtureDigest },
    artifactPaths: [],
    launch: { argv, cwd, env },
    geometry: GEOMETRY,
  };
}

const cursorSpec = (fixtureDigest) =>
  spec({
    side: 'cursor',
    cwd: fixtureApp,
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
    cwd: fixtureApp,
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
  const backupPath = `${referenceRulePath}.setup-verify-offer-backup`;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rename(backupPath, referenceRulePath);
    } catch {
      await writeFile(referenceRulePath, lockedBytes);
    }
    await writeFile(piRulePath, lockedBytes);
    const digest = await sha256(referenceRulePath);
    if (digest === LOCKED_FIXTURE_DIGEST) return digest;
    await sleep(400);
  }
  return sha256(referenceRulePath);
}

async function ensurePiTrust() {
  const trustPath = join(piAgentDir, 'trust.json');
  let current = {};
  try {
    current = JSON.parse(await readFile(trustPath, 'utf8'));
  } catch {
    current = {};
  }
  if (current[fixtureApp] === true) return;
  await mkdir(piAgentDir, { recursive: true });
  await writeFile(trustPath, `${JSON.stringify({ ...current, [fixtureApp]: true }, null, 2)}\n`);
}

async function waitPiChatReady(attempt, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lines = [];
  while (Date.now() < deadline) {
    lines = await screenLines(attempt, GEOMETRY);
    const text = lines.join('\n');
    if (/Trust project folder\?/i.test(text)) {
      attempt.input(Buffer.from('\r'), 'literal_user');
      await sleep(800);
      continue;
    }
    const chatReady =
      !/Trust project folder\?/i.test(text) &&
      (/claude-subscription|claude-sonnet/i.test(text) || /\$0\.\d+/.test(text)) &&
      (/fixture-app|hello-cli|Skill conflicts|medium/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
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
    for (let i = 0; i < 3; i += 1) {
      attempt.input(Buffer.from('\x1b[B'), 'literal_user');
      await sleep(150);
    }
    attempt.input(Buffer.from(' '), 'literal_user');
    await sleep(200);
    attempt.input(Buffer.from('\r'), 'literal_user');
    return { path: 'askquestion-budget', first };
  }
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
    const text = last.join('\n');
    const writeCard = new RegExp(WRITE_NEEDLE, 'i').test(text);
    if (writeCard) {
      await dumpScreen(attempt, dir, '02-role-confirm-or-write', GEOMETRY);
      return { kind: 'wrote-before-confirm', lines: last };
    }
    const confirmHit = ROLE_CONFIRM_NEEDLES.some((needle) => last.some((line) => line.includes(needle)));
    if (confirmHit) {
      await waitSettled(attempt, GEOMETRY, 90_000).catch(() => {});
      await sleep(800);
      last = await dumpScreen(attempt, dir, '02-role-confirm', GEOMETRY);
      return { kind: 'role-confirm', lines: last };
    }
    if (/› \[/.test(text) && panel <= 6) {
      await dumpScreen(attempt, dir, `0${panel}-panel`, GEOMETRY);
      panel += 1;
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
  return { kind: 'timeout', lines: last };
}

async function acceptRoles(attempt, lines) {
  const text = lines.join('\n');
  // Do not mention declining verification. That is the signal under test after write.
  if (/› \[/.test(text)) {
    for (let i = 0; i < 4; i += 1) {
      attempt.input(Buffer.from('\x1b[A'), 'literal_user');
      await sleep(120);
    }
    attempt.input(Buffer.from(' '), 'literal_user');
    await sleep(200);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(400);
    const after = (await screenLines(attempt, GEOMETRY)).join('\n');
    if (/› \[/.test(after) && /Other:/i.test(after)) {
      attempt.input(Buffer.from('Accept as-is. Keep every role inherit-parent. Write the rule.'), 'literal_user');
      await sleep(200);
      attempt.input(Buffer.from('\r'), 'literal_user');
      return 'askquestion-other-accept';
    }
    return 'askquestion-accept';
  }
  attempt.input(Buffer.from('Accept as-is. Keep every role inherit-parent. Write the rule.'), 'literal_user');
  attempt.input(Buffer.from('\r'), 'literal_user');
  return 'chatform-accept';
}

async function waitOffer(attempt, dir, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observeOffer(last);
    if (obs.offered && !obs.working) {
      await dumpScreen(attempt, dir, '04-offer', GEOMETRY);
      return { kind: 'offer', lines: last, obs };
    }
    if (obs.declinedLanguage && !obs.offered && !obs.working) {
      await dumpScreen(attempt, dir, '04-no-offer-skipped', GEOMETRY);
      return { kind: 'skipped', lines: last, obs };
    }
    await sleep(400);
  }
  await dumpScreen(attempt, dir, '04-offer-timeout', GEOMETRY);
  return { kind: 'timeout', lines: last, obs: observeOffer(last) };
}

async function answerOffer(attempt, dir) {
  const lines = await screenLines(attempt, GEOMETRY);
  const text = lines.join('\n');
  if (/› \[/.test(text)) {
    if (branch === 'yes') {
      // Prefer Yes / first affirmative option.
      for (let i = 0; i < 4; i += 1) {
        attempt.input(Buffer.from('\x1b[A'), 'literal_user');
        await sleep(100);
      }
      attempt.input(Buffer.from(' '), 'literal_user');
      await sleep(150);
      attempt.input(Buffer.from('\r'), 'literal_user');
      await sleep(400);
      const after = (await screenLines(attempt, GEOMETRY)).join('\n');
      if (/› \[/.test(after) && /Other:/i.test(after)) {
        attempt.input(Buffer.from('Yes'), 'literal_user');
        attempt.input(Buffer.from('\r'), 'literal_user');
      }
    } else {
      // Prefer No / last option.
      for (let i = 0; i < 4; i += 1) {
        attempt.input(Buffer.from('\x1b[B'), 'literal_user');
        await sleep(100);
      }
      attempt.input(Buffer.from(' '), 'literal_user');
      await sleep(150);
      attempt.input(Buffer.from('\r'), 'literal_user');
      await sleep(400);
      const after = (await screenLines(attempt, GEOMETRY)).join('\n');
      if (/› \[/.test(after) && /Other:/i.test(after)) {
        attempt.input(Buffer.from('No'), 'literal_user');
        attempt.input(Buffer.from('\r'), 'literal_user');
      }
    }
    await dumpScreen(attempt, dir, '05-offer-answered', GEOMETRY);
    return 'askquestion-offer';
  }
  attempt.input(Buffer.from(branch === 'yes' ? 'Yes' : 'No'), 'literal_user');
  attempt.input(Buffer.from('\r'), 'literal_user');
  await dumpScreen(attempt, dir, '05-offer-answered', GEOMETRY);
  return 'chatform-offer';
}

async function waitBranchSettle(attempt, dir, side, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let calm = 0;
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observeOffer(last);
    if (branch === 'yes') {
      if (obs.createAttached && !obs.working) {
        calm += 1;
        if (calm >= 2) {
          await dumpScreen(attempt, dir, '06-branch-settled', GEOMETRY);
          return last;
        }
      } else calm = 0;
    } else {
      const skillOnDisk = await anyVerifySkillOnDisk(side);
      if (!obs.working && !obs.createAttached && !skillOnDisk && (obs.offered || obs.declinedLanguage || obs.writeCard)) {
        calm += 1;
        if (calm >= 3) {
          await dumpScreen(attempt, dir, '06-branch-settled', GEOMETRY);
          return last;
        }
      } else calm = 0;
    }
    await sleep(500);
  }
  await dumpScreen(attempt, dir, '06-branch-timeout', GEOMETRY);
  return last;
}

async function runSide(side, lockedBytes, lockedDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.setup-verify-offer-backup`;
  await mkdir(dir, { recursive: true });
  await writeFile(backupPath, lockedBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  let attempt;
  const observations = {
    side,
    branch,
    screens: {},
    pathNotes: [],
  };
  try {
    await writeFile(rulePath, lockedBytes);
    await ensurePiTrust();
    attempt = await startAttempt(side === 'cursor' ? await cursorSpec(lockedDigest) : await piSpec(lockedDigest));
    if (side === 'cursor') await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    else await waitPiChatReady(attempt, 120_000);
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);

    attempt.input(Buffer.from('/setup-pstack'), 'literal_user');
    await sleep(800);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(400);
    attempt.input(Buffer.from('\r'), 'literal_user');

    const budget = await answerBudgetOnly(attempt, dir);
    observations.budgetPath = budget.path;
    observations.pathNotes.push(`budget=${budget.path}`);

    const confirm = await waitRoleConfirmOrWrite(attempt, dir, 300_000);
    observations.confirmKind = confirm.kind;
    observations.pathNotes.push(`confirm=${confirm.kind}`);

    let acceptPath = null;
    if (confirm.kind === 'role-confirm' || confirm.kind === 'timeout') {
      acceptPath = await acceptRoles(attempt, confirm.lines);
      observations.acceptPath = acceptPath;
      observations.pathNotes.push(`accept=${acceptPath}`);
    } else {
      observations.acceptPath = 'none-wrote-first';
    }

    const wrote = await waitScreen(attempt, GEOMETRY, WRITE_NEEDLE, 360_000)
      .then(() => true)
      .catch(() => false);
    await dumpScreen(attempt, dir, wrote ? '03-write-card' : '03-no-write', GEOMETRY);
    observations.writeCardSeen = wrote;
    observations.screens.writeCard = observeOffer(await screenLines(attempt, GEOMETRY));
    await waitSettled(attempt, GEOMETRY, 180_000).catch(() => {});
    await sleep(1500);
    await dumpScreen(attempt, dir, '03b-after-write', GEOMETRY);

    // Offer may already be on the after-write screen.
    let offer = observeOffer(await screenLines(attempt, GEOMETRY));
    if (offer.offered) {
      await dumpScreen(attempt, dir, '04-offer', GEOMETRY);
      offer = { kind: 'offer', lines: await screenLines(attempt, GEOMETRY), obs: offer };
    } else {
      offer = await waitOffer(attempt, dir, 180_000);
    }
    observations.offerKind = offer.kind;
    observations.screens.offer = offer.obs;
    observations.offeredOnce = offer.obs.offered === true;
    observations.offerHit = offer.obs.offerHit;

    let answerPath = null;
    if (offer.kind === 'offer') {
      answerPath = await answerOffer(attempt, dir);
      observations.answerPath = answerPath;
      observations.pathNotes.push(`answer=${answerPath}`);
      const settledLines = await waitBranchSettle(attempt, dir, side, branch === 'yes' ? 300_000 : 180_000);
      observations.screens.branchSettled = observeOffer(settledLines);
    } else {
      await dumpScreen(attempt, dir, '05-no-offer-to-answer', GEOMETRY);
      observations.answerPath = 'none';
      observations.screens.branchSettled = observeOffer(await screenLines(attempt, GEOMETRY));
    }

    const skillOnDisk = await anyVerifySkillOnDisk(side);
    const finalObs = observations.screens.branchSettled ?? observeOffer(await screenLines(attempt, GEOMETRY));
    observations.createVerifyInvoked = Boolean(finalObs.createAttached || (branch === 'yes' && skillOnDisk));
    observations.skillWritten = skillOnDisk;
    observations.continuedWithoutPush =
      branch === 'no' && !observations.createVerifyInvoked && !skillOnDisk;
    observations.branchOk =
      branch === 'no'
        ? observations.offeredOnce && observations.continuedWithoutPush
        : observations.offeredOnce && observations.createVerifyInvoked;

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-before.mdc'), lockedBytes);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    observations.afterDigest = afterDigest;
    observations.wroteBytesChanged = after !== lockedBytes;

    for (const name of [
      '00-ready',
      '01-budget',
      '02-role-confirm',
      '02-role-confirm-or-write',
      '03-write-card',
      '03b-after-write',
      '04-offer',
      '04-no-offer-skipped',
      '04-offer-timeout',
      '05-offer-answered',
      '06-branch-settled',
    ]) {
      try {
        await copyFile(join(dir, `screen-${name}.txt`), join(attempt.dir, `screen-${name}.txt`));
      } catch {
        // optional dump
      }
    }
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(attempt.dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);

    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      fixtureDigest: lockedDigest,
      afterDigest,
      branch,
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

await ensureFixture();

const peersAtStart = peerSetupCaptures();
if (peersAtStart.length > 0) {
  console.error(JSON.stringify({ error: 'peer setup captures still running; refuse non-isolated run', peers: peersAtStart }));
  process.exit(3);
}

let lock;
try {
  lock = await acquireSharedRuleLock();
} catch (error) {
  console.error(JSON.stringify({ error: String(error?.message ?? error), sharedRuleLockPath }));
  process.exit(4);
}

try {
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
    scenario: 'setup-pstack:verify-offer',
    scenarioId: 'setup-verify-offer',
    requirementIds: ['PSTACK-SETUP-VERIFY-OFFER-001'],
    branch,
    fixtureDigest: lockedDigest,
    lockedFixtureDigest: LOCKED_FIXTURE_DIGEST,
    restoredLockedDigest: restoredDigest,
    fixtureApp,
    isolation: {
      sharedRuleLockPath,
      peersAtStart,
      peersAtEnd: peerSetupCaptures(),
    },
    results,
  };
  await writeFile(join(evidenceRoot, 'capture-results.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(out));
  if (restoredDigest !== LOCKED_FIXTURE_DIGEST) {
    console.error('Failed to restore locked reference rule digest');
    process.exit(2);
  }
} finally {
  if (lock) lock.release();
}
