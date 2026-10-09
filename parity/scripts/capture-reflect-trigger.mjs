#!/usr/bin/env node
// cmd-reflect-trigger: substantive fixture turn, then /reflect with three-lens fan-out.
// Real PTY both sides via the recorder. Screens + Pi session are the oracle.
//
// Usage: node scripts/capture-reflect-trigger.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/reflect/
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { outputBytes, startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'reflect');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const baselineRoot = join(evidenceRoot, 'fixture-baseline');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stripAnsi = (text) =>
  text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');

function writeRootFor(side) {
  return join(evidenceRoot, 'fixture-out', side);
}

function donePath(side) {
  return join(writeRootFor(side), 'done.txt');
}

function substantivePrompt() {
  return (
    `In this fixture cwd only: implement clamp(n, lo, hi) in src/clamp.js so values below lo ` +
    `return lo and values above hi return hi. Add exactly one line to NOTES.md stating that ` +
    `bound checks belong at the API boundary. Do not edit ledgers, parity/, skills, or paths ` +
    `outside this cwd. When the two files are updated, stop and wait.`
  );
}

function reflectPrompt(side) {
  const done = donePath(side);
  return (
    `/reflect over this session. Locate the active transcript, or write a tight digest if the ` +
    `path cannot be resolved. Spawn the three parallel reviewers (judgment, tooling, divergent) ` +
    `using the reflect skill templates, then the synthesizer. Present Accepted / Rejected / Backlog. ` +
    `Do not apply any skill edits and do not wait for approval after presenting the lists. ` +
    `Work only inside this fixture cwd for marker files. When the synthesized lists are presented, ` +
    `write exactly one line to ${done} as reflect=yes|skipped|fail then stop.`
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

async function hashText(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function restoreFixture() {
  for (const rel of ['src/clamp.js', 'NOTES.md', 'README.md']) {
    const dest = join(fixtureApp, rel);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, await readFile(join(baselineRoot, rel)));
  }
}

function scoreReflect(text) {
  const normalized = stripAnsi(text || '');
  const reflectSkill =
    /\/reflect\b/i.test(normalized) ||
    /\[skill\]\s*reflect/i.test(normalized) ||
    /\bUsed reflect\b/i.test(normalized) ||
    /\bLoaded reflect\b/i.test(normalized) ||
    /\bskill:\s*reflect\b/i.test(normalized);
  const skipped =
    /\breflect is skipped\b/i.test(normalized) ||
    /\bskip(?:ping|ped)?\b.*\breflect\b/i.test(normalized) ||
    /\btrivial\b.*\b(skip|off-topic)\b/i.test(normalized);
  const judgment = /\bjudgment\b/i.test(normalized);
  const tooling = /\btooling\b/i.test(normalized);
  const divergent = /\bdivergent\b/i.test(normalized);
  const lensHits = [judgment, tooling, divergent].filter(Boolean).length;
  const spawnSignal =
    /\bTask\b/i.test(normalized) ||
    /\bAgent\b/i.test(normalized) ||
    /\bsubagent\b/i.test(normalized) ||
    /\bgeneralPurpose\b/i.test(normalized) ||
    /\bgeneral-purpose\b/i.test(normalized) ||
    /\bRunning\b.*\b(subagent|agent|task)\b/i.test(normalized) ||
    /\bspawn(?:ed|ing)?\b/i.test(normalized);
  const synthesizer =
    /\bAccepted\b/i.test(normalized) ||
    /\bRejected\b/i.test(normalized) ||
    /\bBacklog\b/i.test(normalized) ||
    /\bsynthesiz/i.test(normalized);
  const multiAgentReview = (lensHits >= 2 && spawnSignal) || (lensHits === 3 && synthesizer) || (spawnSignal && synthesizer && lensHits >= 1);
  return {
    reflectSkill,
    skipped,
    judgment,
    tooling,
    divergent,
    lensHits,
    spawnSignal,
    synthesizer,
    multiAgentReview,
    working: /[\u2800-\u28FF]/.test(normalized) || /\bWorking\b/.test(normalized),
  };
}

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'cmd-reflect-trigger',
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
  const backupPath = `${referenceRulePath}.reflect-trigger-backup`;
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
      (/fixture-app|reflect|clamp|medium|Skill conflicts|NOTES/i.test(text) || /README/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'reflect-fixture-app';
  let best = null;
  async function walk(dir) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl') && abs.includes(needle)) {
        const st = await stat(abs).catch(() => null);
        if (!st) continue;
        const ms = st.mtimeMs;
        if (!best || ms > best.ms) best = { path: abs, ms };
      }
    }
  }
  await walk(sessionsRoot);
  return best?.path ?? null;
}

async function summarizePiSession(sessionPath) {
  if (!sessionPath || !(await pathExists(sessionPath))) return null;
  const lines = (await readFile(sessionPath, 'utf8')).split('\n').filter(Boolean);
  const toolOrder = [];
  let skillInjected = false;
  let taskCount = 0;
  let assistantTexts = [];
  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const blob = JSON.stringify(o);
    if (blob.includes('reflect') && /skill/i.test(blob)) skillInjected = true;
    const msg = o.message || o;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type === 'toolCall' || part.type === 'tool_use') {
        const name = part.name || part.toolName || '';
        toolOrder.push(name);
        if (/^(task|Task|Agent)$/i.test(name)) taskCount += 1;
      }
      if (part.type === 'text' && typeof part.text === 'string' && (msg.role === 'assistant' || o.type === 'message')) {
        assistantTexts.push(part.text);
      }
    }
  }
  return {
    sessionPath,
    skillInjected,
    taskCount,
    toolOrder: toolOrder.slice(0, 160),
    assistantJoined: assistantTexts.join('\n\n'),
  };
}

