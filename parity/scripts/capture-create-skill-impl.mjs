#!/usr/bin/env node
// create-skill Phase 3 Implementation pair: both hosts write a tiny SKILL.md
// via /create-skill (Cursor built-in) or Pi host /create-skill equivalent.
// Real PTY both sides via the recorder. Does not claim Discovery/Design/Verification.
//
// Usage: node scripts/capture-create-skill-impl.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/create-skill/
import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { sha256 } from '../recorder/files.mjs';
import { outputBytes, startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
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
const SCENARIO_REF = 'create-skill:phase-3-implementation';
const PAIR_ID = 'create-skill-impl-1';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stripAnsi = (text) =>
  text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');

function skillRel(side) {
  return side === 'cursor'
    ? join('.cursor', 'skills', SKILL_NAME, 'SKILL.md')
    : join('.pi', 'skills', SKILL_NAME, 'SKILL.md');
}

function skillAbs(side) {
  return join(fixtureApp, skillRel(side));
}

function writeRootFor(side) {
  return join(evidenceRoot, 'fixture-out', side);
}

function durableSkillPath(side) {
  return join(writeRootFor(side), 'SKILL.md');
}

function donePath(side) {
  return join(writeRootFor(side), 'done.txt');
}

function createPrompt(side) {
  const skillPath = skillRel(side);
  const outDone = donePath(side);
  const locationHint =
    side === 'cursor'
      ? 'project skill under .cursor/skills/ (not ~/.cursor/skills-cursor/)'
      : 'project skill under .pi/skills/';
  return (
    `/create-skill now for a project skill. ` +
    `Do not ask questions. All requirements are here. ` +
    `Purpose: teach the agent to echo the probe marker when the user says "run the create-skill probe". ` +
    `Target location: ${locationHint}. ` +
    `Write exactly ${skillPath} with YAML frontmatter name: ${SKILL_NAME} ` +
    `and a third-person description that includes the trigger phrases "create-skill probe" and "parity-create-skill-probe". ` +
    `Body must include the exact marker phrase ${MARKER} on its own line. ` +
    `Keep the skill under 80 lines. No supporting files. No scripts. ` +
    `Follow the create-skill skill for structure and frontmatter. ` +
    `When ${skillPath} is on disk, write exactly one line to ${outDone} as ` +
    `STATUS=wrote|env-blocked|other reason=<short phrase> then stop. ` +
    `Do not edit parity ledgers, parity/mismatches.json, parity/requirements.json, or parity/progress.md.`
  );
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null, status: null };
  const line = (await readFile(path, 'utf8')).trim();
  const m = line.match(/^STATUS=(wrote|env-blocked|other)\b/i);
  return { exists: true, path, line, status: m ? m[1].toLowerCase() : null };
}

async function readSkillMeta(side) {
  const path = skillAbs(side);
  if (!(await pathExists(path))) {
    return {
      exists: false,
      path,
      nameOk: false,
      hasMarker: false,
      hasDescription: false,
      byteLength: 0,
      sha256: null,
      ok: false,
    };
  }
  const text = await readFile(path, 'utf8');
  const nameOk = new RegExp(`^name:\\s*${SKILL_NAME}\\s*$`, 'm').test(text);
  const hasMarker = text.includes(MARKER);
  const hasDescription = /^description:\s*\S+/m.test(text);
  const digest = await sha256(path);
  return {
    exists: true,
    path,
    nameOk,
    hasMarker,
    hasDescription,
    byteLength: Buffer.byteLength(text),
    sha256: digest,
    ok: nameOk && hasMarker && hasDescription,
    text,
  };
}

function observeCreate(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  return {
    createSkillMention:
      /\b\/create-skill\b/i.test(hay) ||
      /\bcreate-skill\b/i.test(hay) ||
      /\[skill\]\s*create-skill\b/i.test(hay),
    skillPathMention: new RegExp(SKILL_NAME, 'i').test(hay),
    markerMention: hay.includes(MARKER),
    envBlocked:
      /\benv[- ]blocked\b/i.test(hay) ||
      /\bcannot (run|exercise|invoke).{0,40}create-skill\b/i.test(hay),
    working: /[\u2800-\u28FF]/.test(hay) || /\bWorking\b/.test(hay),
  };
}

