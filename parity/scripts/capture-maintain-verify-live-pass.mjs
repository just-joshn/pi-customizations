#!/usr/bin/env node
// Captures PSTACK-SETUP-MAINTAIN-VERIFY-LIVE-PASS-001.
// Dedicated fixture-app-live-pass so outcomes/source-wave workers do not race.
// Seeds an aligned verify-hello-cli (source looks clean), runs full maintain,
// and records LIVE_PASS_* markers. Real PTY both sides.
// Does NOT edit ledgers. Does NOT touch ~/.cursor/rules/pstack-models.mdc.
//
// Usage:
//   node scripts/capture-maintain-verify-live-pass.mjs [--cursor-only|--pi-only|--both]
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
const fixtureApp = join(evidenceRoot, 'fixture-app-live-pass');
const GEOMETRY = { rows: 40, cols: 120 };
const SETTLE_MS = 2_400_000;
const SKILL_NAME = 'verify-hello-cli';
const SCENARIO_REF = 'setup-maintain-verify-live-pass';

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

function evidenceDir(side) {
  return join(fixtureApp, side === 'cursor' ? '.cursor' : '.pi', 'evidence', SKILL_NAME);
}

function writeRootFor(side) {
  return join(evidenceRoot, 'fixture-out', 'live-pass', side);
}

function markerPath(side) {
  return join(writeRootFor(side), 'live-pass-marker.txt');
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

Tiny hello-cli fixture used for maintain-verify live-pass capture.

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
    '# hello-cli\n\nTiny CLI fixture for maintain-verify live-pass capture.\n\n## Run\n\n```bash\n./hello.sh\n```\n\nPrints `HELLO-FAMILY-13` and exits 0.\n',
  );
}