async function waitTurnSettled(attempt, side, timeoutMs, { needDone = false } = {}) {
  const deadline = Date.now() + timeoutMs;
  let calm = 0;
  while (Date.now() < deadline) {
    const lines = await screenLines(attempt, GEOMETRY);
    const obs = scoreReflect(lines.join('\n'));
    const done = needDone ? await readDone(side) : { exists: false };
    const enough = needDone ? done.exists || obs.multiAgentReview || obs.skipped : !obs.working;
    if (enough && !obs.working) {
      calm += 1;
      if (calm >= 3) return;
    } else {
      calm = 0;
    }
    await sleep(800);
  }
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.reflect-trigger-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await restoreFixture();
  if (side === 'pi') await ensurePiTrust();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const turn1 = substantivePrompt();
  const turn2 = reflectPrompt(side);
  let attempt;
  try {
    await writeFile(rulePath, ruleBytes);
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(ruleDigest) : piSpec(ruleDigest));
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitPiChatReady(attempt, 120_000);
    }
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);

    attempt.input(Buffer.from(turn1), 'literal_user');
    await sleep(600);
    await dumpScreen(attempt, dir, '01-typed-substantive', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '02-submitted-substantive', GEOMETRY);

    try {
      await waitEither(attempt, GEOMETRY, ['clamp', 'NOTES', 'boundary', 'Edited', 'Wrote'], 600_000);
    } catch {
      // continue to settle
    }
    await waitTurnSettled(attempt, side, 600_000, { needDone: false });
    try {
      await waitSettled(attempt, GEOMETRY, 120_000);
    } catch {
      // best-effort
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '03-substantive-settled', GEOMETRY);

    attempt.input(Buffer.from(turn2), 'literal_user');
    await sleep(600);
    await dumpScreen(attempt, dir, '04-typed-reflect', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '05-submitted-reflect', GEOMETRY);

    try {
      await waitEither(
        attempt,
        GEOMETRY,
        ['reflect', 'judgment', 'tooling', 'divergent', 'Accepted', 'Rejected', 'Backlog', 'reflect='],
        900_000,
      );
    } catch {
      // settle may still land artifacts
    }
    await dumpScreen(attempt, dir, '06-signal', GEOMETRY);

    await waitTurnSettled(attempt, side, SETTLE_MS, { needDone: true });
    try {
      await waitSettled(attempt, GEOMETRY, 120_000);
    } catch {
      // best-effort
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '07-settled', GEOMETRY);

    const settledText = (await screenLines(attempt, GEOMETRY)).join('\n');
    const ptyText = stripAnsi(outputBytes(attempt.events()).toString('utf8'));
    const done = await readDone(side);
    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      sessionSummary = await summarizePiSession(await findLatestPiSession());
    }

    const screenScore = scoreReflect(settledText);
    const ptyScore = scoreReflect(ptyText);
    const sessionScore =
      sessionSummary?.assistantJoined ? scoreReflect(sessionSummary.assistantJoined) : null;
    const candidates = [sessionScore, screenScore, ptyScore].filter(Boolean);
    const bestScore =
      candidates.sort(
        (a, b) =>
          Number(b.multiAgentReview) - Number(a.multiAgentReview) ||
          b.lensHits - a.lensHits ||
          Number(b.synthesizer) - Number(a.synthesizer),
      )[0] || screenScore;

    const skillActivated = Boolean(
      screenScore.reflectSkill || ptyScore.reflectSkill || sessionSummary?.skillInjected || /\/reflect\b/i.test(turn2),
    );
    const multiAgentReview = Boolean(
      bestScore?.multiAgentReview ||
        (sessionSummary?.taskCount ?? 0) >= 3 ||
        ((sessionSummary?.taskCount ?? 0) >= 2 && bestScore?.synthesizer),
    );

    const clampAfter = await readFile(join(fixtureApp, 'src/clamp.js'), 'utf8');
    const notesAfter = await readFile(join(fixtureApp, 'NOTES.md'), 'utf8');
    const clampDigest = await hashText(clampAfter);
    const notesDigest = await hashText(notesAfter);

    const observations = {
      skillActivated,
      screenScore,
      ptyScore,
      sessionScore,
      bestScore,
      multiAgentReview,
      skipped: Boolean(bestScore?.skipped || /^reflect=skipped$/i.test(done.line || '')),
      done,
      clampDigest,
      notesDigest,
      session: sessionSummary
        ? {
            sessionPath: sessionSummary.sessionPath,
            skillInjected: sessionSummary.skillInjected,
            taskCount: sessionSummary.taskCount,
            toolOrder: sessionSummary.toolOrder,
          }
        : null,
    };

    const afterRule = await readFile(rulePath, 'utf8');
    const afterRuleDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), afterRule);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt-substantive.txt'), `${turn1}\n`);
    await writeFile(join(dir, 'prompt-reflect.txt'), `${turn2}\n`);
    await writeFile(join(dir, 'clamp-after.js'), clampAfter);
    await writeFile(join(dir, 'notes-after.md'), notesAfter);

    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      ruleUnchanged: afterRule === ruleBytes,
      afterDigest: afterRuleDigest,
      fixtureDigest: ruleDigest,
      prompts: { substantive: turn1, reflect: turn2 },
      observations,
    };
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
    await restoreRule(ruleBytes);
    await restoreFixture();
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
    scenario: 'cmd-reflect-trigger',
    fixtureDigest: preDigest,
    results,
  }),
);
