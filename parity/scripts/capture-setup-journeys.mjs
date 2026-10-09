#!/usr/bin/env node
// Captures the /setup-pstack user journey on the Cursor reference and the Pi candidate
// with equal rule fixtures. The sides use side-appropriate step scripts while their
// flows diverge; recordPair takes over once the flows match. A run records every screen
// it waits on, the written rule with its digest, and restores the pre-run rule bytes.
//
// Usage: node scripts/capture-setup-journeys.mjs [--cursor-only|--pi-only]
// Evidence root: parity/evidence/setup-prepair/
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { startAttempt } from '../recorder/index.mjs';
import { renderScreen } from '../recorder/screen.mjs';

const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'setup-prepair');
const GEOMETRY = { rows: 36, cols: 120 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function screenLines(attempt) {
  const { lines } = await renderScreen(attempt.events(), GEOMETRY);
  return lines;
}

async function waitScreen(attempt, needle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lines = [];
  while (Date.now() < deadline) {
    lines = await screenLines(attempt);
    if (lines.some((line) => line.includes(needle))) return lines;
    await sleep(120);
  }
  throw new Error(`Screen did not show "${needle}" within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function waitEither(attempt, needles, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lines = [];
  while (Date.now() < deadline) {
    lines = await screenLines(attempt);
    const match = needles.find((needle) => lines.some((line) => line.includes(needle)));
    if (match) return match;
    await sleep(120);
  }
  throw new Error(`Screen did not show any of ${JSON.stringify(needles)} within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function waitGone(attempt, needle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lines = [];
  while (Date.now() < deadline) {
    lines = await screenLines(attempt);
    if (!lines.some((line) => line.includes(needle))) return lines;
    await sleep(120);
  }
  throw new Error(`Screen still showed "${needle}" after ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function waitSettled(attempt, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let calm = 0;
  while (Date.now() < deadline) {
    const lines = await screenLines(attempt);
    const busy = lines.some((line) => /[\u2800-\u28FF]/.test(line));
    calm = busy ? 0 : calm + 1;
    if (calm >= 2) return;
    await sleep(300);
  }
  throw new Error(`Agent did not settle within ${timeoutMs}ms`);
}

async function dumpScreen(attempt, dir, name) {
  const lines = await screenLines(attempt);
  await writeFile(join(dir, `screen-${name}.txt`), `${lines.join('\n').replace(/\n+$/, '')}\n`);
  return lines;
}

async function spec({ side, cwd, argv, env, fixtureDigest, fixturePath, scenario }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: scenario,
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
    argv: [localBin('cursor-agent'), '--plugin-dir', join(root, 'reference', 'cursor-plugins', 'pstack'), '--plugin-dir', join(root, 'reference', 'cursor-plugins', 'cursor-team-kit')],
    env: { TERM: 'xterm-256color', HOME: process.env.HOME ?? '', PATH: process.env.PATH ?? '' },
    fixtureDigest,
    fixturePath: referenceRulePath,
    scenario: 'setup-pstack:first-run-clarifying-questions',
  });

const piSpec = (fixtureDigest) =>
  spec({
    side: 'pi',
    cwd: join(root, 'fixtures', 'first-run'),
    argv: [localBin('pi'), '--model', 'claude-subscription/claude-sonnet-5-5:medium'],
    env: { TERM: 'xterm-256color', HOME: process.env.HOME ?? '', PATH: process.env.PATH ?? '', PI_CODING_AGENT_DIR: piAgentDir },
    fixtureDigest,
    fixturePath: piRulePath,
    scenario: 'setup-pstack:first-run-clarifying-questions',
  });

async function restoreRule(bytes) {
  const backupPath = `${referenceRulePath}.setup-prepair-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function runCursorJourney(ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, 'cursor');
  const backupPath = `${referenceRulePath}.setup-prepair-backup`;
  await writeFile(backupPath, ruleBytes);
  let attempt;
  try {
    await writeFile(referenceRulePath, ruleBytes);
    attempt = await startAttempt(await cursorSpec(ruleDigest));
    await waitScreen(attempt, 'Tip:', 90_000);
    await dumpScreen(attempt, dir, '00-ready');
    attempt.input(Buffer.from('/setup-pstack'), 'literal_user');
    await sleep(400);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(400);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await waitScreen(attempt, '› [', 300_000);
    await dumpScreen(attempt, dir, '01-question-1');
    attempt.input(Buffer.from(' '), 'literal_user');
    attempt.input(Buffer.from('\r'), 'literal_user');
    for (let panel = 2; panel <= 5; panel += 1) {
      await waitGone(attempt, '› [', 60_000).catch(() => {});
      const next = await waitScreen(attempt, '› [', 45_000).then(() => true).catch(() => false);
      if (!next) break;
      await sleep(900);
      await dumpScreen(attempt, dir, `0${panel}-panel`);
      attempt.input(Buffer.from(' '), 'literal_user');
      attempt.input(Buffer.from('\r'), 'literal_user');
    }
    await waitGone(attempt, '› [', 60_000).catch(() => {});
    const offered = await waitEither(attempt, ['verification skill'], 240_000).catch(() => null);
    if (offered !== null) {
      await dumpScreen(attempt, dir, '03-verification-offer');
      attempt.input(Buffer.from('No\r'), 'literal_user');
    } else {
      await waitEither(attempt, ['verification-skill'], 60_000).catch(() => {});
      await dumpScreen(attempt, dir, '03-offer-skipped');
    }
    await waitSettled(attempt, 240_000);
    await sleep(2_000);
    await dumpScreen(attempt, dir, '04-final');
    const written = await readFile(referenceRulePath, 'utf8');
    await writeFile(join(dir, 'written-rule.mdc'), written);
    return { writtenDigest: await sha256(join(dir, 'written-rule.mdc')), attemptDir: attempt.dir };
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
    await restoreRule(ruleBytes);
  }
}

async function runPiJourney(ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, 'pi');
  await mkdir(piRulePath.replace('/models.mdc', ''), { recursive: true });
  await writeFile(piRulePath, ruleBytes);
  let attempt;
  try {
    attempt = await startAttempt(await piSpec(ruleDigest));
    await waitScreen(attempt, 'first-run', 120_000);
    await dumpScreen(attempt, dir, '00-ready');
    attempt.input(Buffer.from('/setup-pstack'), 'literal_user');
    await waitScreen(attempt, 'Configure which models pstack uses', 60_000);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(400);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await waitScreen(attempt, '› [', 300_000);
    await dumpScreen(attempt, dir, '01-question-1');
    attempt.input(Buffer.from(' '), 'literal_user');
    attempt.input(Buffer.from('\r'), 'literal_user');
    for (let panel = 2; panel <= 5; panel += 1) {
      await waitGone(attempt, '› [', 60_000).catch(() => {});
      const next = await waitScreen(attempt, '› [', 45_000).then(() => true).catch(() => false);
      if (!next) break;
      await sleep(900);
      await dumpScreen(attempt, dir, `0${panel}-panel`);
      attempt.input(Buffer.from(' '), 'literal_user');
      attempt.input(Buffer.from('\r'), 'literal_user');
    }
    await waitGone(attempt, '› [', 60_000).catch(() => {});
    const offered = await waitEither(attempt, ['verification skill'], 240_000).catch(() => null);
    if (offered !== null) {
      await dumpScreen(attempt, dir, '03-verification-offer');
      attempt.input(Buffer.from('No\r'), 'literal_user');
    } else {
      await waitEither(attempt, ['verification-skill'], 60_000).catch(() => {});
      await dumpScreen(attempt, dir, '03-offer-skipped');
    }
    await waitSettled(attempt, 240_000);
    await sleep(2_000);
    await dumpScreen(attempt, dir, '04-final');
    const written = await readFile(piRulePath, 'utf8');
    await writeFile(join(dir, 'written-rule.mdc'), written);
    return { writtenDigest: await sha256(join(dir, 'written-rule.mdc')), attemptDir: attempt.dir };
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
    await writeFile(piRulePath, ruleBytes);
  }
}

const only = process.argv[2];
const runCursor = only !== '--pi-only';
const runPi = only !== '--cursor-only';

const ruleBytes = await readFile(referenceRulePath, 'utf8');
const ruleDigest = await sha256(referenceRulePath);
await mkdir(evidenceRoot, { recursive: true });
if (runCursor) await mkdir(join(evidenceRoot, 'cursor'), { recursive: true });
if (runPi) await mkdir(join(evidenceRoot, 'pi'), { recursive: true });
const results = { ruleDigest, sides: {} };
if (runCursor) results.sides.cursor = await runCursorJourney(ruleBytes, ruleDigest);
if (runPi) results.sides.pi = await runPiJourney(ruleBytes, ruleDigest);
await writeFile(join(evidenceRoot, 'journeys.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
