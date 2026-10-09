#!/usr/bin/env node
// Captures PSTACK-SETUP-LOAD-STATE-001: /setup-pstack against an existing rule that
// carries distinctive budget/role values plus a retired `how critics` line. Observes
// whether those values become current choices and whether the retired line is dropped
// and listed. Cancels before write when possible. Restores the locked reference rule.
//
// Usage: node scripts/capture-setup-load-state.mjs [--cursor-only|--pi-only]
// Evidence root: parity/evidence/setup-load-state/
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitGone, waitScreen, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const sharedRuleLockPath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc.parity-lock');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'setup-load-state');
const GEOMETRY = { rows: 36, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const EXPECTED_FIXTURE_DIGEST = 'sha256:e8dcb7b71c421dd7ceae42b69f478396223d15ffe12257cb963fe7bba4e8f0a2';
const RETIRED_LINE = 'how critics: inherit-parent';
const MARKER_ROLE = 'bug-fix';
const MARKER_VALUE = 'auto';
const EXPECTED_BUDGET = 'small (medium)';

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
      // Real node argv only. Ignore shell wrappers that embed the same path in -c text.
      .filter((row) => !/(^|[\/\s])(zsh|bash|sh)\b/.test(row.command))
      .filter((row) => !/\bbuiltin\b/.test(row.command))
      .filter((row) => /(^|[\/\s])node(\s+|$).*parity\/scripts\/capture-setup-[^\s]*\.mjs\b/.test(row.command));
  } catch {
    return [];
  }
}

function acquireSharedRuleLock() {
  // Hold an exclusive fcntl lock in a child so peer captures that honor the same
  // lock path cannot restore ~/.cursor/rules/pstack-models.mdc under us. Peer
  // refusal below is still required for scripts that ignore this lock.
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
fh.write(f"{pid}\\n{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}\\nisolated setup-load-state\\n")
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

async function snapshotRuleDigest(label, path, digests) {
  const digest = await sha256(path);
  digests.push({ at: new Date().toISOString(), label, path, digest });
  return digest;
}

function buildFixture(lockedBytes) {
  const withMarker = lockedBytes
    .split('\n')
    .map((line) => (line.startsWith(`${MARKER_ROLE}:`) ? `${MARKER_ROLE}: ${MARKER_VALUE}` : line))
    .join('\n')
    .replace(/\n+$/, '');
  return `${withMarker}\n${RETIRED_LINE}\n`;
}

function agentVisibleText(lines) {
  // Drop the live editor echo and the "→ " transcript echo of our own sends so
  // observations cannot pass on text we typed into the prompt.
  return lines
    .filter((line) => !/^\s*→ /.test(line))
    .filter((line) => !/Keep the current budget|Drop and list the retired line|Show current choices before writing/i.test(line))
    .join('\n');
}

function observeLoad(lines) {
  const text = agentVisibleText(lines);
  const budgetNamed =
    text.includes(EXPECTED_BUDGET) ||
    /small — medium reasoning \(current\)/i.test(text) ||
    /current (rule )?records[`'"]?\s*small/i.test(text) ||
    /Current pstack budget is small/i.test(text) ||
    /budget[:\s]+small/i.test(text);
  const markerRoleLoaded =
    new RegExp(`${MARKER_ROLE}[^\\n]{0,40}${MARKER_VALUE}|${MARKER_VALUE}[^\\n]{0,40}${MARKER_ROLE}`, 'i').test(text) ||
    (/\bbug-fix\b/i.test(text) && /\bauto\b/i.test(text) && /except|currently|role/i.test(text));
  const retiredNamed = /how critics/i.test(text);
  const droppedLanguage = /dropp(?:ed|ing)|retired/i.test(text);
  const retiredListed = retiredNamed && droppedLanguage;
  const askQuestion = /› \[/.test(text) || /Clarifying Questions/i.test(text);
  const chatForm = /Reply with a number|Reply with one of those four labels|Pick a budget:/i.test(text);
  const writeCard = /Edited pstack-models\.mdc/i.test(text);
  return {
    budgetNamed,
    markerRoleLoaded,
    retiredNamed,
    droppedLanguage,
    retiredListed,
    askQuestion,
    chatForm,
    writeCard,
  };
}

function mergeObs(a, b) {
  return {
    budgetNamed: a.budgetNamed || b.budgetNamed,
    markerRoleLoaded: a.markerRoleLoaded || b.markerRoleLoaded,
    retiredNamed: a.retiredNamed || b.retiredNamed,
    droppedLanguage: a.droppedLanguage || b.droppedLanguage,
    retiredListed: a.retiredListed || b.retiredListed,
    askQuestion: a.askQuestion || b.askQuestion,
    chatForm: a.chatForm || b.chatForm,
    writeCard: a.writeCard || b.writeCard,
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'setup-pstack:load-state-retired-line',
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
  const backupPath = `${referenceRulePath}.setup-load-state-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, lockedBytes);
  }
  await writeFile(piRulePath, lockedBytes);
}

