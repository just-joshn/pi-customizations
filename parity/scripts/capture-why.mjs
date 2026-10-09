#!/usr/bin/env node
// Captures the /why motivation journey on both sides: invoke the why skill with a
// small grounded design-rationale question, let the run settle, and retain transcript
// evidence. The rule fixture guard matches the other drivers; this journey must not
// mutate the models.mdc fixture.
//
// Usage: node scripts/capture-why.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/why/
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, waitScreen, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'why');
const GEOMETRY = { rows: 36, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
// After Pi slash-skill attach, the skill name is stripped and only the residual prompt
// remains. Keep that residual motivation-shaped (not a yes/no "does X" lookup).
const QUESTION = 'why what forces led pstack to use inherit-parent on role model lines in models.mdc';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'why:motivation-question',
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
  const backupPath = `${referenceRulePath}.why-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.why-backup`;
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
    // Screens and rule-after belong in the attempt dir so a later --pi-only/--cursor-only
    // run cannot overwrite a prior linked pair's side-root artifacts.
    const outDir = attempt.dir;
    await dumpScreen(attempt, outDir, '00-ready', GEOMETRY);
    attempt.input(Buffer.from(`/${QUESTION}`), 'literal_user');
    await sleep(800);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(5_000);
    await dumpScreen(attempt, outDir, '01-after-trigger', GEOMETRY);
    await waitSettled(attempt, GEOMETRY, 1_200_000);
    await sleep(2_000);
    await dumpScreen(attempt, outDir, '02-final', GEOMETRY);
    const after = await readFile(rulePath, 'utf8');
    const unchanged = after === ruleBytes;
    await writeFile(join(outDir, 'rule-after.mdc'), after);
    return { side, attemptDir: outDir, ruleUnchanged: unchanged, fixtureDigest: ruleDigest };
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
console.log(JSON.stringify({ scenario: 'why:motivation-question', fixtureDigest: preDigest, question: QUESTION, results }));
