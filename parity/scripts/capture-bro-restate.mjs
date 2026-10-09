#!/usr/bin/env node
// cmd-bro-restate: jargon-heavy assistant reply, then /bro plain restatement.
// Real PTY both sides via the recorder. Screens + Pi session are the oracle.
//
// Usage: node scripts/capture-bro-restate.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/bro/
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { outputBytes, startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'bro');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const baselineRoot = join(evidenceRoot, 'fixture-baseline');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_200_000;

const JARGON_TERMS = [
  'event loop',
  'microtask',
  'libuv',
  'thread pool',
  'epoll',
  'kqueue',
  'macrotask',
  'callback queue',
  'tick',
  'I/O completion',
  'phase',
];

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

function restatePath(side) {
  return join(writeRootFor(side), 'restate.md');
}

function jargonPrompt() {
  return (
    `In one short reply only, explain how Node's event loop interacts with the promise ` +
    `microtask queue and the libuv thread pool using precise systems terminology ` +
    `(event loop phases, microtasks, macrotasks, libuv thread pool, I/O completion). ` +
    `Do not create or edit any files. Do not run tools. Stop after the explanation.`
  );
}

function broPrompt(side) {
  const out = restatePath(side);
  const done = donePath(side);
  return (
    `/bro Restate your last message in plain human language with no jargon. ` +
    `Do not continue any prior task and do not create product code. ` +
    `Work only inside this fixture cwd for marker files. ` +
    `Write the plain restatement to ${out}. ` +
    `Then write exactly one line to ${done} as bro=yes|no|fail, then stop.`
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

function countJargon(text) {
  const lower = (text || '').toLowerCase();
  return JARGON_TERMS.filter((term) => lower.includes(term.toLowerCase()));
}

function observeWorking(text) {
  return /[\u2800-\u28FF]/.test(text || '') || /\bWorking\b/.test(text || '');
}

function scoreBro(text, { restateText = '', doneLine = null } = {}) {
  const normalized = stripAnsi(text || '');
  const restateNorm = stripAnsi(restateText || '');
  const broSkill =
    /\/bro\b/i.test(normalized) ||
    /\[skill\]\s*bro/i.test(normalized) ||
    /\bUsed bro\b/i.test(normalized) ||
    /\bLoaded bro\b/i.test(normalized) ||
    /\bskill:\s*bro\b/i.test(normalized) ||
    /Restate your last message/i.test(normalized);
  const plainHints =
    /\b(in plain words|simply put|plain english|plain language|in short|basically)\b/i.test(
      normalized + '\n' + restateNorm,
    ) ||
    /\b(the runtime|node waits|promises run|background workers)\b/i.test(restateNorm) ||
    (restateNorm.length > 40 && countJargon(restateNorm).length <= 2);
  const jargonHits = countJargon(restateNorm || normalized);
  const continuedPrior =
    /\b(implement|src\/|package\.json|refactor|write (the )?code|create a (file|module))\b/i.test(
      normalized + '\n' + restateNorm,
    ) && !/do not create|do not continue|do not edit/i.test(normalized);
  const doneYes = /^bro=yes$/i.test(doneLine || '');
  const doneNo = /^bro=no$/i.test(doneLine || '');
  const doneFail = /^bro=fail$/i.test(doneLine || '');
  const restated =
    (restateNorm.trim().length > 40 && plainHints) ||
    (doneYes && restateNorm.trim().length > 20) ||
    (broSkill && plainHints && jargonHits.length <= 3);
  let outcome = 'neither';
  if (continuedPrior && restated) outcome = 'continued_prior_task';
  else if (restated && jargonHits.length > 4) outcome = 'restate_still_jargon';
  else if (restated) outcome = 'restate_plain';
  else if (broSkill && !restated) outcome = 'skill_only';
  else if (doneNo || doneFail) outcome = 'neither';
  else if (broSkill || restateNorm) outcome = 'inconclusive';
  return {
    broSkill,
    plainHints,
    jargonHits,
    jargonCount: jargonHits.length,
    continuedPrior,
    restated,
    doneYes,
    doneNo,
    doneFail,
    outcome,
    working: observeWorking(normalized),
  };
}

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line };
}

