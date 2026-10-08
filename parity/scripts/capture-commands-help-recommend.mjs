#!/usr/bin/env node
// Help-only pair for CMD-POTETO-HELP-RECOMMENDATION.
// Real PTY both sides. Screens are the oracle for the primary skill string.
//
// Usage: node scripts/capture-commands-help-recommend.mjs [--cursor-only|--pi-only]
// Evidence root: parity/evidence/commands/
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitScreen } from './journey-helpers.mjs';

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
const SKILLS = ['/interrogate', '/review-and-ship', '/blast-radius', '/poteto-mode', '/no-comments'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function primaryRecommendation(text) {
  const lead =
    text.match(/\bUse\s+[`'"]?(\/[a-z0-9-]+)/) ||
    text.match(/recommend(?:ed|s)?\s+(?:the\s+)?(?:skill\s+)?[`'"]?(\/[a-z0-9-]+)/i) ||
    text.match(/primary(?:\s+skill)?[:\s]+[`'"]?(\/[a-z0-9-]+)/i) ||
    text.match(/^ {0,2}(\/(?:interrogate|review-and-ship|blast-radius|poteto-mode|no-comments))\s*$/m);
  if (lead?.[1] && SKILLS.includes(lead[1])) return lead[1];
  // Prefer /interrogate when the answer names it before /review-and-ship as a close call.
  const interrogateAt = text.search(/\/interrogate/);
  const reviewShipAt = text.search(/\/review-and-ship/);
  if (interrogateAt >= 0 && (reviewShipAt < 0 || interrogateAt < reviewShipAt)) return '/interrogate';
  if (reviewShipAt >= 0) return '/review-and-ship';
  return null;
}

function observeHelp(lines) {
  const text = lines.join('\n');
  return {
    usedPotetoHelp: /Used poteto-help/i.test(text),
    skillBlock: /\[skill\]\s*poteto-help/i.test(text) || /skill:\s*poteto-help/i.test(text),
    helpRecommended: primaryRecommendation(text),
    mentionsInterrogate: /\/interrogate/i.test(text),
    mentionsReviewAndShip: /\/review-and-ship/i.test(text),
    handsPrompt: /type|try|run|prompt|\/[a-z0-9-]+/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'commands:poteto-help-branch-review-recommend',
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
      (/poteto-help/i.test(text) && /\/interrogate|\/review-and-ship|review this branch/i.test(text));
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
  await mkdir(dir, { recursive: true });
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
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

    attempt.input(Buffer.from(HELP_PROMPT), 'literal_user');
    await sleep(600);
    await dumpScreen(attempt, dir, '01-help-typed', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '02-help-submitted', GEOMETRY);
    const helpLines = await waitHelpSettled(attempt, 420_000);
    await dumpScreen(attempt, dir, '03-help-settled', GEOMETRY);
    const observations = { afterHelp: observeHelp(helpLines) };

    await writeFile(join(dir, 'observations-help-recommend.json'), `${JSON.stringify(observations, null, 2)}\n`);
    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      fixtureDigest: ruleDigest,
      observations,
    };
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
  }
}

const preRule = await readFile(referenceRulePath, 'utf8');
const preDigest = await sha256(referenceRulePath);
if (preDigest !== LOCKED_FIXTURE_DIGEST) {
  console.error(`Reference rule digest ${preDigest} does not match the locked fixture ${LOCKED_FIXTURE_DIGEST}`);
  process.exit(1);
}
await mkdir(join(piAgentDir, 'pstack'), { recursive: true });
const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
const results = [];
for (const side of sides) {
  const result = await runSide(side, preRule, preDigest);
  results.push(result);
  console.log(JSON.stringify(result));
}
console.log(
  JSON.stringify({
    scenario: 'commands:poteto-help-branch-review-recommend',
    fixtureDigest: preDigest,
    helpPrompt: HELP_PROMPT,
    results,
  }),
);