async function seedSkills(side) {
  const hostSkills = side === 'cursor' ? '.cursor' : '.pi';
  await rm(join(fixtureApp, hostSkills, 'skills'), { recursive: true, force: true });
  await rm(join(fixtureApp, hostSkills, 'evidence'), { recursive: true, force: true });
  await rm(join(fixtureApp, 'artifacts'), { recursive: true, force: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(markerPath(side), { force: true });

  const dir = skillDir(side);
  await mkdir(join(dir, 'features'), { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), skillBodyFor(side));
  await writeFile(join(dir, 'features', 'README.md'), featureReadme());
  await writeFile(join(dir, 'features', 'hello-print.md'), featureHello());
}

function livePassPrompt(side) {
  const out = markerPath(side);
  const skillPath = skillAbs(side);
  const evidencePath = evidenceDir(side);
  return (
    `Run /maintain-verification-skill now against the existing ${SKILL_NAME} skill at ${skillPath}. ` +
    `The seeded skill already matches ./hello.sh (source looks clean). Still run a full maintain pass including Pass step 4 Live pass. ` +
    `Only edit that skill directory. Never edit product code (hello.sh, README.md). ` +
    `Never edit parity/ ledgers or ~/.cursor/rules/pstack-models.mdc. ` +
    `Live-pass rules you must follow and report: run live even when source is clean; coordinator owns all driving (do not hand live driving to source-wave children); exercise every feature at least once; doctor before first drive and before each fresh CLI session; keep evidence at its named location through cleanup; clean leftover residue from drives; if doctor fails from skill drift, fix under edit scope and retry once before blocked; verified-unreachable only with concrete prerequisite plus attempted route; re-drive harness fixes live before ship; final teardown after the last drive while leaving named evidence files. ` +
    `Prefer OUTCOME=clean when live coverage passes with no skill edits. ` +
    `After the live pass finishes, write exactly these lines to ${out} and stop:\n` +
    `LIVE_PASS_RAN=<yes|no>\n` +
    `SOURCE_LOOKED_CLEAN=<yes|no>\n` +
    `COORDINATOR_OWNED_DRIVING=<yes|no>\n` +
    `FEATURES_EXERCISED=<integer>\n` +
    `DOCTOR_BEFORE_DRIVE=<yes|no>\n` +
    `EVIDENCE_SURVIVES_CLEANUP=<yes|no>\n` +
    `NO_LEFTOVER_RESIDUE=<yes|no>\n` +
    `DOCTOR_DRIFT_RETRY=<na|yes|no>\n` +
    `VERIFIED_UNREACHABLE=<na|yes|no>\n` +
    `HARNESS_REDRIVE=<na|yes|no>\n` +
    `FINAL_TEARDOWN=<yes|no>\n` +
    `EVIDENCE_REMAINS=<yes|no>\n` +
    `EVIDENCE_PATH=${evidencePath}\n` +
    `OUTCOME=<clean|changed|blocked>\n` +
    `BLOCKER=<none|short reason>\n`
  );
}

function observeLive(lines) {
  const text = lines.join('\n');
  return {
    maintainInvoked:
      /maintain-verification-skill|\/maintain-verification/i.test(text) ||
      /\[skill\]\s*maintain-verification/i.test(text),
    livePassMentioned: /\blive pass\b|\blive-pass\b|doctor.before|doctor before|HELLO-FAMILY-13/i.test(
      text,
    ),
    doctorMentioned: /\bdoctor\b/i.test(text),
    driveMentioned: /\bdrive\b|\.\/hello\.sh|HELLO-FAMILY-13/i.test(text),
    cleanupMentioned: /\bcleanup\b|\bteardown\b/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

const MARKER_KEYS = [
  'LIVE_PASS_RAN',
  'SOURCE_LOOKED_CLEAN',
  'COORDINATOR_OWNED_DRIVING',
  'FEATURES_EXERCISED',
  'DOCTOR_BEFORE_DRIVE',
  'EVIDENCE_SURVIVES_CLEANUP',
  'NO_LEFTOVER_RESIDUE',
  'DOCTOR_DRIFT_RETRY',
  'VERIFIED_UNREACHABLE',
  'HARNESS_REDRIVE',
  'FINAL_TEARDOWN',
  'EVIDENCE_REMAINS',
  'EVIDENCE_PATH',
  'OUTCOME',
  'BLOCKER',
];

async function readLiveMarker(side) {
  const path = markerPath(side);
  if (!(await pathExists(path))) {
    return { exists: false, path, raw: null, fields: {}, ok: false };
  }
  const raw = await readFile(path, 'utf8');
  const fields = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (MARKER_KEYS.includes(key)) fields[key] = value;
  }
  const yn = (k) => fields[k] === 'yes' || fields[k] === 'no';
  const ynNa = (k) => fields[k] === 'yes' || fields[k] === 'no' || fields[k] === 'na';
  const features = Number.parseInt(fields.FEATURES_EXERCISED ?? '', 10);
  const outcomeOk =
    fields.OUTCOME === 'clean' || fields.OUTCOME === 'changed' || fields.OUTCOME === 'blocked';
  const coreOk =
    yn('LIVE_PASS_RAN') &&
    yn('SOURCE_LOOKED_CLEAN') &&
    yn('COORDINATOR_OWNED_DRIVING') &&
    Number.isFinite(features) &&
    features >= 1 &&
    yn('DOCTOR_BEFORE_DRIVE') &&
    yn('EVIDENCE_SURVIVES_CLEANUP') &&
    yn('NO_LEFTOVER_RESIDUE') &&
    ynNa('DOCTOR_DRIFT_RETRY') &&
    ynNa('VERIFIED_UNREACHABLE') &&
    ynNa('HARNESS_REDRIVE') &&
    yn('FINAL_TEARDOWN') &&
    yn('EVIDENCE_REMAINS') &&
    outcomeOk;
  const liveClaimOk =
    fields.LIVE_PASS_RAN === 'yes' &&
    fields.SOURCE_LOOKED_CLEAN === 'yes' &&
    fields.COORDINATOR_OWNED_DRIVING === 'yes' &&
    fields.DOCTOR_BEFORE_DRIVE === 'yes' &&
    fields.EVIDENCE_SURVIVES_CLEANUP === 'yes' &&
    fields.NO_LEFTOVER_RESIDUE === 'yes' &&
    fields.FINAL_TEARDOWN === 'yes' &&
    fields.EVIDENCE_REMAINS === 'yes';
  return {
    exists: true,
    path,
    raw,
    fields,
    features,
    ok: coreOk,
    liveClaimOk,
  };
}

async function inspectEvidenceOnDisk(side) {
  const dir = evidenceDir(side);
  const stdoutPath = join(dir, 'stdout.txt');
  const exitPath = join(dir, 'exit-code.txt');
  const stderrPath = join(dir, 'stderr.txt');
  const present = {
    dir: await pathExists(dir),
    stdout: await pathExists(stdoutPath),
    exitCode: await pathExists(exitPath),
    stderr: await pathExists(stderrPath),
  };
  let stdout = null;
  let exitCode = null;
  if (present.stdout) stdout = await readFile(stdoutPath, 'utf8');
  if (present.exitCode) exitCode = (await readFile(exitPath, 'utf8')).trim();
  return {
    dir,
    present,
    stdout,
    exitCode,
    helloOk: stdout === 'HELLO-FAMILY-13\n' && exitCode === '0',
  };
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
      (/fixture-app-live-pass|hello-cli|Skill conflicts|medium/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function waitLiveSettled(attempt, side, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let calm = 0;
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observeLive(last);
    const marker = await readLiveMarker(side);
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

async function waitMarkerOnDisk(side, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const marker = await readLiveMarker(side);
    if (marker.ok) return marker;
    await sleep(800);
  }
  return readLiveMarker(side);
}

async function runSide(side, fixtureDigest) {
  const sideRoot = join(evidenceRoot, side);
  await mkdir(sideRoot, { recursive: true });
  await seedSkills(side);
  const prompt = livePassPrompt(side);
  const observations = { seeded: true, fixtureApp };
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
    await dumpScreen(attempt, dir, '01-live-typed', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '02-live-submitted', GEOMETRY);

    try {
      await waitEither(
        attempt,
        GEOMETRY,
        [
          'maintain-verification',
          'verify-hello-cli',
          'LIVE_PASS_RAN=',
          'live pass',
          'doctor',
          'HELLO-FAMILY-13',
          'source wave',
          'clean',
        ],
        300_000,
      );
    } catch {
      // settle may still land the marker
    }
    await dumpScreen(attempt, dir, '03-live-signal', GEOMETRY);
    observations.mid = observeLive(await screenLines(attempt, GEOMETRY));
    observations.markerMid = await readLiveMarker(side);

    const settleLines = await waitLiveSettled(attempt, side, SETTLE_MS);
    await waitMarkerOnDisk(side, 60_000);
    try {
      await waitSettled(attempt, GEOMETRY, 60_000);
    } catch {
      // best-effort
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '04-live-settled', GEOMETRY);
    const finalLines = settleLines.length ? settleLines : await screenLines(attempt, GEOMETRY);
    observations.final = observeLive(finalLines);
    observations.marker = await readLiveMarker(side);
    observations.evidenceOnDisk = await inspectEvidenceOnDisk(side);
    observations.maintainRan = Boolean(
      observations.final?.maintainInvoked || observations.marker?.ok,
    );
    observations.livePassClaimOk = Boolean(
      observations.marker?.liveClaimOk && observations.evidenceOnDisk?.helloOk,
    );

    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt-live-pass.txt'), `${prompt}\n`);
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
    fixtureApp,
    fixtureDigest,
    results,
  }),
);