async function cleanGenerated(side) {
  await rm(join(fixtureApp, '.cursor', 'skills', SKILL_NAME), { recursive: true, force: true });
  await rm(join(fixtureApp, '.pi', 'skills', SKILL_NAME), { recursive: true, force: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await rm(durableSkillPath(side), { force: true });
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: SCENARIO_REF,
    fixtureRef: { path: fixturePath, digest: fixtureDigest },
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
    fixturePath: referenceRulePath,
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
    fixturePath: piRulePath,
  });

async function restoreRule(bytes) {
  const backupPath = `${referenceRulePath}.create-skill-impl-backup`;
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

async function waitImplSettled(attempt, side, timeoutMs, prompt) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let calm = 0;
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observeCreate(last.join('\n'), { ignorePromptSlice: prompt });
    const meta = await readSkillMeta(side);
    const done = await readDone(side);
    const enough = meta.ok || done.status === 'wrote' || done.status === 'env-blocked';
    if (enough && !obs.working) {
      calm += 1;
      if (calm >= 3) return last;
    } else {
      calm = 0;
    }
    await sleep(800);
  }
  return last;
}

async function persistDurable(side, meta) {
  if (!meta.exists) return null;
  await mkdir(writeRootFor(side), { recursive: true });
  await cp(meta.path, durableSkillPath(side));
  return durableSkillPath(side);
}