async function readRestate(side) {
  const path = restatePath(side);
  if (!(await pathExists(path))) return { exists: false, path, text: null };
  const text = await readFile(path, 'utf8');
  return { exists: true, path, text };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'cmd-bro-restate',
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
  const backupPath = `${referenceRulePath}.bro-restate-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function restoreFixture() {
  const dest = join(fixtureApp, 'README.md');
  await mkdir(fixtureApp, { recursive: true });
  await writeFile(dest, await readFile(join(baselineRoot, 'README.md')));
  for (const name of ['restate.md', 'done.txt', 'src', 'NOTES.md']) {
    await rm(join(fixtureApp, name), { force: true, recursive: true });
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
      (/fixture-app|hello-notes|bro|medium|Skill conflicts|README/i.test(text) || /notes/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'bro-fixture-app';
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
  let promptInjected = false;
  const assistantTexts = [];
  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const blob = JSON.stringify(o);
    if (/\bbro\b/i.test(blob) && /skill/i.test(blob)) skillInjected = true;
    if (/\bbro\b/i.test(blob) && /prompt/i.test(blob)) promptInjected = true;
    if (/Restate your last message/i.test(blob)) promptInjected = true;
    const msg = o.message || o;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type === 'toolCall' || part.type === 'tool_use') {
        toolOrder.push(part.name || part.toolName || '');
      }
      if (
        part.type === 'text' &&
        typeof part.text === 'string' &&
        (msg.role === 'assistant' || o.type === 'message')
      ) {
        assistantTexts.push(part.text);
      }
    }
  }
  return {
    sessionPath,
    skillInjected,
    promptInjected,
    toolOrder: toolOrder.slice(0, 160),
    assistantJoined: assistantTexts.join('\n\n'),
    lastAssistant: assistantTexts[assistantTexts.length - 1] || '',
    assistantCount: assistantTexts.length,
  };
}

async function waitTurnSettled(attempt, side, timeoutMs, { needDone = false } = {}) {
  const deadline = Date.now() + timeoutMs;
  let calm = 0;
  while (Date.now() < deadline) {
    const lines = await screenLines(attempt, GEOMETRY);
    const text = lines.join('\n');
    const done = needDone ? await readDone(side) : { exists: false };
    const restate = needDone ? await readRestate(side) : { exists: false };
    const working = observeWorking(text);
    const enough = needDone ? done.exists || restate.exists : !working;
    if (enough && !working) {
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
  const backupPath = `${referenceRulePath}.bro-restate-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await rm(restatePath(side), { force: true });
  await restoreFixture();
  if (side === 'pi') await ensurePiTrust();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const turn1 = jargonPrompt();
  const turn2 = broPrompt(side);
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
    await dumpScreen(attempt, dir, '01-typed-jargon', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '02-submitted-jargon', GEOMETRY);

    try {
      await waitEither(
        attempt,
        GEOMETRY,
        ['event loop', 'microtask', 'libuv', 'thread pool', 'macrotask', 'Node'],
        600_000,
      );
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
    const jargonScreen = await dumpScreen(attempt, dir, '03-jargon-settled', GEOMETRY);
    const jargonText = jargonScreen.join('\n');
    const jargonHitsTurn1 = countJargon(jargonText);

    attempt.input(Buffer.from(turn2), 'literal_user');
    await sleep(600);
    await dumpScreen(attempt, dir, '04-typed-bro', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '05-submitted-bro', GEOMETRY);

    try {
      await waitEither(
        attempt,
        GEOMETRY,
        ['bro', 'plain', 'restate', 'simply', 'jargon', 'bro=', 'restate.md'],
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
    const restate = await readRestate(side);
    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      sessionSummary = await summarizePiSession(await findLatestPiSession());
    }

    const screenScore = scoreBro(settledText, { restateText: restate.text || '', doneLine: done.line });
    const ptyScore = scoreBro(ptyText, { restateText: restate.text || '', doneLine: done.line });
    const sessionScore = sessionSummary?.lastAssistant
      ? scoreBro(sessionSummary.lastAssistant, {
          restateText: restate.text || sessionSummary.lastAssistant,
          doneLine: done.line,
        })
      : null;
    const fileScore = restate.exists
      ? scoreBro(restate.text, { restateText: restate.text, doneLine: done.line })
      : null;
    const candidates = [fileScore, sessionScore, screenScore, ptyScore].filter(Boolean);
    const bestScore =
      candidates.sort(
        (a, b) =>
          Number(b.outcome === 'restate_plain') - Number(a.outcome === 'restate_plain') ||
          Number(b.restated) - Number(a.restated) ||
          a.jargonCount - b.jargonCount,
      )[0] || screenScore;

    const skillActivated = Boolean(
      screenScore.broSkill ||
        ptyScore.broSkill ||
        sessionSummary?.skillInjected ||
        sessionSummary?.promptInjected ||
        /\/bro\b/i.test(turn2),
    );

    const productFilesTouched = [];
    for (const rel of ['src', 'NOTES.md', 'package.json', 'clamp.js']) {
      if (await pathExists(join(fixtureApp, rel))) productFilesTouched.push(rel);
    }

    const observations = {
      skillActivated,
      jargonHitsTurn1,
      jargonDensePrior: jargonHitsTurn1.length >= 3,
      screenScore,
      ptyScore,
      sessionScore,
      fileScore,
      bestScore,
      outcome: bestScore.outcome,
      restatedPlain: bestScore.outcome === 'restate_plain',
      continuedPriorTask: bestScore.outcome === 'continued_prior_task' || productFilesTouched.length > 0,
      productFilesTouched,
      done,
      restate: {
        exists: restate.exists,
        path: restate.path,
        digest: restate.exists
          ? createHash('sha256').update(restate.text).digest('hex')
          : null,
        preview: (restate.text || '').slice(0, 400),
      },
      session: sessionSummary
        ? {
            sessionPath: sessionSummary.sessionPath,
            skillInjected: sessionSummary.skillInjected,
            promptInjected: sessionSummary.promptInjected,
            toolOrder: sessionSummary.toolOrder,
            assistantCount: sessionSummary.assistantCount,
          }
        : null,
    };

    const afterRule = await readFile(rulePath, 'utf8');
    const afterRuleDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), afterRule);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt-jargon.txt'), `${turn1}\n`);
    await writeFile(join(dir, 'prompt-bro.txt'), `${turn2}\n`);
    if (restate.exists) await writeFile(join(dir, 'restate-after.md'), restate.text);

    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      ruleUnchanged: afterRule === ruleBytes,
      afterDigest: afterRuleDigest,
      fixtureDigest: ruleDigest,
      prompts: { jargon: turn1, bro: turn2 },
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
    scenario: 'cmd-bro-restate',
    fixtureDigest: preDigest,
    results,
  }),
);
