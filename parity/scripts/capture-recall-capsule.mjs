#!/usr/bin/env node
// Family 13 /recall pair: invoke /recall on a seeded fixture and score the
// output contract (capsule ≤5, tagged threads, problems ≤5, single next move).
// Real PTY both sides via the recorder.
//
// Usage: node scripts/capture-recall-capsule.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/recall/
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
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
const evidenceRoot = join(root, 'evidence', 'recall');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_200_000;
const THREAD_TAG_RE =
  /^\[(?:merged #\d+|open PR #\d+|in flight [^\]]+|verified, uncommitted|reverted #\d+|planned, not started)\]/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stripAnsi = (text) =>
  text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');

function writeRootFor(side) {
  return join(evidenceRoot, 'fixture-out', side);
}

function briefPath(side) {
  return join(writeRootFor(side), 'brief.md');
}

function donePath(side) {
  return join(writeRootFor(side), 'done.txt');
}

function recallPrompt(side) {
  const brief = briefPath(side);
  const done = donePath(side);
  return (
    `/recall catch me up on the hello-cli verification work. ` +
    `Scope: this fixture cwd only, last 7 days. ` +
    `Mine only seed/transcripts/ (prior chats; cite by UUID filename) and seed/shared-record/ (shared record). ` +
    `Do not invent sources outside seed/. Do not skip mining. ` +
    `Write the brief to the recall output contract: Capsule (at most 5 bullets), ` +
    `Threads (one line each with exactly one status tag), Problems (at most 5), ` +
    `and a single concrete Next move. ` +
    `Work only inside this fixture cwd. Do not edit ledgers, parity/, or files outside this cwd ` +
    `except the named out paths. ` +
    `When finished, write the same brief to ${brief}, then write exactly one line to ${done} ` +
    `with contract=yes|no, then stop.`
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

function sectionBody(text, headingRe, nextHeadingRe) {
  const start = text.search(headingRe);
  if (start < 0) return null;
  const after = text.slice(start);
  const firstNl = after.indexOf('\n');
  const bodyStart = firstNl >= 0 ? firstNl + 1 : after.length;
  const rest = after.slice(bodyStart);
  const endRel = rest.search(nextHeadingRe);
  return (endRel >= 0 ? rest.slice(0, endRel) : rest).trim();
}

function bulletCount(body) {
  if (!body) return 0;
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s+/.test(l) || /^\d+\.\s+/.test(l))
    .length;
}

function threadLines(body) {
  if (!body) return [];
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, ''));
}

function scoreContract(text) {
  const normalized = stripAnsi(text || '');
  const hasCapsuleHeading = /\bCapsule\b/i.test(normalized);
  const hasThreadsHeading = /\bThreads?\b/i.test(normalized);
  const hasProblemsHeading = /\bProblems?\b/i.test(normalized);
  const hasNextHeading = /\bNext move\b/i.test(normalized);

  const capsuleBody = sectionBody(
    normalized,
    /^#{1,3}\s*\**Capsule\**\b.*$/im,
    /^#{1,3}\s*\**Threads?\**\b/im,
  );
  const threadsBody = sectionBody(
    normalized,
    /^#{1,3}\s*\**Threads?\**\b.*$/im,
    /^#{1,3}\s*\**(Problems?|Next move)\**\b/im,
  );
  const problemsBody = sectionBody(
    normalized,
    /^#{1,3}\s*\**Problems?\**\b.*$/im,
    /^#{1,3}\s*\**Next move\**\b/im,
  );
  const nextBody = sectionBody(
    normalized,
    /^#{1,3}\s*\**Next move\**\b.*$/im,
    /^#{1,3}\s+\S+/m,
  );

  const capsuleBullets = bulletCount(capsuleBody);
  const threads = threadLines(threadsBody);
  const taggedThreads = threads.filter((l) => THREAD_TAG_RE.test(l));
  const problemsBullets = bulletCount(problemsBody);
  const nextLines = (nextBody || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^#{1,3}\s/.test(l));

  const capsuleOk = hasCapsuleHeading && capsuleBullets > 0 && capsuleBullets <= 5;
  const threadsOk = hasThreadsHeading && threads.length > 0 && taggedThreads.length === threads.length;
  const problemsOk = hasProblemsHeading && problemsBullets > 0 && problemsBullets <= 5;
  const nextOk = hasNextHeading && nextLines.length === 1;

  return {
    hasCapsuleHeading,
    hasThreadsHeading,
    hasProblemsHeading,
    hasNextHeading,
    capsuleBullets,
    threadCount: threads.length,
    taggedThreadCount: taggedThreads.length,
    problemsBullets,
    nextLineCount: nextLines.length,
    nextLine: nextLines[0] || null,
    threads,
    capsuleOk,
    threadsOk,
    problemsOk,
    nextOk,
    contractHeld: capsuleOk && threadsOk && problemsOk && nextOk,
  };
}

function observeSignals(text) {
  const recallSkill =
    /\/recall\b/i.test(text) ||
    /\[skill\]\s*recall/i.test(text) ||
    /\bUsed recall\b/i.test(text) ||
    /\brecall\b/i.test(text);
  const working = /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text);
  return { recallSkill, working, contract: scoreContract(text) };
}

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line };
}

