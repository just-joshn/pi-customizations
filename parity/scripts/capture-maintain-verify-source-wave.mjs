#!/usr/bin/env node
// Captures PSTACK-SETUP-MAINTAIN-VERIFY-SOURCE-WAVE-001.
// Dedicated fixture cwd (fixture-app-source-wave) so outcomes/live-pass workers
// do not race the shared fixture-app. Seeds two feature files so concurrent
// read-only children are required. Stops after source wave. Real PTY both sides.
// Does NOT edit ledgers. Does NOT touch ~/.cursor/rules/pstack-models.mdc.
//
// Usage:
//   node scripts/capture-maintain-verify-source-wave.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/maintain-verify/
import { access, chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
const fixtureApp = join(evidenceRoot, 'fixture-app-source-wave');
const GEOMETRY = { rows: 40, cols: 120 };
const SETTLE_MS = 1_800_000;
const SKILL_NAME = 'verify-hello-cli';
const SCENARIO_REF = 'setup-maintain-verify-source-wave';
const FEATURE_FILES = ['hello-print.md', 'exit-zero.md'];

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
  return join(evidenceRoot, 'fixture-out', 'source-wave', side);
}

function markerPath(side) {
  return join(writeRootFor(side), 'source-wave.txt');
}

function childrenDir(side) {
  return join(writeRootFor(side), 'children');
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

Tiny hello-cli fixture used for maintain-verify source-wave capture. Two feature files require a concurrent source wave.

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

Two features for the hello print and its exit code.

| Feature | File |
| --- | --- |
| hello print | hello-print.md |
| exit zero | exit-zero.md |
`;
}

function featureHello() {
  return `# hello print

User runs \`./hello.sh\` and sees \`HELLO-FAMILY-13\` on stdout.

## Capture

Capture stdout under the skill Evidence path.
`;
}

function featureExitZero() {
  return `# exit zero

User runs \`./hello.sh\` and the process exits with code 0.

## Capture

Capture exit-code.txt under the skill Evidence path.
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
    '# hello-cli\n\nTiny CLI fixture for maintain-verify source-wave capture.\n\n## Run\n\n```bash\n./hello.sh\n```\n\nPrints `HELLO-FAMILY-13` and exits 0.\n',
  );
}

async function seedSkills(side) {
  await rm(join(fixtureApp, '.cursor', 'skills'), { recursive: true, force: true });
  await rm(join(fixtureApp, '.pi', 'skills'), { recursive: true, force: true });
  await rm(join(fixtureApp, '.cursor', 'evidence'), { recursive: true, force: true });
  await rm(join(fixtureApp, '.pi', 'evidence'), { recursive: true, force: true });
  await rm(join(fixtureApp, 'artifacts'), { recursive: true, force: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(markerPath(side), { force: true });
  await rm(childrenDir(side), { recursive: true, force: true });
  await mkdir(childrenDir(side), { recursive: true });

  const dir = skillDir(side);
  await mkdir(join(dir, 'features'), { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), skillBodyFor(side));
  await writeFile(join(dir, 'features', 'README.md'), featureReadme());
  await writeFile(join(dir, 'features', 'hello-print.md'), featureHello());
  await writeFile(join(dir, 'features', 'exit-zero.md'), featureExitZero());
}

function sourceWavePrompt(side) {
  const out = markerPath(side);
  const kids = childrenDir(side);
  const skillPath = skillAbs(side);
  return (
    `Run /maintain-verification-skill now against the existing ${SKILL_NAME} skill at ${skillPath}. ` +
    `Complete Pass steps 0–2 only (Locate, Index hygiene, Source wave). Stop after Source wave. ` +
    `Do not run Live pass. Do not open a PR. Do not edit product code (hello.sh, README.md). ` +
    `Never edit parity/ ledgers or ~/.cursor/rules/pstack-models.mdc. ` +
    `The feature map has exactly two feature files (${FEATURE_FILES.join(' and ')}). ` +
    `After index hygiene, launch one read-only subagent per feature file concurrently (two children). ` +
    `Each child must return feature summary, source entry points, likely drift or none, and one live-verification recipe. ` +
    `Children must never drive the app and must never edit files. ` +
    `Write each child's return verbatim to ${kids}/hello-print.md and ${kids}/exit-zero.md. ` +
    `Then write exactly these lines to ${out} and stop:\n` +
    `SOURCE_WAVE=done\n` +
    `FEATURES=2\n` +
    `CONCURRENT_CHILDREN=yes\n` +
    `FIELDS=summary,entrypoints,drift,recipe\n` +
    `CHILDREN_DROVE=no\n` +
    `CHILDREN_EDITED=no\n`
  );
}

