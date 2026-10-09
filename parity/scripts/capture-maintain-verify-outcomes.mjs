#!/usr/bin/env node
// Captures PSTACK-SETUP-MAINTAIN-VERIFY-OUTCOMES-001 (and SHIP-001 when PR/no-PR matches).
// Seeds an aligned verify-hello-cli, runs /maintain-verification-skill end to end,
// and records OUTCOME= + PR= markers. Real PTY both sides.
// Does NOT read or write ~/.cursor/rules/pstack-models.mdc.
// Does NOT edit ledgers.
//
// Usage:
//   node scripts/capture-maintain-verify-outcomes.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/maintain-verify/
import { access, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const execFileAsync = promisify(execFile);
const argvFlags = new Set(process.argv.slice(2));
const only = argvFlags.has('--cursor-only')
  ? '--cursor-only'
  : argvFlags.has('--pi-only')
    ? '--pi-only'
    : '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const piAgentDir = '/tmp/pi-ref-agent';
const evidenceRoot = join(root, 'evidence', 'maintain-verify');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const GEOMETRY = { rows: 40, cols: 120 };
const SETTLE_MS = 2_400_000;
const SKILL_NAME = 'verify-hello-cli';
const SCENARIO_REF = 'setup-maintain-verify-outcomes';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function skillRel(side) {
  return side === 'cursor'
    ? join('.cursor', 'skills', SKILL_NAME, 'SKILL.md')
    : join('.pi', 'skills', SKILL_NAME, 'SKILL.md');
}

function skillAbs(side) {
  return join(fixtureApp, skillRel(side));
}

function skillDir(side) {
  return join(fixtureApp, side === 'cursor' ? '.cursor' : '.pi', 'skills', SKILL_NAME);
}

function writeRootFor(side) {
  return join(evidenceRoot, 'fixture-out', side);
}

function outcomePath(side) {
  return join(writeRootFor(side), 'maintain-outcome.txt');
}

function digestText(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function skillBodyFor(side) {
  const evidenceRootRel =
    side === 'cursor' ? `.cursor/evidence/${SKILL_NAME}` : `.pi/evidence/${SKILL_NAME}`;
  return `---
name: ${SKILL_NAME}
description: Verify the hello-cli fixture via ./hello.sh (prints HELLO-FAMILY-13). Project-local verification skill with launch/drive and a feature map.
---

# ${SKILL_NAME}

Tiny hello-cli fixture used for maintain-verify outcomes capture.

## Launch

Fresh run of \`./hello.sh\` from the repo root. No server. Ready when the process exits.

## Doctor

\`\`\`bash
test -x ./hello.sh && head -1 ./hello.sh && echo doctor-ok
\`\`\`

Expect \`#!/bin/sh\` and \`doctor-ok\`.

## Drive

\`\`\`bash
mkdir -p ${evidenceRootRel}
./hello.sh >${evidenceRootRel}/stdout.txt 2>${evidenceRootRel}/stderr.txt
echo $? >${evidenceRootRel}/exit-code.txt
\`\`\`

## Evidence

- \`stdout.txt\` equals \`HELLO-FAMILY-13\` plus newline
- \`stderr.txt\` empty
- \`exit-code.txt\` contains \`0\`

## Cleanup

Do not kill by process name. Leave named evidence files in place.

## Helpers

None
`;
}

function featureReadme() {
  return `# Feature map

One feature for the hello print.

| Feature | File |
| --- | --- |
| hello print | hello-print.md |
`;
}

function featureHello() {
  return `# hello print

User runs \`./hello.sh\` and sees \`HELLO-FAMILY-13\`.

## Capture

Capture stdout, stderr, and exit code under the skill Evidence path.
`;
}

async function ensureFixtureBase() {
  await mkdir(fixtureApp, { recursive: true });
  const hello = join(fixtureApp, 'hello.sh');
  const readme = join(fixtureApp, 'README.md');
  await writeFile(hello, '#!/bin/sh\necho HELLO-FAMILY-13\n');
  await chmod(hello, 0o755);
  await writeFile(
    readme,
    '# hello-cli\n\nTiny CLI fixture for maintain-verify outcomes capture.\n\n## Run\n\n```bash\n./hello.sh\n```\n\nPrints `HELLO-FAMILY-13` and exits 0.\n',
  );
}

async function seedSkills(side) {
  await rm(join(fixtureApp, '.cursor', 'skills'), { recursive: true, force: true });
  await rm(join(fixtureApp, '.pi', 'skills'), { recursive: true, force: true });
  await rm(join(fixtureApp, '.cursor', 'evidence'), { recursive: true, force: true });
  await rm(join(fixtureApp, '.pi', 'evidence'), { recursive: true, force: true });
  await rm(join(fixtureApp, 'artifacts'), { recursive: true, force: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(outcomePath(side), { force: true });

  const dir = skillDir(side);
  await mkdir(join(dir, 'features'), { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), skillBodyFor(side));
  await writeFile(join(dir, 'features', 'README.md'), featureReadme());
  await writeFile(join(dir, 'features', 'hello-print.md'), featureHello());
}

function outcomesPrompt(side) {
  const out = outcomePath(side);
  const skillPath = skillAbs(side);
  return (
    `Run /maintain-verification-skill now against the existing ${SKILL_NAME} skill at ${skillPath}. ` +
    `Complete one full maintain pass for this tiny hello-cli (one feature already mapped). ` +
    `Only edit that skill directory. Never edit product code (hello.sh, README.md). ` +
    `Never edit parity/ ledgers or ~/.cursor/rules/pstack-models.mdc. ` +
    `End with exactly one named outcome among clean, changed, or blocked. ` +
    `Definitions: clean means full source and live coverage, nothing to ship, no branch or PR. ` +
    `changed means one PR of proven corrections. blocked means coverage unfinished or a proven fix cannot ship safely, with the blocker stated. ` +
    `Prefer clean when the seeded skill already matches ./hello.sh and live coverage passes. ` +
    `If clean or blocked: do not create a branch and do not open a PR. ` +
    `If changed: open exactly one PR of proven skill-dir corrections and no product-code edits. ` +
    `Write exactly these lines to ${out} and stop:\n` +
    `OUTCOME=<clean|changed|blocked>\n` +
    `PR=<none|url-or-path>\n` +
    `BLOCKER=<none|short reason>\n`
  );
}

function observeOutcomes(lines) {
  const text = lines.join('\n');
  const outcomeMatch = text.match(/\bOUTCOME\s*=\s*(clean|changed|blocked)\b/i);
  const prMatch = text.match(/\bPR\s*=\s*(\S+)/i);
  return {
    maintainInvoked:
      /maintain-verification-skill|\/maintain-verification/i.test(text) ||
      /\[skill\]\s*maintain-verification/i.test(text),
    outcomeMention: outcomeMatch ? outcomeMatch[1].toLowerCase() : null,
    prMention: prMatch ? prMatch[1] : null,
    prOpenedOnScreen:
      /https:\/\/github\.com\/[^\s]+\/pull\/\d+/i.test(text) ||
      /\bgh pr create\b/i.test(text) ||
      /opened (a |the )?PR\b/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

async function readOutcomeMarker(side) {
  const path = outcomePath(side);
  if (!(await pathExists(path))) {
    return {
      exists: false,
      path,
      raw: null,
      outcome: null,
      pr: null,
      blocker: null,
      ok: false,
    };
  }
  const raw = await readFile(path, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const outcomeLine = lines.find((l) => /^OUTCOME=/i.test(l));
  const prLine = lines.find((l) => /^PR=/i.test(l));
  const blockerLine = lines.find((l) => /^BLOCKER=/i.test(l));
  const outcome = outcomeLine ? outcomeLine.slice('OUTCOME='.length).toLowerCase() : null;
  const pr = prLine ? prLine.slice('PR='.length) : null;
  const blocker = blockerLine ? blockerLine.slice('BLOCKER='.length) : null;
  const outcomeOk = outcome === 'clean' || outcome === 'changed' || outcome === 'blocked';
  let definitionOk = false;
  if (outcome === 'clean') {
    definitionOk = !pr || pr.toLowerCase() === 'none';
  } else if (outcome === 'blocked') {
    definitionOk =
      (!pr || pr.toLowerCase() === 'none') &&
      Boolean(blocker) &&
      blocker.toLowerCase() !== 'none';
  } else if (outcome === 'changed') {
    definitionOk = Boolean(pr) && pr.toLowerCase() !== 'none';
  }
  return {
    exists: true,
    path,
    raw,
    outcome,
    pr,
    blocker,
    ok: outcomeOk && definitionOk,
    outcomeOk,
    definitionOk,
  };
}

async function gitSnapshot(label) {
  try {
    const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: fixtureApp,
    });
    const { stdout: branch } = await execFileAsync('git', ['branch', '--show-current'], {
      cwd: fixtureApp,
    });
    return {
      label,
      branch: branch.trim(),
      porcelain: status.trim(),
      skillOnlyDirty: status
        .trim()
        .split('\n')
        .filter(Boolean)
        .every((line) => /skills\/verify-hello-cli|fixture-out\/|evidence\/|artifacts\//.test(line)),
    };
  } catch (error) {
    return { label, error: String(error?.message ?? error) };
  }
}

function spec({ side, cwd, argv, env, fixtureDigest }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: SCENARIO_REF,
    fixtureRef: { path: fixtureApp, digest: fixtureDigest },
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
  });

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

async function waitOutcomesSettled(attempt, side, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let calm = 0;
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observeOutcomes(last);
    const marker = await readOutcomeMarker(side);
    if (marker.ok && !obs.working) {
      calm += 1;
      if (calm >= 2) return last;
    } else {
      calm = 0;
    }
    await sleep(1000);
  }
  return last;
}

async function waitOutcomeOnDisk(side, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const marker = await readOutcomeMarker(side);
    if (marker.outcomeOk) return marker;
    await sleep(800);
  }
  return readOutcomeMarker(side);
}

async function runSide(side, fixtureDigest) {
  const sideRoot = join(evidenceRoot, side);
  await mkdir(sideRoot, { recursive: true });
  await seedSkills(side);
  const prompt = outcomesPrompt(side);
  const gitBefore = await gitSnapshot('before');
  const observations = { seeded: true, gitBefore };
  let attempt;
  try {
    if (side === 'pi') await ensurePiTrust();
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(fixtureDigest) : piSpec(fixtureDigest));
    const dir = attempt.dir;
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitPiChatReady(attempt, 120_000);
    }
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);

    attempt.input(Buffer.from(prompt), 'literal_user');
    await sleep(600);
    await dumpScreen(attempt, dir, '01-outcomes-typed', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '02-outcomes-submitted', GEOMETRY);

    try {
      await waitEither(
        attempt,
        GEOMETRY,
        [
          'maintain-verification',
          'verify-hello-cli',
          'OUTCOME=',
          'clean',
          'changed',
          'blocked',
          'source wave',
          'live pass',
          'Ship',
        ],
        300_000,
      );
    } catch {
      // settle may still land the marker
    }
    await dumpScreen(attempt, dir, '03-outcomes-signal', GEOMETRY);
    observations.mid = observeOutcomes(await screenLines(attempt, GEOMETRY));
    observations.markerMid = await readOutcomeMarker(side);

    const settleLines = await waitOutcomesSettled(attempt, side, SETTLE_MS);
    await waitOutcomeOnDisk(side, 60_000);
    try {
      await waitSettled(attempt, GEOMETRY, 60_000);
    } catch {
      // best-effort
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '04-outcomes-settled', GEOMETRY);
    const finalLines = settleLines.length ? settleLines : await screenLines(attempt, GEOMETRY);
    observations.final = observeOutcomes(finalLines);
    observations.marker = await readOutcomeMarker(side);
    observations.gitAfter = await gitSnapshot('after');
    observations.maintainRan = Boolean(
      observations.final?.maintainInvoked || observations.marker?.outcomeOk,
    );
    observations.outcome = observations.marker?.outcome ?? observations.final?.outcomeMention ?? null;
    observations.pr = observations.marker?.pr ?? null;
    observations.blocker = observations.marker?.blocker ?? null;
    observations.outcomeDefOk = Boolean(observations.marker?.ok);
    observations.prNoneOk =
      observations.outcome === 'clean' || observations.outcome === 'blocked'
        ? !observations.pr || observations.pr.toLowerCase() === 'none'
        : null;
    observations.prPresentOk =
      observations.outcome === 'changed'
        ? Boolean(observations.pr) && observations.pr.toLowerCase() !== 'none'
        : null;
    observations.noPrOpenedOnScreen =
      observations.outcome === 'clean' || observations.outcome === 'blocked'
        ? !observations.final?.prOpenedOnScreen
        : null;

    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt-outcomes.txt'), `${prompt}\n`);
    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      fixtureDigest,
      prompt,
      observations,
    };
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
  }
}

await ensureFixtureBase();
const fixtureDigest = digestText(
  `${SCENARIO_REF}\n${await readFile(join(fixtureApp, 'hello.sh'), 'utf8')}\n${skillBodyFor('cursor')}`,
);
const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
const results = [];
for (const side of sides) {
  const result = await runSide(side, fixtureDigest);
  results.push(result);
  console.log(JSON.stringify(result));
}
console.log(
  JSON.stringify({
    scenario: SCENARIO_REF,
    fixtureDigest,
    results,
  }),
);
