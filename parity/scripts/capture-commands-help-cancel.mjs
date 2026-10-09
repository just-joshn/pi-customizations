#!/usr/bin/env node
// Family 03 first pair: /setup-pstack Escape cancel, then /poteto-help (distinct help path).
// Cancel runs first so Clarifying Questions chrome is not displaced by a prior model turn.
// Real PTY both sides via the recorder. Screens are the oracle for chrome, not self-reports.
//
// Usage: node scripts/capture-commands-help-cancel.mjs [--cursor-only|--pi-only]
// Evidence root: parity/evidence/commands/
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitGone, waitScreen, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'commands');
const GEOMETRY = { rows: 36, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const HELP_PROMPT = '/poteto-help which skill should i use to review this branch?';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function observeHelp(lines) {
  const text = lines.join('\n');
  return {
    usedPotetoHelp: /Used poteto-help/i.test(text),
    skillBlock: /\[skill\]\s*poteto-help/i.test(text) || /skill:\s*poteto-help/i.test(text),
    mentionsReviewOrSkill: /review|skill|playbook|\/no-comments|\/interrogate|bugbot/i.test(text),
    handsPrompt: /type|try|run|prompt|\/[a-z0-9-]+/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
    clarifyingPanel: /Clarifying Questions|› \[/.test(text),
  };
}

function observeCancel(lines) {
  const text = lines.join('\n');
  return {
    clarifyingPanel: /Clarifying Questions|› \[/.test(text),
    questionPrompt: /› \[/.test(text),
    freeformBudgetAsk:
      /Which budget should pstack use/i.test(text) ||
      /Pick a (reasoning )?budget/i.test(text) ||
      /Reply with one of those/i.test(text) ||
      /1\.\s*unlimited/i.test(text),
    setupMention: /setup-pstack|Configure which models|Used setup-pstack/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

const CANCEL_NEEDLES = [
  '› [',
  'Clarifying Questions',
  'Question 1',
  'Which budget should pstack use',
  'Pick a reasoning budget',
  'Pick a budget',
  'Reply with one of those',
  '1. unlimited',
  'unlimited —',
];

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'commands:setup-escape-cancel-then-poteto-help',
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
  const backupPath = `${referenceRulePath}.commands-help-cancel-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function waitHelpSettled(attempt, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const text = last.join('\n');
    const busy = /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text);
    const helpChrome =
      /Used poteto-help/i.test(text) ||
      /\[skill\]\s*poteto-help/i.test(text) ||
      (/poteto-help/i.test(text) && /review|skill|playbook|\/[a-z]/i.test(text));
    if (helpChrome && !busy) {
      await sleep(800);
      const again = await screenLines(attempt, GEOMETRY);
      const againText = again.join('\n');
      if (!/[\u2800-\u28FF]/.test(againText) && !/\bWorking\b/.test(againText)) return again;
    }
    await sleep(400);
  }
  return last;
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.commands-help-cancel-backup`;
  await mkdir(dir, { recursive: true });
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const observations = {};
  let attempt;
  try {
    await writeFile(rulePath, ruleBytes);
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(ruleDigest) : piSpec(ruleDigest));
    if (side === 'cursor') {
      await waitScreen(attempt, GEOMETRY, 'Tip:', 90_000);
    } else {
      await waitScreen(attempt, GEOMETRY, 'first-run', 120_000);
    }
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);
    observations.ready = observeCancel(await screenLines(attempt, GEOMETRY));

    attempt.input(Buffer.from('/setup-pstack'), 'literal_user');
    if (side === 'pi') {
      try {
        await waitScreen(attempt, GEOMETRY, 'Configure which models pstack uses', 60_000);
      } catch {
        // slash autocomplete may already show; continue to submit
      }
    }
    await sleep(400);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(400);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await waitEither(attempt, GEOMETRY, CANCEL_NEEDLES, 420_000);
    await dumpScreen(attempt, dir, '01-question-unanswered', GEOMETRY);
    observations.beforeCancel = observeCancel(await screenLines(attempt, GEOMETRY));

    // Escape cancels Clarifying Questions; on freeform budget ask it clears composer
    // without answering so the rule write path is not taken.
    attempt.input(Buffer.from('\u001b'), 'literal_user');
    await sleep(800);
    try {
      await waitGone(attempt, GEOMETRY, '› [', 30_000);
    } catch {
      // freeform path never showed › [
    }
    await dumpScreen(attempt, dir, '02-after-escape', GEOMETRY);
    try {
      await waitSettled(attempt, GEOMETRY, 90_000);
    } catch {
      // settle is best-effort after cancel
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '03-after-cancel-settled', GEOMETRY);
    observations.afterCancel = observeCancel(await screenLines(attempt, GEOMETRY));

    attempt.input(Buffer.from(HELP_PROMPT), 'literal_user');
    await sleep(600);
    await dumpScreen(attempt, dir, '04-help-typed', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '05-help-submitted', GEOMETRY);
    const helpLines = await waitHelpSettled(attempt, 420_000);
    await dumpScreen(attempt, dir, '06-help-settled', GEOMETRY);
    observations.afterHelp = observeHelp(helpLines);

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      ruleUnchanged: after === ruleBytes,
      afterDigest,
      fixtureDigest: ruleDigest,
      observations,
      discardedPriors:
        side === 'cursor'
          ? [
              '886d7088-e56d-4533-bf9d-88be00dfccba',
              '94b23b30-a55c-4513-95d3-150105eefcf7',
              '6fbe605c-9003-470a-ba94-4bb8e55c57da',
            ]
          : undefined,
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
    scenario: 'commands:setup-escape-cancel-then-poteto-help',
    fixtureDigest: preDigest,
    helpPrompt: HELP_PROMPT,
    results,
  }),
);
