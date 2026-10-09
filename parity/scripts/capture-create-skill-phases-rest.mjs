#!/usr/bin/env node
// create-skill remaining phases: Discovery, Design, Verification.
// Reuses Phase 3 fixture-app, locked rule digest, and PTY recorder patterns.
// Does not overwrite Phase 3 evidence under evidence/create-skill/{cursor,pi}/.
//
// Usage:
//   node scripts/capture-create-skill-phases-rest.mjs --phase discovery|design|verification|all [--cursor-only|--pi-only|--both]
import { access, cp, mkdir, readFile, rename, rm, writeFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { sha256 } from '../recorder/files.mjs';
import { outputBytes, startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const args = process.argv.slice(2);
const phaseArg = (() => {
  const i = args.indexOf('--phase');
  return i >= 0 ? args[i + 1] : 'all';
})();
const only = args.find((a) => a === '--cursor-only' || a === '--pi-only' || a === '--both') ?? '--both';
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'create-skill');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_200_000;
const SKILL_NAME = 'parity-create-skill-probe';
const MARKER = 'CREATE-SKILL-PROBE-MARKER';

const PHASES = {
  discovery: {
    id: 'discovery',
    pairId: 'create-skill-discovery-1',
    scenarioRef: 'create-skill:phase-1-discovery',
    phaseTarget: 'create-skill-discovery',
    doneStatus: 'discovered',
  },
  design: {
    id: 'design',
    pairId: 'create-skill-design-1',
    scenarioRef: 'create-skill:phase-2-design',
    phaseTarget: 'create-skill-design',
    doneStatus: 'designed',
  },
  verification: {
    id: 'verification',
    pairId: 'create-skill-verification-1',
    scenarioRef: 'create-skill:phase-4-verification',
    phaseTarget: 'create-skill-verification',
    doneStatus: 'verified',
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stripAnsi = (text) =>
  text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');

function phaseRoot(phaseId) {
  return join(evidenceRoot, phaseId);
}

function sideDir(phaseId, side) {
  return join(phaseRoot(phaseId), side);
}

function writeRootFor(phaseId, side) {
  return join(evidenceRoot, 'fixture-out', phaseId, side);
}

function donePath(phaseId, side) {
  return join(writeRootFor(phaseId, side), 'done.txt');
}

function artifactPath(phaseId, side) {
  if (phaseId === 'discovery') return join(writeRootFor(phaseId, side), 'requirements.md');
  if (phaseId === 'design') return join(writeRootFor(phaseId, side), 'design.md');
  return join(writeRootFor(phaseId, side), 'verify.md');
}

function skillRel(side) {
  return side === 'cursor'
    ? join('.cursor', 'skills', SKILL_NAME, 'SKILL.md')
    : join('.pi', 'skills', SKILL_NAME, 'SKILL.md');
}

function skillAbs(side) {
  return join(fixtureApp, skillRel(side));
}

function durableImplSkill(side) {
  return join(evidenceRoot, 'fixture-out', side, 'SKILL.md');
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readDone(phaseId, side) {
  const path = donePath(phaseId, side);
  if (!(await pathExists(path))) return { exists: false, path, line: null, status: null };
  const line = (await readFile(path, 'utf8')).trim();
  const m = line.match(/^STATUS=(discovered|designed|verified|env-blocked|other)\b/i);
  return { exists: true, path, line, status: m ? m[1].toLowerCase() : null };
}

async function readArtifact(phaseId, side) {
  const path = artifactPath(phaseId, side);
  if (!(await pathExists(path))) {
    return { exists: false, path, text: '', byteLength: 0, sha256: null, ok: false };
  }
  const text = await readFile(path, 'utf8');
  const digest = await sha256(path);
  let ok = false;
  if (phaseId === 'discovery') {
    ok =
      /purpose/i.test(text) &&
      /location|storage|project/i.test(text) &&
      /trigger/i.test(text) &&
      text.trim().length > 80;
  } else if (phaseId === 'design') {
    ok =
      new RegExp(SKILL_NAME, 'i').test(text) &&
      /description/i.test(text) &&
      /section/i.test(text) &&
      text.trim().length > 80;
  } else {
    ok =
      (text.includes(MARKER) || /discover|appl/i.test(text)) &&
      /under\s*500|line|trigger|terminolog/i.test(text) &&
      text.trim().length > 40;
  }
  return { exists: true, path, text, byteLength: Buffer.byteLength(text), sha256: digest, ok };
}

async function readSkillMeta(side) {
  const path = skillAbs(side);
  if (!(await pathExists(path))) {
    return {
      exists: false,
      path,
      nameOk: false,
      hasMarker: false,
      byteLength: 0,
      sha256: null,
      ok: false,
    };
  }
  const text = await readFile(path, 'utf8');
  const nameOk = new RegExp(`^name:\\s*${SKILL_NAME}\\s*$`, 'm').test(text);
  const hasMarker = text.includes(MARKER);
  const digest = await sha256(path);
  return {
    exists: true,
    path,
    nameOk,
    hasMarker,
    byteLength: Buffer.byteLength(text),
    sha256: digest,
    ok: nameOk && hasMarker,
    text,
  };
}

function observeCommon(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  return {
    createSkillMention:
      /\b\/create-skill\b/i.test(hay) ||
      /\bcreate-skill\b/i.test(hay) ||
      /\[skill\]\s*create-skill\b/i.test(hay),
    skillPathMention: new RegExp(SKILL_NAME, 'i').test(hay),
    markerMention: hay.includes(MARKER),
    askMention:
      /\bAskQuestion\b/i.test(hay) ||
      /\bwhere should\b/i.test(hay) ||
      /\bpurpose\b/i.test(hay) ||
      /\btrigger\b/i.test(hay) ||
      /\?/g.test(hay),
    envBlocked:
      /\benv[- ]blocked\b/i.test(hay) ||
      /\bcannot (run|exercise|invoke).{0,40}create-skill\b/i.test(hay),
    working: /[\u2800-\u28FF]/.test(hay) || /\bWorking\b/.test(hay),
  };
}

const DISCOVERY_ANSWERS =
  `Answers for Phase 1 only. ` +
  `1) Purpose: teach the agent to echo ${MARKER} when the user says "run the create-skill probe". ` +
  `2) Location: project skill (${SKILL_NAME}). ` +
  `3) Triggers: "run the create-skill probe", "parity-create-skill-probe", "create-skill probe". ` +
  `4) Constraints: under 80 lines, no scripts, body must include exact marker ${MARKER} on its own line. ` +
  `5) Patterns: follow create-skill SKILL.md structure. ` +
  `Write the gathered requirements to the requirements.md path from the first message. ` +
  `Write STATUS=discovered to the done path. Do not write SKILL.md. Do not start Design or Implementation. Stop.`;

function discoveryPrompt(side) {
  const outDone = donePath('discovery', side);
  const reqPath = artifactPath('discovery', side);
  return (
    `/create-skill. Complete ONLY Phase 1 Discovery from the create-skill skill. ` +
    `Sparse request: I want a small project skill for a create-skill probe in this repo. ` +
    `Ask your discovery questions now (AskQuestion if available, otherwise conversational). ` +
    `Do not draft a name/description outline yet. Do not write SKILL.md. ` +
    `After you have answers, write ${reqPath} covering Purpose, Location, Triggers, Constraints, Patterns. ` +
    `Then write exactly one line to ${outDone} as STATUS=discovered|env-blocked|other reason=<short>. ` +
    `Do not edit parity ledgers, parity/mismatches.json, parity/requirements.json, or parity/progress.md.`
  );
}

function designPrompt(side) {
  const outDone = donePath('design', side);
  const designPath = artifactPath('design', side);
  return (
    `/create-skill. Complete ONLY Phase 2 Design from the create-skill skill. ` +
    `Requirements already gathered (do not rediscover): ` +
    `Purpose=echo ${MARKER} when user says "run the create-skill probe"; ` +
    `Location=project skill path ${skillRel(side)}; name=${SKILL_NAME}; ` +
    `Triggers include "create-skill probe" and "parity-create-skill-probe"; ` +
    `Constraints=under 80 lines, no supporting files/scripts, marker on its own line; ` +
    `Patterns=create-skill frontmatter + concise body. ` +
    `Write ${designPath} with: skill name, third-person description with trigger terms, ` +
    `main section outline, and whether supporting files/scripts are needed (must be no). ` +
    `Do not write SKILL.md. Do not implement. ` +
    `When design.md is on disk, write exactly one line to ${outDone} as STATUS=designed|env-blocked|other reason=<short>. ` +
    `Do not edit parity ledgers, parity/mismatches.json, parity/requirements.json, or parity/progress.md.`
  );
}

function verificationPrompt(side) {
  const outDone = donePath('verification', side);
  const verifyPath = artifactPath('verification', side);
  const skillPath = skillRel(side);
  return (
    `/create-skill Phase 4 Verification only for the existing skill at ${skillPath}. ` +
    `Do not rewrite the skill unless a check fails critically. ` +
    `1) Verify SKILL.md is under 500 lines, description has trigger terms, terminology is consistent, ` +
    `file refs are one level deep. Write those check results to ${verifyPath}. ` +
    `2) Then wait. On the next user message that says exactly: run the create-skill probe ` +
    `discover and apply the skill, and reply with ${MARKER} on its own line. ` +
    `3) Append a line APPLIED=${MARKER} to ${verifyPath} and write exactly one line to ${outDone} as ` +
    `STATUS=verified|env-blocked|other reason=<short>. ` +
    `Do not edit parity ledgers, parity/mismatches.json, parity/requirements.json, or parity/progress.md.`
  );
}

function promptFor(phaseId, side) {
  if (phaseId === 'discovery') return discoveryPrompt(side);
  if (phaseId === 'design') return designPrompt(side);
  return verificationPrompt(side);
}

async function cleanPhaseOutputs(phaseId, side) {
  await mkdir(writeRootFor(phaseId, side), { recursive: true });
  await rm(donePath(phaseId, side), { force: true });
  await rm(artifactPath(phaseId, side), { force: true });
  await mkdir(sideDir(phaseId, side), { recursive: true });
}

async function seedSkillForVerification(side) {
  const src = durableImplSkill(side);
  if (!(await pathExists(src))) {
    throw new Error(`Missing Phase 3 durable skill for ${side}: ${src}`);
  }
  const dest = skillAbs(side);
  await mkdir(join(dest, '..'), { recursive: true });
  await cp(src, dest);
}

async function wipeLiveSkill(side) {
  await rm(join(fixtureApp, '.cursor', 'skills', SKILL_NAME), { recursive: true, force: true });
  await rm(join(fixtureApp, '.pi', 'skills', SKILL_NAME), { recursive: true, force: true });
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath, scenarioRef, phaseId }) {
  return {
    root: sideDir(phaseId, side),
    side,
    scenarioRef,
    fixtureRef: { path: fixturePath, digest: fixtureDigest },
    artifactPaths: [],
    launch: { argv, cwd, env },
    geometry: GEOMETRY,
  };
}

const cursorSpec = (phase, fixtureDigest) =>
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
    fixturePath: referenceRulePath,
    scenarioRef: phase.scenarioRef,
    phaseId: phase.id,
  });

const piSpec = (phase, fixtureDigest) =>
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
    fixturePath: piRulePath,
    scenarioRef: phase.scenarioRef,
    phaseId: phase.id,
  });