function observeSourceWave(lines) {
  const text = lines.join('\n');
  const taskHits = (text.match(/\b(?:Running subagent|Called Task|Using Task|cursor · Task|subagent)\b/gi) ?? [])
    .length;
  return {
    maintainInvoked:
      /maintain-verification-skill|\/maintain-verification/i.test(text) ||
      /\[skill\]\s*maintain-verification/i.test(text),
    sourceWaveMention: /source wave|Source wave/i.test(text),
    concurrentMention: /concurrent|in parallel|simultaneously|two (?:read-only )?subagents|both children/i.test(
      text,
    ),
    taskOrSubagentMention: taskHits > 0,
    taskHitCount: taskHits,
    skippedSubagent: /did not launch a subagent|skipped.*subagent|no subagent/i.test(text),
    droveMention: /live pass|doctor before|drove the app|\.\/hello\.sh/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

async function readChildOutputs(side) {
  const dir = childrenDir(side);
  const out = {};
  for (const name of FEATURE_FILES) {
    const path = join(dir, name);
    if (!(await pathExists(path))) {
      out[name] = { exists: false, path, raw: null, fields: null };
      continue;
    }
    const raw = await readFile(path, 'utf8');
    const lower = raw.toLowerCase();
    const fields = {
      summary: /summary|feature|user runs|hello|exit/i.test(raw),
      entrypoints: /entry\s*point|hello\.sh|source|#!\/bin\/sh/i.test(raw),
      drift: /drift|none|no drift|matches/i.test(lower),
      recipe: /recipe|live|doctor|drive|verify|stdout|exit-code/i.test(lower),
    };
    out[name] = {
      exists: true,
      path,
      raw,
      fields,
      fieldsOk: fields.summary && fields.entrypoints && fields.drift && fields.recipe,
    };
  }
  return out;
}

async function readMarker(side) {
  const path = markerPath(side);
  if (!(await pathExists(path))) {
    return {
      exists: false,
      path,
      raw: null,
      ok: false,
      values: {},
    };
  }
  const raw = await readFile(path, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const values = {};
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    values[line.slice(0, eq).toUpperCase()] = line.slice(eq + 1);
  }
  const ok =
    values.SOURCE_WAVE === 'done' &&
    values.FEATURES === '2' &&
    /^yes$/i.test(values.CONCURRENT_CHILDREN ?? '') &&
    /summary/i.test(values.FIELDS ?? '') &&
    /entrypoints/i.test(values.FIELDS ?? '') &&
    /drift/i.test(values.FIELDS ?? '') &&
    /recipe/i.test(values.FIELDS ?? '') &&
    /^no$/i.test(values.CHILDREN_DROVE ?? '') &&
    /^no$/i.test(values.CHILDREN_EDITED ?? '');
  return { exists: true, path, raw, values, ok };
}

async function listChildrenOnDisk(side) {
  const dir = childrenDir(side);
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
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
      (/fixture-app-source-wave|hello-cli|Skill conflicts|medium/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function waitSourceWaveSettled(attempt, side, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let calm = 0;
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observeSourceWave(last);
    const marker = await readMarker(side);
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
    const marker = await readMarker(side);
    if (marker.exists && marker.values.SOURCE_WAVE === 'done') return marker;
    await sleep(800);
  }
  return readMarker(side);
}

async function runSide(side, fixtureDigest) {
  const sideRoot = join(evidenceRoot, side);
  await mkdir(sideRoot, { recursive: true });
  await seedSkills(side);
  const prompt = sourceWavePrompt(side);
  const gitBefore = await gitSnapshot('before');
  const observations = { seeded: true, featureFiles: FEATURE_FILES, gitBefore };
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
    await dumpScreen(attempt, dir, '01-source-wave-typed', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '02-source-wave-submitted', GEOMETRY);

    try {
      await waitEither(
        attempt,
        GEOMETRY,
        [
          'maintain-verification',
          'verify-hello-cli',
          'SOURCE_WAVE=',
          'source wave',
          'Source wave',
          'Running subagent',
          'Task',
          'hello-print',
          'exit-zero',
        ],
        300_000,
      );
    } catch {
      // settle may still land the marker
    }
    await dumpScreen(attempt, dir, '03-source-wave-signal', GEOMETRY);
    observations.mid = observeSourceWave(await screenLines(attempt, GEOMETRY));
    observations.markerMid = await readMarker(side);

    const settleLines = await waitSourceWaveSettled(attempt, side, SETTLE_MS);
    await waitMarkerOnDisk(side, 60_000);
    try {
      await waitSettled(attempt, GEOMETRY, 60_000);
    } catch {
      // best-effort
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '04-source-wave-settled', GEOMETRY);
    const finalLines = settleLines.length ? settleLines : await screenLines(attempt, GEOMETRY);
    observations.final = observeSourceWave(finalLines);
    observations.marker = await readMarker(side);
    observations.children = await readChildOutputs(side);
    observations.childrenListed = await listChildrenOnDisk(side);
    observations.gitAfter = await gitSnapshot('after');
    observations.maintainRan = Boolean(
      observations.final?.maintainInvoked || observations.marker?.values?.SOURCE_WAVE === 'done',
    );
    observations.markerOk = Boolean(observations.marker?.ok);
    observations.bothChildrenOnDisk = FEATURE_FILES.every(
      (name) => observations.children?.[name]?.exists,
    );
    observations.bothChildrenFieldsOk = FEATURE_FILES.every(
      (name) => observations.children?.[name]?.fieldsOk,
    );
    observations.concurrentClaimed = /^yes$/i.test(
      observations.marker?.values?.CONCURRENT_CHILDREN ?? '',
    );
    observations.childrenDroveNo = /^no$/i.test(observations.marker?.values?.CHILDREN_DROVE ?? '');
    observations.childrenEditedNo = /^no$/i.test(
      observations.marker?.values?.CHILDREN_EDITED ?? '',
    );
    observations.sourceWavePassCandidate =
      observations.markerOk &&
      observations.bothChildrenOnDisk &&
      observations.bothChildrenFieldsOk &&
      !observations.final?.skippedSubagent;

    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt-source-wave.txt'), `${prompt}\n`);
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
  `${SCENARIO_REF}\n${FEATURE_FILES.join(',')}\n${await readFile(join(fixtureApp, 'hello.sh'), 'utf8')}\n${skillBodyFor('cursor')}`,
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
