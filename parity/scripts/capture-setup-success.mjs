#!/usr/bin/env node
// Captures the /setup-pstack success write journey: answer Clarifying Questions,
// let the write land, and retain the transcript card form. Restores the locked
// fixture after each side so later drivers keep the digest gate.
//
// Usage: node scripts/capture-setup-success.mjs [--cursor-only|--pi-only]
// Evidence root: parity/evidence/setup-success/
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, waitEither, waitGone, waitScreen, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'setup-success');
const GEOMETRY = { rows: 36, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'setup-pstack:success-write-card',
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
  });

const piSpec = (fixtureDigest) =>
  spec({
    side: 'pi',
    cwd: join(root, 'fixtures', 'first-run'),
    argv: [localBin('pi'), '--model', 'claude-subscription/claude-sonnet-5-5:medium'],
    env: { TERM: 'xterm-256color', HOME: process.env.HOME ?? '', PATH: process.env.PATH ?? '', PI_CODING_AGENT_DIR: piAgentDir },
    fixtureDigest,
    fixturePath: piRulePath,
  });

async function restoreRule(bytes) {
  const backupPath = `${referenceRulePath}.setup-success-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.setup-success-backup`;
  await mkdir(dir, { recursive: true });
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  let attempt;
  try {
    await writeFile(rulePath, ruleBytes);
    attempt = await startAttempt(side === 'cursor' ? await cursorSpec(ruleDigest) : await piSpec(ruleDigest));
    if (side === 'cursor') {
      await waitScreen(attempt, GEOMETRY, 'Tip:', 90_000);
    } else {
      await waitScreen(attempt, GEOMETRY, 'first-run', 120_000);
    }
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);
    attempt.input(Buffer.from('/setup-pstack'), 'literal_user');
    await sleep(800);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(400);
    attempt.input(Buffer.from('\r'), 'literal_user');
    const chatFormNeedles = ['Reply with a number', 'Reply with one of those four labels', 'Pick a budget:'];
    const first = await waitEither(attempt, GEOMETRY, ['› [', 'Edited pstack-models.mdc', ...chatFormNeedles], 300_000);
    await dumpScreen(attempt, dir, '01-question', GEOMETRY);
    if (first === '› [') {
      attempt.input(Buffer.from(' '), 'literal_user');
      attempt.input(Buffer.from('\r'), 'literal_user');
      for (let panel = 2; panel <= 5; panel += 1) {
        await waitGone(attempt, GEOMETRY, '› [', 60_000).catch(() => {});
        const next = await waitScreen(attempt, GEOMETRY, '› [', 45_000)
          .then(() => true)
          .catch(() => false);
        if (!next) break;
        await sleep(900);
        await dumpScreen(attempt, dir, `0${panel}-panel`, GEOMETRY);
        attempt.input(Buffer.from(' '), 'literal_user');
        attempt.input(Buffer.from('\r'), 'literal_user');
      }
      await waitGone(attempt, GEOMETRY, '› [', 60_000).catch(() => {});
    } else if (chatFormNeedles.includes(first)) {
      // Model-authored chat form instead of AskQuestion. Prefer the exact unlimited label.
      attempt.input(Buffer.from('unlimited — max reasoning'), 'literal_user');
      attempt.input(Buffer.from('\r'), 'literal_user');
      const afterBudget = await waitEither(
        attempt,
        GEOMETRY,
        ['› [', 'Edited pstack-models.mdc', 'Reply with', 'Accept', 'roles', 'inherit-parent'],
        300_000,
      );
      if (afterBudget === '› [') {
        attempt.input(Buffer.from(' '), 'literal_user');
        attempt.input(Buffer.from('\r'), 'literal_user');
      } else if (afterBudget !== 'Edited pstack-models.mdc') {
        attempt.input(Buffer.from('accept'), 'literal_user');
        attempt.input(Buffer.from('\r'), 'literal_user');
      }
    }
    await waitScreen(attempt, GEOMETRY, 'Edited pstack-models.mdc', 300_000);
    await dumpScreen(attempt, dir, '02-write-card', GEOMETRY);
    await waitSettled(attempt, GEOMETRY, 240_000);
    await sleep(2_000);
    await dumpScreen(attempt, dir, '03-final', GEOMETRY);
    const after = await readFile(rulePath, 'utf8');
    await writeFile(join(dir, 'rule-after.mdc'), after);
    return {
      side,
      attemptDir: attempt.dir,
      wrote: after !== ruleBytes,
      afterDigest: await sha256(rulePath),
      fixtureDigest: ruleDigest,
      writeCard: 'Edited pstack-models.mdc',
    };
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
    await writeFile(rulePath, ruleBytes);
    if (side === 'cursor') await restoreRule(ruleBytes);
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
console.log(JSON.stringify({ scenario: 'setup-pstack:success-write-card', fixtureDigest: preDigest, results }));
