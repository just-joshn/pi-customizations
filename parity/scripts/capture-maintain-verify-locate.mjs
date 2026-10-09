#!/usr/bin/env node
// Captures PSTACK-SETUP-MAINTAIN-VERIFY-LOCATE-001 (maintain Pass step 0 Locate).
// Seeds a fixture with zero / one / several verify-* skills, runs
// /maintain-verification-skill, and stops after locate. Real PTY both sides.
// Does NOT read or write ~/.cursor/rules/pstack-models.mdc (avoids racing setup captures).
//
// Usage:
//   node scripts/capture-maintain-verify-locate.mjs [--one|--none|--several] [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/maintain-verify/
import { access, chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const argvFlags = new Set(process.argv.slice(2));
const mode = argvFlags.has('--none') ? 'none' : argvFlags.has('--several') ? 'several' : 'one';
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
const SETTLE_MS = 900_000;
const SKILL_A = 'verify-hello-cli';
const SKILL_B = 'verify-hello-alt';
const SCENARIO_REF = 'setup-maintain-verify-locate';
const createVerifyPiSkill = join(
  root,
  'evidence',
  'create-verify',
  'fixture-app',
  '.pi',
  'skills',
  SKILL_A,
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function skillRel(side, name = SKILL_A) {
  return side === 'cursor'
    ? join('.cursor', 'skills', name, 'SKILL.md')
    : join('.pi', 'skills', name, 'SKILL.md');
}

function skillAbs(side, name = SKILL_A) {
  return join(fixtureApp, skillRel(side, name));
}

function skillDir(side, name = SKILL_A) {
  return join(fixtureApp, side === 'cursor' ? '.cursor' : '.pi', 'skills', name);
}

function writeRootFor(side) {
  return join(evidenceRoot, 'fixture-out', side);
}

function locatePath(side) {
  return join(writeRootFor(side), 'locate.txt');
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

function skillBodyFor(side, name) {
  const evidenceRootRel =
    side === 'cursor' ? `.cursor/evidence/${name}` : `.pi/evidence/${name}`;
  return `---
name: ${name}
description: Verify the hello-cli fixture via ./hello.sh (prints HELLO-FAMILY-13). Project-local verification skill with launch/drive and a feature map.
---

# ${name}

Tiny hello-cli fixture used for maintain-verify locate capture.

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

async function writeSkillTree(side, name) {
  const dir = skillDir(side, name);
  await mkdir(join(dir, 'features'), { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), skillBodyFor(side, name));
  await writeFile(join(dir, 'features', 'README.md'), featureReadme());
  await writeFile(join(dir, 'features', 'hello-print.md'), featureHello());
}

async function ensureFixtureBase() {
  await mkdir(fixtureApp, { recursive: true });
  const hello = join(fixtureApp, 'hello.sh');
  const readme = join(fixtureApp, 'README.md');
  await writeFile(hello, '#!/bin/sh\necho HELLO-FAMILY-13\n');
  await chmod(hello, 0o755);
  await writeFile(
    readme,
    '# hello-cli\n\nTiny CLI fixture for maintain-verify locate capture.\n\n## Run\n\n```bash\n./hello.sh\n```\n\nPrints `HELLO-FAMILY-13` and exits 0.\n',
  );
}

async function seedSkills(side) {
  await rm(join(fixtureApp, '.cursor', 'skills'), { recursive: true, force: true });
  await rm(join(fixtureApp, '.pi', 'skills'), { recursive: true, force: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(locatePath(side), { force: true });

  if (mode === 'none') return;

  // Prefer copying the create-verify live Pi skill when present (proven shape).
  if (side === 'pi' && mode === 'one' && (await pathExists(join(createVerifyPiSkill, 'SKILL.md')))) {
    await mkdir(join(fixtureApp, '.pi', 'skills'), { recursive: true });
    await cp(createVerifyPiSkill, skillDir('pi', SKILL_A), { recursive: true });
  } else {
    await writeSkillTree(side, SKILL_A);
  }

  if (mode === 'several') {
    await writeSkillTree(side, SKILL_B);
  }
}

function locatePrompt(side) {
  const out = locatePath(side);
  const hostRoot = side === 'cursor' ? '.cursor/skills' : '.pi/skills';
  if (mode === 'none') {
    return (
      `Run /maintain-verification-skill now. Complete only Pass step 0 Locate the target. ` +
      `This project has no verify-* skill under ${hostRoot}. ` +
      `Do not invent a verification skill target. Do not create a skill. ` +
      `Stop and point at /create-verification-skill. ` +
      `Write exactly these two lines to ${out} and stop:\n` +
      `LOCATED=none\nCREATE_OFFERED=yes\n` +
      `Do not run index hygiene, source wave, live pass, triage, or ship. ` +
      `Do not edit any other files. Do not edit ledgers or parity/.`
    );
  }
  if (mode === 'several') {
    return (
      `Run /maintain-verification-skill now. Complete only Pass step 0 Locate the target. ` +
      `This project has several verify-* candidates under ${hostRoot}. ` +
      `Ask which one to maintain. Do not pick one yourself. ` +
      `Write exactly one line to ${out}: LOCATED=ask ` +
      `Then stop without answering for the user. ` +
      `Do not run index hygiene, source wave, live pass, triage, or ship. ` +
      `Do not invent a new target. Do not edit ledgers or parity/.`
    );
  }
  const expected = skillAbs(side, SKILL_A);
  return (
    `Run /maintain-verification-skill now. Complete only Pass step 0 Locate the target. ` +
    `Find the project-local verification skill with launch/drive sections and a feature map ` +
    `(expected at ${expected}). ` +
    `When you have located it, write exactly one line to ${out}: LOCATED=${expected} ` +
    `Then stop. Do not run index hygiene, source wave, live pass, triage, or ship. ` +
    `Do not invent a different target. Do not edit the skill. Do not edit ledgers or parity/.`
  );
}

function observeLocate(lines, side) {
  const text = lines.join('\n');
  const locatedPathMention = text.includes(skillAbs(side, SKILL_A)) || /verify-hello-cli/i.test(text);
  const createOffer =
    /create-verification-skill/i.test(text) || /\/create-verification/i.test(text);
  const askWhich =
    /which (one|skill)|several candidates|more than one|pick (a|which)|which verify/i.test(text);
  // Affirmative invent language only. Negations ("didn't invent", "do not invent") stay false.
  const inventingAffirm =
    /\binvent(ing)? (a )?target\b|(?:creating|I'll create|I will create) (a )?new verify/i.test(text);
  const inventingNegated =
    /did(?:n't| not) (?:create or )?invent|do not invent|without inventing|instead of inventing/i.test(
      text,
    );
  const inventing = inventingAffirm && !inventingNegated;
  return {
    maintainInvoked:
      /maintain-verification-skill|\/maintain-verification/i.test(text) ||
      /\[skill\]\s*maintain-verification/i.test(text),
    locatedPathMention,
    createOffer,
    askWhich,
    inventing,
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

async function readLocateMarker(side) {
  const path = locatePath(side);
  if (!(await pathExists(path))) {
    return { exists: false, path, raw: null, located: null, createOffered: null, ok: false };
  }
  const raw = await readFile(path, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const locatedLine = lines.find((l) => /^LOCATED=/i.test(l));
  const createLine = lines.find((l) => /^CREATE_OFFERED=/i.test(l));
  const located = locatedLine ? locatedLine.slice('LOCATED='.length) : null;
  const createOffered = createLine ? createLine.slice('CREATE_OFFERED='.length).toLowerCase() : null;

  let ok = false;
  if (mode === 'one') {
    ok = located === skillAbs(side, SKILL_A) || located === skillRel(side, SKILL_A);
  } else if (mode === 'none') {
    ok = located === 'none' && createOffered === 'yes';
  } else if (mode === 'several') {
    ok = located === 'ask';
  }
  return { exists: true, path, raw, located, createOffered, ok };
}

async function skillLooksValid(side, name = SKILL_A) {
  const path = skillAbs(side, name);
  if (!(await pathExists(path))) return { exists: false, path, ok: false };
  const body = await readFile(path, 'utf8');
  const hasLaunch = /^##\s+Launch\s*$/mi.test(body);
  const hasDrive = /^##\s+Drive\s*$/mi.test(body);
  const featureMap =
    (await pathExists(join(skillDir(side, name), 'features', 'README.md'))) &&
    (await pathExists(join(skillDir(side, name), 'features', 'hello-print.md')));
  return {
    exists: true,
    path,
    hasLaunch,
    hasDrive,
    featureMap,
    ok: hasLaunch && hasDrive && featureMap,
  };
}

function spec({ side, cwd, argv, env, fixtureDigest }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: `${SCENARIO_REF}:${mode}`,
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

async function waitLocateSettled(attempt, side, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let calm = 0;
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observeLocate(last, side);
    const marker = await readLocateMarker(side);
    if (marker.ok && !obs.working) {
      calm += 1;
      if (calm >= 2) return last;
    } else {
      calm = 0;
    }
    await sleep(800);
  }
  return last;
}

async function waitLocateOnDisk(side, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const marker = await readLocateMarker(side);
    if (marker.ok) return marker;
    await sleep(800);
  }
  return readLocateMarker(side);
}

async function runSide(side, fixtureDigest) {
  const dir = join(evidenceRoot, side);
  await mkdir(dir, { recursive: true });
  await seedSkills(side);
  const prompt = locatePrompt(side);
  const seeded = mode === 'none' ? { ok: true, mode } : await skillLooksValid(side, SKILL_A);
  const observations = { mode, seeded };
  let attempt;
  try {
    if (side === 'pi') await ensurePiTrust();
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(fixtureDigest) : piSpec(fixtureDigest));
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitPiChatReady(attempt, 120_000);
    }
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);

    attempt.input(Buffer.from(prompt), 'literal_user');
    await sleep(600);
    await dumpScreen(attempt, dir, '01-locate-typed', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '02-locate-submitted', GEOMETRY);

    try {
      await waitEither(
        attempt,
        GEOMETRY,
        [
          'maintain-verification',
          'verify-hello-cli',
          'Locate',
          'create-verification',
          'LOCATED=',
          'feature map',
          'which',
        ],
        300_000,
      );
    } catch {
      // settle may still land the marker
    }
    await dumpScreen(attempt, dir, '03-locate-signal', GEOMETRY);
    observations.mid = observeLocate(await screenLines(attempt, GEOMETRY), side);
    observations.markerMid = await readLocateMarker(side);

    const settleLines = await waitLocateSettled(attempt, side, SETTLE_MS);
    await waitLocateOnDisk(side, 60_000);
    try {
      await waitSettled(attempt, GEOMETRY, 60_000);
    } catch {
      // best-effort
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '04-locate-settled', GEOMETRY);
    const finalLines = settleLines.length ? settleLines : await screenLines(attempt, GEOMETRY);
    observations.final = observeLocate(finalLines, side);
    observations.marker = await readLocateMarker(side);
    observations.skillAfter = mode === 'none' ? null : await skillLooksValid(side, SKILL_A);
    observations.locateOk = Boolean(observations.marker?.ok);
    observations.inventedTarget = Boolean(observations.final?.inventing);
    observations.createOfferOk =
      mode !== 'none' ? null : Boolean(observations.final?.createOffer || observations.marker?.createOffered === 'yes');
    observations.askWhichOk =
      mode !== 'several' ? null : Boolean(observations.final?.askWhich || observations.marker?.located === 'ask');

    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt-locate.txt'), `${prompt}\n`);
    return {
      side,
      mode,
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
  `${mode}\n${await readFile(join(fixtureApp, 'hello.sh'), 'utf8')}\n${skillBodyFor('cursor', SKILL_A)}`,
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
    mode,
    fixtureDigest,
    results,
  }),
);