function scoreImpl({ meta, done, screenObs, ptyObs }) {
  const wroteOk = Boolean(meta?.ok);
  const createPath =
    Boolean(screenObs?.createSkillMention) || Boolean(ptyObs?.createSkillMention);
  const envBlocked = done?.status === 'env-blocked' || Boolean(screenObs?.envBlocked);
  return {
    wroteOk,
    createPath,
    envBlocked,
    doneStatus: done?.status ?? null,
    phase3Closed: wroteOk && createPath,
    honestBlocker: !wroteOk && envBlocked,
  };
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.create-skill-impl-backup`;
  await mkdir(dir, { recursive: true });
  await cleanGenerated(side);
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = createPrompt(side);
  const observations = {};
  let attempt;
  try {
    await writeFile(rulePath, ruleBytes);
    if (side === 'pi') await ensurePiTrust();
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(ruleDigest) : piSpec(ruleDigest));
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
        ['create-skill', SKILL_NAME, 'SKILL.md', MARKER, 'STATUS=', 'env-blocked'],
        300_000,
      );
    } catch {
      // settle may still land the skill
    }
    await dumpScreen(attempt, dir, '03-signal', GEOMETRY);

    const settledLines = await waitImplSettled(attempt, side, SETTLE_MS, prompt);
    try {
      await waitSettled(attempt, GEOMETRY, 60_000);
    } catch {
      // best-effort
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '04-settled', GEOMETRY);

    const finalLines = settledLines.length ? settledLines : await screenLines(attempt, GEOMETRY);
    const ptyText = Buffer.from(outputBytes(attempt.events())).toString('utf8');
    observations.screenFinal = observeCreate(finalLines.join('\n'), { ignorePromptSlice: prompt });
    observations.pty = observeCreate(ptyText, { ignorePromptSlice: prompt });
    observations.skill = await readSkillMeta(side);
    observations.done = await readDone(side);
    observations.durableSkillPath = await persistDurable(side, observations.skill);
    observations.score = scoreImpl({
      meta: observations.skill,
      done: observations.done,
      screenObs: observations.screenFinal,
      ptyObs: observations.pty,
    });

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt-create.txt'), `${prompt}\n`);
    return {
      side,
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

async function loadSideFromDisk(side) {
  const obsPath = join(evidenceRoot, side, 'observations.json');
  if (!(await pathExists(obsPath))) return null;
  const observations = JSON.parse(await readFile(obsPath, 'utf8'));
  const sideRoot = join(evidenceRoot, side);
  const { readdir } = await import('node:fs/promises');
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
    attemptId,
    attemptDir,
    ruleUnchanged: true,
    afterDigest: identity?.fixtureRef?.digest ?? null,
    observations,
    identity,
  };
}

async function writePair(results, preDigest) {
  const bySide = Object.fromEntries(results.map((r) => [r.side, r]));
  if (!bySide.cursor) bySide.cursor = await loadSideFromDisk('cursor');
  if (!bySide.pi) bySide.pi = await loadSideFromDisk('pi');
  if (!bySide.cursor || !bySide.pi) return null;
  const cursor = bySide.cursor;
  const pi = bySide.pi;
  const pair = {
    schema: 1,
    pairId: PAIR_ID,
    scenarioRef: SCENARIO_REF,
    journeyFamily: 'cursor-create-skill',
    phaseTarget: 'create-skill-implementation',
    fixtureDigest: preDigest,
    steps: [
      { wait: 'ready screen (Tip: on Cursor; Pi chat ready without Trust dialog)' },
      { send: '/create-skill ... write parity-create-skill-probe SKILL.md with CREATE-SKILL-PROBE-MARKER' },
      { send: '\r' },
      { wait: 'on-disk SKILL.md with name + marker, or STATUS=env-blocked' },
      { cancel: true },
    ],
    cursor: {
      attemptId: cursor.attemptId,
      dir: cursor.attemptDir,
      ruleUnchanged: cursor.ruleUnchanged,
      afterDigest: cursor.afterDigest,
      executable: cursor.identity?.executable ?? null,
      observedEnv: cursor.identity?.observedEnv ?? null,
      skillPath: cursor.observations?.skill?.path ?? null,
      durableSkillPath: cursor.observations?.durableSkillPath ?? null,
      skillSha256: cursor.observations?.skill?.sha256 ?? null,
      observations: cursor.observations?.score ?? null,
    },
    pi: {
      attemptId: pi.attemptId,
      dir: pi.attemptDir,
      ruleUnchanged: pi.ruleUnchanged,
      afterDigest: pi.afterDigest,
      executable: pi.identity?.executable ?? null,
      observedEnv: pi.identity?.observedEnv ?? null,
      skillPath: pi.observations?.skill?.path ?? null,
      durableSkillPath: pi.observations?.durableSkillPath ?? null,
      skillSha256: pi.observations?.skill?.sha256 ?? null,
      observations: pi.observations?.score ?? null,
    },
    phaseClosure: {
      'create-skill-discovery': 'open',
      'create-skill-design': 'open',
      'create-skill-implementation':
        cursor.observations?.score?.phase3Closed && pi.observations?.score?.phase3Closed
          ? 'closed_by_this_pair'
          : 'open',
      'create-skill-verification': 'open',
    },
  };
  const pairPath = join(evidenceRoot, `pair-${PAIR_ID}.json`);
  await writeFile(pairPath, `${JSON.stringify(pair, null, 2)}\n`, { flag: 'w' });
  return pairPath;
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
  const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
  const results = [];
  for (const side of sides) {
    const result = await runSide(side, preRule, preDigest);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  const pairPath = await writePair(results, preDigest);
  await writeFile(
    join(evidenceRoot, 'capture-results.json'),
    `${JSON.stringify({ scenario: SCENARIO_REF, fixtureDigest: preDigest, pairPath, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      scenario: SCENARIO_REF,
      fixtureDigest: preDigest,
      pairPath,
      results: results.map((r) => ({
        side: r.side,
        attemptId: r.attemptId,
        wroteOk: r.observations.score.wroteOk,
        createPath: r.observations.score.createPath,
        phase3Closed: r.observations.score.phase3Closed,
        honestBlocker: r.observations.score.honestBlocker,
        skillSha256: r.observations.skill?.sha256 ?? null,
      })),
    }),
  );
}