async function readBrief(side) {
  const path = briefPath(side);
  if (!(await pathExists(path))) return { exists: false, path, text: null };
  const text = await readFile(path, 'utf8');
  return { exists: true, path, text };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'cmd-recall-capsule',
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
  const backupPath = `${referenceRulePath}.recall-capsule-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'recall-fixture-app';
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
  let assistantTexts = [];
  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const blob = JSON.stringify(o);
    if (blob.includes('recall') && /skill/i.test(blob)) skillInjected = true;
    const msg = o.message || o;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type === 'toolCall' || part.type === 'tool_use') {
        toolOrder.push(part.name || part.toolName || '');
      }
      if (part.type === 'text' && typeof part.text === 'string' && (msg.role === 'assistant' || o.type === 'message')) {
        assistantTexts.push(part.text);
      }
    }
  }
  return {
    sessionPath,
    skillInjected,
    toolOrder: toolOrder.slice(0, 80),
    assistantJoined: assistantTexts.join('\n\n'),
  };
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.recall-capsule-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(briefPath(side), { force: true });
  await rm(donePath(side), { force: true });
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = recallPrompt(side);
  let attempt;
  try {
    await writeFile(rulePath, ruleBytes);
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(ruleDigest) : piSpec(ruleDigest));
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitEither(attempt, GEOMETRY, ['hello', 'README', 'pi', 'seed'], 120_000);
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
        ['recall', 'Capsule', 'Threads', 'Problems', 'Next move', 'seed/'],
        300_000,
      );
    } catch {
      // settle may still land artifacts
    }
    await dumpScreen(attempt, dir, '03-signal', GEOMETRY);

    const deadline = Date.now() + SETTLE_MS;
    let calm = 0;
    while (Date.now() < deadline) {
      const lines = await screenLines(attempt, GEOMETRY);
      const obs = observeSignals(lines.join('\n'));
      const brief = await readBrief(side);
      const done = await readDone(side);
      const enough = brief.exists || done.exists || obs.contract.contractHeld;
      if (enough && !obs.working) {
        calm += 1;
        if (calm >= 3) break;
      } else {
        calm = 0;
      }
      await sleep(800);
    }
    try {
      await waitSettled(attempt, GEOMETRY, 90_000);
    } catch {
      // best-effort
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '04-settled', GEOMETRY);

    const settledText = (await screenLines(attempt, GEOMETRY)).join('\n');
    const ptyText = stripAnsi(outputBytes(attempt.events()).toString('utf8'));
    const brief = await readBrief(side);
    const done = await readDone(side);
    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      sessionSummary = await summarizePiSession(await findLatestPiSession());
    }

    const screenScore = scoreContract(settledText);
    const ptyScore = scoreContract(ptyText);
    const briefScore = brief.exists ? scoreContract(brief.text) : null;
    const sessionScore =
      sessionSummary?.assistantJoined ? scoreContract(sessionSummary.assistantJoined) : null;
    const bestScore =
      [briefScore, sessionScore, screenScore, ptyScore]
        .filter(Boolean)
        .sort((a, b) => Number(b.contractHeld) - Number(a.contractHeld))[0] || screenScore;

    const skillActivated = Boolean(
      observeSignals(settledText).recallSkill ||
        observeSignals(ptyText).recallSkill ||
        sessionSummary?.skillInjected,
    );

    const observations = {
      skillActivated,
      screenScore,
      ptyScore,
      briefScore,
      sessionScore,
      bestScore,
      contractHeld: Boolean(bestScore?.contractHeld),
      brief,
      done,
      session: sessionSummary
        ? {
            sessionPath: sessionSummary.sessionPath,
            skillInjected: sessionSummary.skillInjected,
            toolOrder: sessionSummary.toolOrder,
          }
        : null,
    };

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
    if (brief.exists) {
      await writeFile(join(dir, 'brief-copy.md'), brief.text);
    }

    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      ruleUnchanged: after === ruleBytes,
      afterDigest,
      fixtureDigest: ruleDigest,
      prompt,
      observations,
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
    scenario: 'cmd-recall-capsule',
    fixtureDigest: preDigest,
    results,
  }),
);