async function restoreRule(bytes) {
  const backupPath = `${referenceRulePath}.create-skill-phases-rest-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

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
      (/fixture-app|create-skill|Skill conflicts|medium/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

function isAskQuestionUi(text) {
  return /Space select/i.test(text) || /Question \d+ of \d+/i.test(text) || /↑\/↓ option/i.test(text);
}

async function driveAskQuestionUi(attempt, dir, tag) {
  // Pi create-skill discovery uses a checkbox TUI. Space selects, Enter advances.
  for (let i = 0; i < 10; i++) {
    const lines = await screenLines(attempt, GEOMETRY);
    const text = lines.join('\n');
    if (!isAskQuestionUi(text)) return i;
    attempt.input(Buffer.from(' '), 'literal_user');
    await sleep(250);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(700);
    await dumpScreen(attempt, dir, `${tag}-${i}`, GEOMETRY);
  }
  return 10;
}

async function waitPhaseSettled(attempt, phaseId, side, timeoutMs, prompt, expectedStatus) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let calm = 0;
  let discoveryAnswersSent = false;
  let verifyTriggerSent = false;
  let askUiDrives = 0;
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const screenText = last.join('\n');
    const obs = observeCommon(screenText, { ignorePromptSlice: prompt });
    const art = await readArtifact(phaseId, side);
    const done = await readDone(phaseId, side);
    const skill = await readSkillMeta(side);

    if (phaseId === 'discovery' && !art.ok && !done.exists && isAskQuestionUi(screenText)) {
      askUiDrives += await driveAskQuestionUi(attempt, sideDir(phaseId, side), 'ask');
      continue;
    }

    if (phaseId === 'discovery' && !discoveryAnswersSent && !art.ok && !done.exists) {
      // Only send prose answers when not inside the AskQuestion TUI.
      if (!obs.working && !isAskQuestionUi(screenText) && (obs.askMention || askUiDrives > 0 || Date.now() > deadline - timeoutMs + 120_000)) {
        const followUp =
          askUiDrives > 0
            ? `Using the answers just selected, write ${artifactPath('discovery', side)} now covering Purpose, Location, Triggers, Constraints, Patterns. Then write STATUS=discovered to ${donePath('discovery', side)}. Do not write SKILL.md. Stop.`
            : DISCOVERY_ANSWERS;
        attempt.input(Buffer.from(followUp), 'literal_user');
        await sleep(500);
        attempt.input(Buffer.from('\r'), 'literal_user');
        discoveryAnswersSent = true;
        await dumpScreen(attempt, sideDir(phaseId, side), '02b-answers', GEOMETRY);
      }
    }

    if (phaseId === 'verification' && !verifyTriggerSent) {
      const checksStarted = art.exists || /under\s*500|trigger|STATUS=/i.test(last.join('\n'));
      if (checksStarted && !obs.working) {
        attempt.input(Buffer.from('run the create-skill probe'), 'literal_user');
        await sleep(500);
        attempt.input(Buffer.from('\r'), 'literal_user');
        verifyTriggerSent = true;
        await dumpScreen(attempt, sideDir(phaseId, side), '02b-trigger', GEOMETRY);
      }
    }

    let enough = false;
    if (phaseId === 'discovery') {
      enough = (art.ok && done.status === expectedStatus) || done.status === 'env-blocked';
      if (skill.exists && skill.ok && !art.ok) enough = false;
    } else if (phaseId === 'design') {
      enough = (art.ok && done.status === expectedStatus) || done.status === 'env-blocked';
      if (skill.exists && skill.ok && !art.ok) enough = false;
    } else {
      const applied =
        art.text.includes(`APPLIED=${MARKER}`) ||
        obs.markerMention ||
        (await readDone(phaseId, side)).line?.includes(MARKER);
      enough =
        (art.ok && done.status === expectedStatus && (applied || art.text.includes(MARKER))) ||
        done.status === 'env-blocked';
    }

    if (enough && !obs.working) {
      calm += 1;
      if (calm >= 3) return { last, discoveryAnswersSent, verifyTriggerSent };
    } else {
      calm = 0;
    }
    await sleep(800);
  }
  return { last, discoveryAnswersSent, verifyTriggerSent, askUiDrives };
}

function scorePhase(phaseId, { art, done, screenObs, ptyObs, skill }) {
  const createPath =
    Boolean(screenObs?.createSkillMention) || Boolean(ptyObs?.createSkillMention);
  const envBlocked = done?.status === 'env-blocked' || Boolean(screenObs?.envBlocked);
  if (phaseId === 'discovery') {
    const closed = Boolean(art?.ok) && done?.status === 'discovered' && createPath && !skill?.ok;
    return {
      artifactOk: Boolean(art?.ok),
      createPath,
      envBlocked,
      doneStatus: done?.status ?? null,
      wroteSkill: Boolean(skill?.ok),
      phaseClosed: closed,
      honestBlocker: !closed && envBlocked,
    };
  }
  if (phaseId === 'design') {
    const closed = Boolean(art?.ok) && done?.status === 'designed' && createPath;
    return {
      artifactOk: Boolean(art?.ok),
      createPath,
      envBlocked,
      doneStatus: done?.status ?? null,
      wroteSkill: Boolean(skill?.ok),
      phaseClosed: closed,
      honestBlocker: !closed && envBlocked,
    };
  }
  const applied =
    Boolean(screenObs?.markerMention) ||
    Boolean(ptyObs?.markerMention) ||
    Boolean(art?.text?.includes(MARKER));
  const closed = Boolean(art?.ok) && done?.status === 'verified' && createPath && applied;
  return {
    artifactOk: Boolean(art?.ok),
    createPath,
    envBlocked,
    doneStatus: done?.status ?? null,
    applied,
    phaseClosed: closed,
    honestBlocker: !closed && envBlocked,
  };
}

async function runSide(phase, side, ruleBytes, ruleDigest) {
  const dir = sideDir(phase.id, side);
  const backupPath = `${referenceRulePath}.create-skill-phases-rest-backup`;
  await mkdir(dir, { recursive: true });
  await cleanPhaseOutputs(phase.id, side);
  if (phase.id === 'discovery' || phase.id === 'design') {
    await wipeLiveSkill(side);
  } else {
    await wipeLiveSkill(side);
    await seedSkillForVerification(side);
  }
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = promptFor(phase.id, side);
  const observations = {};
  let attempt;
  try {
    await writeFile(rulePath, ruleBytes);
    if (side === 'pi') await ensurePiTrust();
    attempt = await startAttempt(
      side === 'cursor' ? cursorSpec(phase, ruleDigest) : piSpec(phase, ruleDigest),
    );
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitPiChatReady(attempt, 120_000);
    }
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);

    attempt.input(Buffer.from(prompt), 'literal_user');
    await sleep(600);
    await dumpScreen(attempt, dir, '01-typed', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '02-submitted', GEOMETRY);

    try {
      await waitEither(
        attempt,
        GEOMETRY,
        ['create-skill', SKILL_NAME, 'STATUS=', 'Purpose', 'description', MARKER, 'env-blocked', '?'],
        300_000,
      );
    } catch {
      // settle may still land the artifact
    }
    await dumpScreen(attempt, dir, '03-signal', GEOMETRY);

    const settled = await waitPhaseSettled(
      attempt,
      phase.id,
      side,
      SETTLE_MS,
      prompt,
      phase.doneStatus,
    );
    try {
      await waitSettled(attempt, GEOMETRY, 60_000);
    } catch {
      // best-effort
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '04-settled', GEOMETRY);

    const finalLines = settled.last.length ? settled.last : await screenLines(attempt, GEOMETRY);
    const ptyText = Buffer.from(outputBytes(attempt.events())).toString('utf8');
    observations.screenFinal = observeCommon(finalLines.join('\n'), { ignorePromptSlice: prompt });
    observations.pty = observeCommon(ptyText, { ignorePromptSlice: prompt });
    observations.artifact = await readArtifact(phase.id, side);
    observations.done = await readDone(phase.id, side);
    observations.skill = await readSkillMeta(side);
    observations.discoveryAnswersSent = settled.discoveryAnswersSent;
    observations.verifyTriggerSent = settled.verifyTriggerSent;
    observations.askUiDrives = settled.askUiDrives ?? 0;
    observations.score = scorePhase(phase.id, {
      art: observations.artifact,
      done: observations.done,
      screenObs: observations.screenFinal,
      ptyObs: observations.pty,
      skill: observations.skill,
    });

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
    return {
      side,
      phaseId: phase.id,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      ruleUnchanged: after === ruleBytes,
      afterDigest,
      fixtureDigest: ruleDigest,
      prompt,
      observations,
      identity: JSON.parse(await readFile(join(attempt.dir, 'identity.json'), 'utf8')),
    };
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
    await restoreRule(ruleBytes);
  }
}

async function loadSideFromDisk(phaseId, side) {
  const obsPath = join(sideDir(phaseId, side), 'observations.json');
  if (!(await pathExists(obsPath))) return null;
  const observations = JSON.parse(await readFile(obsPath, 'utf8'));
  const sideRoot = sideDir(phaseId, side);
  const entries = await readdir(sideRoot, { withFileTypes: true });
  let attemptId = null;
  let attemptDir = null;
  let identity = null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const identPath = join(sideRoot, entry.name, 'identity.json');
    if (!(await pathExists(identPath))) continue;
    attemptId = entry.name;
    attemptDir = join(sideRoot, entry.name);
    identity = JSON.parse(await readFile(identPath, 'utf8'));
  }
  if (!attemptId) return null;
  return {
    side,
    phaseId,
    attemptId,
    attemptDir,
    ruleUnchanged: true,
    afterDigest: identity?.fixtureRef?.digest ?? null,
    observations,
    identity,
  };
}

async function writePair(phase, results, preDigest) {
  const bySide = Object.fromEntries(results.map((r) => [r.side, r]));
  if (!bySide.cursor) bySide.cursor = await loadSideFromDisk(phase.id, 'cursor');
  if (!bySide.pi) bySide.pi = await loadSideFromDisk(phase.id, 'pi');
  if (!bySide.cursor || !bySide.pi) return null;
  const cursor = bySide.cursor;
  const pi = bySide.pi;
  const closed =
    cursor.observations?.score?.phaseClosed && pi.observations?.score?.phaseClosed
      ? 'closed_by_this_pair'
      : 'open';
  const pair = {
    schema: 1,
    pairId: phase.pairId,
    scenarioRef: phase.scenarioRef,
    journeyFamily: 'cursor-create-skill',
    phaseTarget: phase.phaseTarget,
    fixtureDigest: preDigest,
    capturedAt: new Date().toISOString(),
    steps:
      phase.id === 'discovery'
        ? [
            { wait: 'ready screen' },
            { send: '/create-skill Phase 1 Discovery only (sparse request)' },
            { send: '\r' },
            { send: 'packed discovery answers' },
            { wait: 'requirements.md + STATUS=discovered' },
            { cancel: true },
          ]
        : phase.id === 'design'
          ? [
              { wait: 'ready screen' },
              { send: '/create-skill Phase 2 Design only with locked requirements' },
              { send: '\r' },
              { wait: 'design.md + STATUS=designed' },
              { cancel: true },
            ]
          : [
              { wait: 'ready screen with seeded Phase 3 SKILL.md' },
              { send: '/create-skill Phase 4 Verification checks' },
              { send: '\r' },
              { send: 'run the create-skill probe' },
              { wait: 'verify.md + marker applied + STATUS=verified' },
              { cancel: true },
            ],
    cursor: {
      attemptId: cursor.attemptId,
      dir: cursor.attemptDir,
      ruleUnchanged: cursor.ruleUnchanged,
      afterDigest: cursor.afterDigest,
      executable: cursor.identity?.executable ?? null,
      observedEnv: cursor.identity?.observedEnv ?? null,
      artifactPath: cursor.observations?.artifact?.path ?? null,
      artifactSha256: cursor.observations?.artifact?.sha256 ?? null,
      observations: cursor.observations?.score ?? null,
    },
    pi: {
      attemptId: pi.attemptId,
      dir: pi.attemptDir,
      ruleUnchanged: pi.ruleUnchanged,
      afterDigest: pi.afterDigest,
      executable: pi.identity?.executable ?? null,
      observedEnv: pi.identity?.observedEnv ?? null,
      artifactPath: pi.observations?.artifact?.path ?? null,
      artifactSha256: pi.observations?.artifact?.sha256 ?? null,
      observations: pi.observations?.score ?? null,
    },
    phaseClosure: {
      'create-skill-discovery': phase.id === 'discovery' ? closed : 'see_other_pair',
      'create-skill-design': phase.id === 'design' ? closed : 'see_other_pair',
      'create-skill-implementation': 'prior_pair_create-skill-impl-1',
      'create-skill-verification': phase.id === 'verification' ? closed : 'see_other_pair',
    },
    note:
      'Phase evidence lives under evidence/create-skill/<phase>/{cursor,pi}/. Phase 3 Implementation pair create-skill-impl-1 is unchanged.',
    verdict:
      cursor.observations?.score?.phaseClosed && pi.observations?.score?.phaseClosed
        ? 'pass'
        : 'open_or_blocked',
    requirementIds: [],
  };
  const pairPath = join(evidenceRoot, `pair-${phase.pairId}.json`);
  await writeFile(pairPath, `${JSON.stringify(pair, null, 2)}\n`, { flag: 'w' });
  return pairPath;
}

async function capturePhase(phase, onlyFlag, preRule, preDigest) {
  const sides = onlyFlag === '--cursor-only' ? ['cursor'] : onlyFlag === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
  const results = [];
  for (const side of sides) {
    const result = await runSide(phase, side, preRule, preDigest);
    results.push(result);
    console.log(JSON.stringify({ phase: phase.id, side: result.side, attemptId: result.attemptId, score: result.observations.score }));
  }
  const pairPath = await writePair(phase, results, preDigest);
  return { phase: phase.id, pairPath, results };
}

if (isMain) {
  const preRule = await readFile(referenceRulePath, 'utf8');
  const preDigest = await sha256(referenceRulePath);
  if (preDigest !== LOCKED_FIXTURE_DIGEST) {
    console.error(
      `Reference rule digest ${preDigest} does not match the locked fixture ${LOCKED_FIXTURE_DIGEST}`,
    );
    process.exit(1);
  }
  const phaseIds =
    phaseArg === 'all' ? ['discovery', 'design', 'verification'] : [phaseArg];
  for (const id of phaseIds) {
    if (!PHASES[id]) {
      console.error(`Unknown phase ${id}`);
      process.exit(1);
    }
  }
  const summaries = [];
  for (const id of phaseIds) {
    summaries.push(await capturePhase(PHASES[id], only, preRule, preDigest));
  }
  const outPath = join(evidenceRoot, 'capture-results-phases-rest.json');
  await writeFile(outPath, `${JSON.stringify({ fixtureDigest: preDigest, summaries }, null, 2)}\n`);
  console.log(JSON.stringify({ fixtureDigest: preDigest, summaries: summaries.map((s) => ({
    phase: s.phase,
    pairPath: s.pairPath,
    results: s.results.map((r) => ({
      side: r.side,
      attemptId: r.attemptId,
      score: r.observations.score,
      artifactSha256: r.observations.artifact?.sha256 ?? null,
    })),
  })) }, null, 2));
}
