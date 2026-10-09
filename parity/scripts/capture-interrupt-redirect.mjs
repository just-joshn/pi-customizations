#!/usr/bin/env node
// Family 07 first pair: long /how mid-run Escape cancel, then a distinct redirect objective.
// Real PTY both sides via the recorder. Screens plus marker files are the oracle.
//
// Usage: node scripts/capture-interrupt-redirect.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/interrupt/
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'interrupt');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 420_000;
const ESC = Buffer.from('\u001b');
const CTRL_C = Buffer.from('\u0003');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function markerRootFor(side) {
  return join(evidenceRoot, 'fixture-out', side);
}

function cancelledPath(side) {
  return join(markerRootFor(side), 'cancelled-how.txt');
}

function redirectPath(side) {
  return join(markerRootFor(side), 'redirect-ok.txt');
}

function howPrompt(side) {
  return (
    `/how does startAttempt in parity/recorder/attempt.mjs allocate the attempt directory ` +
    `and append events.jsonl? Trace the real source under parity/recorder/ with line citations. ` +
    `Before finishing, write exactly CANCELLED-HOW-COMPLETE as the only line of ${cancelledPath(side)}. ` +
    `Do not edit product code or ledgers. Be thorough.`
  );
}

function redirectPrompt(side) {
  return (
    `Stop. Ignore the prior /how completely. Do not continue that investigation and do not write ` +
    `${cancelledPath(side)}. New objective only: write exactly REDIRECT-OK as the only line of ` +
    `${redirectPath(side)}, then reply with the single line REDIRECT-OK 56 and nothing about the recorder.`
  );
}

function isWorking(text) {
  return /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text);
}

function observeInterrupt(lines) {
  const text = lines.join('\n');
  return {
    howSkill:
      /Used how/i.test(text) ||
      /\[skill\]\s*how/i.test(text) ||
      /skill:\s*how/i.test(text) ||
      (/\/how\b/i.test(text) && /startAttempt|events\.jsonl|recorder/i.test(text)),
    midFlightSignal:
      /startAttempt|events\.jsonl|allocateDir|recorder|Reading|Read |Tool|Task|Todo/i.test(text) ||
      isWorking(text),
    working: isWorking(text),
    cancelledMarkerMention: /CANCELLED-HOW-COMPLETE/i.test(text),
    redirectMarkerMention: /REDIRECT-OK/i.test(text),
    redirectAnswer: /REDIRECT-OK\s*56/i.test(text),
    cancelChrome:
      /stopp?ed|interrupt|cancel|aborted|Interrupted|Esc to|Generation stopped|User cancelled/i.test(text),
  };
}

async function readMarkers(side) {
  const result = {
    cancelledPath: cancelledPath(side),
    redirectPath: redirectPath(side),
    cancelled: null,
    redirect: null,
  };
  try {
    result.cancelled = (await readFile(result.cancelledPath, 'utf8')).trim();
  } catch {
    result.cancelled = null;
  }
  try {
    result.redirect = (await readFile(result.redirectPath, 'utf8')).trim();
  } catch {
    result.redirect = null;
  }
  result.redirectOk = result.redirect === 'REDIRECT-OK';
  result.cancelledCompleted = result.cancelled === 'CANCELLED-HOW-COMPLETE';
  return result;
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'interrupt:how-escape-then-redirect',
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
  const backupPath = `${referenceRulePath}.interrupt-redirect-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function waitRedirectSettled(attempt, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let calm = 0;
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observeInterrupt(last);
    const markersOk = (await readMarkers(attempt._side)).redirectOk;
    if (!obs.working && (obs.redirectAnswer || markersOk || obs.redirectMarkerMention)) {
      calm += 1;
      if (calm >= 3) return last;
    } else {
      calm = 0;
    }
    await sleep(800);
  }
  return last;
}

async function waitMidFlight(attempt, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observeInterrupt(last);
    if (obs.working || obs.howSkill || obs.midFlightSignal) {
      // Prefer a clear Working signal so Escape hits an in-flight turn.
      if (obs.working || obs.howSkill) return last;
    }
    await sleep(250);
  }
  return last;
}

async function sendCancel(attempt) {
  // User-control cancel first (Escape). Ctrl-C only if still Working after a short wait.
  attempt.input(ESC, 'literal_user');
  await sleep(1200);
  let lines = await screenLines(attempt, GEOMETRY);
  if (isWorking(lines.join('\n'))) {
    attempt.input(ESC, 'literal_user');
    await sleep(1200);
    lines = await screenLines(attempt, GEOMETRY);
  }
  if (isWorking(lines.join('\n'))) {
    attempt.input(CTRL_C, 'literal_user');
    await sleep(1200);
  }
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.interrupt-redirect-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(markerRootFor(side), { recursive: true });
  await rm(cancelledPath(side), { force: true });
  await rm(redirectPath(side), { force: true });
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const observations = {};
  const how = howPrompt(side);
  const redirect = redirectPrompt(side);
  let attempt;
  try {
    await writeFile(rulePath, ruleBytes);
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(ruleDigest) : piSpec(ruleDigest));
    attempt._side = side;
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitEither(attempt, GEOMETRY, ['first-run', 'pi'], 120_000);
    }
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);
    observations.ready = observeInterrupt(await screenLines(attempt, GEOMETRY));

    attempt.input(Buffer.from(how), 'literal_user');
    await sleep(600);
    await dumpScreen(attempt, dir, '01-how-typed', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '02-how-submitted', GEOMETRY);

    const midLines = await waitMidFlight(attempt, 240_000);
    await dumpScreen(attempt, dir, '03-midflight', GEOMETRY);
    observations.mid = observeInterrupt(midLines.length ? midLines : await screenLines(attempt, GEOMETRY));
    observations.midMarkers = await readMarkers(side);

    await sendCancel(attempt);
    await dumpScreen(attempt, dir, '04-after-cancel-key', GEOMETRY);
    try {
      await waitSettled(attempt, GEOMETRY, 120_000);
    } catch {
      // settle is best-effort after interrupt
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '05-after-cancel-settled', GEOMETRY);
    observations.afterCancel = observeInterrupt(await screenLines(attempt, GEOMETRY));
    observations.afterCancelMarkers = await readMarkers(side);

    attempt.input(Buffer.from(redirect), 'literal_user');
    await sleep(600);
    await dumpScreen(attempt, dir, '06-redirect-typed', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '07-redirect-submitted', GEOMETRY);

    const finalLines = await waitRedirectSettled(attempt, SETTLE_MS);
    try {
      await waitSettled(attempt, GEOMETRY, 60_000);
    } catch {
      // best-effort calm after redirect
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '08-redirect-settled', GEOMETRY);
    observations.final = observeInterrupt(finalLines.length ? finalLines : await screenLines(attempt, GEOMETRY));
    observations.finalMarkers = await readMarkers(side);

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'how-prompt.txt'), `${how}\n`);
    await writeFile(join(dir, 'redirect-prompt.txt'), `${redirect}\n`);
    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      ruleUnchanged: after === ruleBytes,
      afterDigest,
      fixtureDigest: ruleDigest,
      how,
      redirect,
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
  const result = await runSide(side, preRule, preDigest);
  results.push(result);
  console.log(JSON.stringify(result));
}
console.log(
  JSON.stringify({
    scenario: 'interrupt:how-escape-then-redirect',
    fixtureDigest: preDigest,
    results,
  }),
);