async function selectKeepCurrentBudget(attempt) {
  // Prefer the bottom budget option (small / current) via down arrows, then Space+Enter.
  for (let i = 0; i < 4; i += 1) {
    attempt.input(Buffer.from('\x1b[B'), 'literal_user');
    await sleep(150);
  }
  attempt.input(Buffer.from(' '), 'literal_user');
  await sleep(200);
  attempt.input(Buffer.from('\r'), 'literal_user');
}

async function runSide(side, fixtureBytes, fixtureDigest, lockedBytes) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.setup-load-state-backup`;
  await mkdir(dir, { recursive: true });
  await writeFile(backupPath, lockedBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const digests = [];
  let attempt;
  let combined = {
    budgetNamed: false,
    markerRoleLoaded: false,
    retiredNamed: false,
    droppedLanguage: false,
    retiredListed: false,
    askQuestion: false,
    chatForm: false,
    writeCard: false,
  };
  const pathNotes = [];
  try {
    await writeFile(rulePath, fixtureBytes);
    const plantedDigest = await snapshotRuleDigest('planted', rulePath, digests);
    if (side === 'cursor' && plantedDigest !== EXPECTED_FIXTURE_DIGEST) {
      throw new Error(`Planted Cursor rule digest ${plantedDigest} != ${EXPECTED_FIXTURE_DIGEST}`);
    }
    attempt = await startAttempt(side === 'cursor' ? await cursorSpec(fixtureDigest) : await piSpec(fixtureDigest));
    if (side === 'cursor') await waitScreen(attempt, GEOMETRY, 'Tip:', 90_000);
    else await waitScreen(attempt, GEOMETRY, 'first-run', 120_000);
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);
    await snapshotRuleDigest('00-ready', rulePath, digests);

    attempt.input(Buffer.from('/setup-pstack'), 'literal_user');
    if (side === 'pi') {
      await waitScreen(attempt, GEOMETRY, 'Configure which models pstack uses', 60_000).catch(() => {});
    }
    await sleep(800);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(400);
    attempt.input(Buffer.from('\r'), 'literal_user');

    const chatFormNeedles = ['Reply with a number', 'Reply with one of those four labels', 'Pick a budget:'];
    const first = await waitEither(attempt, GEOMETRY, ['› [', 'Edited pstack-models.mdc', ...chatFormNeedles], 300_000);
    let lines = await dumpScreen(attempt, dir, '01-budget', GEOMETRY);
    combined = mergeObs(combined, observeLoad(lines));
    await snapshotRuleDigest('01-budget', rulePath, digests);
    pathNotes.push(`first=${first}`);

    if (first === 'Edited pstack-models.mdc') {
      pathNotes.push('already-wrote');
    } else if (first === '› [') {
      await selectKeepCurrentBudget(attempt);
      pathNotes.push('askquestion-budget');
      for (let panel = 2; panel <= 6; panel += 1) {
        await waitGone(attempt, GEOMETRY, '› [', 90_000).catch(() => {});
        const next = await waitEither(
          attempt,
          GEOMETRY,
          ['› [', 'Edited pstack-models.mdc', 'how critics', 'dropped', 'Accept', ...chatFormNeedles],
          180_000,
        ).catch(() => null);
        lines = await dumpScreen(attempt, dir, `0${panel}-after-budget`, GEOMETRY);
        combined = mergeObs(combined, observeLoad(lines));
        await snapshotRuleDigest(`0${panel}-after-budget`, rulePath, digests);
        pathNotes.push(`panel${panel}=${next}`);
        if (next === 'Edited pstack-models.mdc') break;
        if (next === '› [') {
          // Accept as-is / keep roles when a second clarifying panel appears.
          attempt.input(Buffer.from(' '), 'literal_user');
          await sleep(200);
          attempt.input(Buffer.from('\r'), 'literal_user');
          continue;
        }
        if (chatFormNeedles.includes(next)) {
          // Answer budget only. Do not mention retired lines; the agent must list them.
          attempt.input(Buffer.from('small — medium reasoning'), 'literal_user');
          attempt.input(Buffer.from('\r'), 'literal_user');
          continue;
        }
        // Saw how critics / dropped / Accept in free text. Give one more settle dump then escape.
        break;
      }
    } else {
      pathNotes.push('chatform-budget');
      // Budget-only reply so screen observations cannot pass on our own prompt text.
      attempt.input(Buffer.from('small — medium reasoning'), 'literal_user');
      attempt.input(Buffer.from('\r'), 'literal_user');
      const after = await waitEither(
        attempt,
        GEOMETRY,
        ['› [', 'Edited pstack-models.mdc', 'how critics', 'dropped', 'Accept', 'bug-fix', 'roles'],
        360_000,
      ).catch(() => null);
      lines = await dumpScreen(attempt, dir, '02-after-chatform', GEOMETRY);
      combined = mergeObs(combined, observeLoad(lines));
      await snapshotRuleDigest('02-after-chatform', rulePath, digests);
      pathNotes.push(`afterChat=${after}`);
      if (after === '› [') {
        attempt.input(Buffer.from(' '), 'literal_user');
        await sleep(200);
        attempt.input(Buffer.from('\r'), 'literal_user');
      }
    }

    // Collect as much on-screen evidence as we can before cancelling.
    const settleDeadline = Date.now() + 300_000;
    let dumpIdx = 7;
    while (Date.now() < settleDeadline) {
      lines = await screenLines(attempt, GEOMETRY);
      combined = mergeObs(combined, observeLoad(lines));
      if (combined.budgetNamed && combined.markerRoleLoaded && (combined.retiredListed || combined.retiredNamed)) {
        break;
      }
      if (combined.writeCard) break;
      await sleep(2000);
    }
    lines = await dumpScreen(attempt, dir, `0${dumpIdx}-pre-cancel`, GEOMETRY);
    combined = mergeObs(combined, observeLoad(lines));
    await snapshotRuleDigest('07-pre-cancel', rulePath, digests);

    // Escape any open AskQuestion, then cancel the attempt without requiring a write.
    attempt.input(Buffer.from('\u001b'), 'literal_user');
    await sleep(800);
    await waitGone(attempt, GEOMETRY, '› [', 30_000).catch(() => {});
    await dumpScreen(attempt, dir, '08-after-escape', GEOMETRY);
    await waitSettled(attempt, GEOMETRY, 60_000).catch(() => {});
    lines = await dumpScreen(attempt, dir, '09-final', GEOMETRY);
    combined = mergeObs(combined, observeLoad(lines));

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await snapshotRuleDigest('rule-after', rulePath, digests);
    const fixtureHeldThroughScreens = digests
      .filter((row) => row.label !== 'rule-after')
      .every((row) => row.digest === fixtureDigest);
    const midRunLocked = digests.some(
      (row) => row.label !== 'rule-after' && row.digest === LOCKED_FIXTURE_DIGEST,
    );
    await writeFile(join(dir, 'rule-before.mdc'), fixtureBytes);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'rule-digests.json'), `${JSON.stringify(digests, null, 2)}\n`);
    const observations = {
      side,
      pathNotes,
      screens: combined,
      loadFromExisting: combined.budgetNamed && combined.markerRoleLoaded,
      retiredHandling: combined.retiredListed
        ? 'dropped-and-listed'
        : combined.retiredNamed
          ? 'named-without-drop-language'
          : combined.droppedLanguage
            ? 'drop-language-without-how-critics'
            : 'not-observed',
      ruleUnchanged: after === fixtureBytes,
      afterDigest,
      fixtureDigest,
      fixtureHeldThroughScreens,
      midRunLocked,
      digests,
    };
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

const peersAtStart = peerSetupCaptures();
if (peersAtStart.length > 0) {
  console.error(
    JSON.stringify({
      error: 'peer setup captures still running; refuse non-isolated run',
      peers: peersAtStart,
    }),
  );
  process.exit(3);
}

let sharedLock;
try {
  sharedLock = await acquireSharedRuleLock();
} catch (error) {
  console.error(String(error.message || error));
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
  const fixtureBytes = buildFixture(lockedBytes);
  const fixtureDigest = digestBytes(Buffer.from(fixtureBytes));
  if (fixtureDigest !== EXPECTED_FIXTURE_DIGEST) {
    console.error(`Built fixture digest ${fixtureDigest} != ${EXPECTED_FIXTURE_DIGEST}`);
    process.exit(1);
  }
  await writeFile(join(evidenceRoot, 'fixture-with-retired.mdc'), fixtureBytes);

  const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
  const results = [];
  for (const side of sides) {
    const peers = peerSetupCaptures();
    if (peers.length > 0) {
      console.error(JSON.stringify({ error: 'peer appeared before side', side, peers }));
      process.exit(3);
    }
    const result = await runSide(side, fixtureBytes, fixtureDigest, lockedBytes);
    results.push(result);
    console.log(JSON.stringify(result));
  }

  const restoredDigest = await sha256(referenceRulePath);
  const out = {
    scenario: 'setup-pstack:load-state-retired-line',
    requirementIds: ['PSTACK-SETUP-LOAD-STATE-001'],
    fixtureDigest,
    lockedFixtureDigest: LOCKED_FIXTURE_DIGEST,
    restoredLockedDigest: restoredDigest,
    retiredLine: RETIRED_LINE,
    markerRole: MARKER_ROLE,
    markerValue: MARKER_VALUE,
    expectedBudget: EXPECTED_BUDGET,
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
  if (sharedLock) sharedLock.release();
}
