#!/usr/bin/env node
// cmd-correct-encode: /correct raises enforcement above docs and proves fail on a past mistake.
// Real PTY both sides via the recorder. Screens + written files + Pi session are the oracle.
//
// Usage: node scripts/capture-correct-encode.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/correct/
import { access, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { outputBytes, startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'correct');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const baselineRoot = join(evidenceRoot, 'fixture-baseline');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_200_000;

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

function proofPath(side) {
  return join(writeRootFor(side), 'proof.txt');
}

function notePath(side) {
  return join(writeRootFor(side), 'encoding.md');
}

function correctPrompt(side) {
  const done = donePath(side);
  const proof = proofPath(side);
  const note = notePath(side);
  return (
    `/correct agents keep importing src/db.js from feature modules instead of using src/store.js. ` +
    `Mine CORRECTIONS.md and history/ in this fixture cwd. The docs-only note in AGENTS.md is not enough. ` +
    `Encode the mistake at the highest working level that works (architecture, then types or lint, then a test, docs last). ` +
    `Prove the new check fails on the real past mistake at history/past-mistake-1.js. ` +
    `Work only inside this fixture cwd for product changes. ` +
    `Write a short summary of the level you picked and the proof command to ${note}. ` +
    `Write the exact proof command and its non-zero exit code to ${proof}. ` +
    `Then write exactly one line to ${done} as correct=yes|no|fail, then stop.`
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

function observeWorking(text) {
  return /[\u2800-\u28FF]/.test(text || '') || /\bWorking\b/.test(text || '');
}

async function listFilesRecursive(dir, base = dir) {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(abs, base)));
    } else if (entry.isFile()) {
      out.push(relative(base, abs));
    }
  }
  return out.sort();
}

async function fileDigestMap(dir) {
  const files = await listFilesRecursive(dir);
  const map = {};
  for (const rel of files) {
    const bytes = await readFile(join(dir, rel));
    map[rel] = createHash('sha256').update(bytes).digest('hex');
  }
  return map;
}

function diffMaps(before, after) {
  const added = [];
  const changed = [];
  const removed = [];
  for (const key of Object.keys(after)) {
    if (!(key in before)) added.push(key);
    else if (before[key] !== after[key]) changed.push(key);
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) removed.push(key);
  }
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort() };
}

function classifyEncodingLevel(diff, encodingText = '') {
  const paths = [...diff.added, ...diff.changed, ...diff.removed].map((p) => p.replace(/\\/g, '/'));
  const pathBlob = paths.join('\n').toLowerCase();
  const note = (encodingText || '').toLowerCase();
  const docsOnlyPaths =
    paths.length > 0 &&
    paths.every(
      (p) =>
        /(^|\/)agents\.md$/i.test(p) ||
        /(^|\/)readme\.md$/i.test(p) ||
        /(^|\/)corrections\.md$/i.test(p) ||
        /\.mdc$/i.test(p),
    );
  // Prefer what landed on disk over prose that mentions higher levels as rejected options.
  const architecture =
    (paths.some((p) => /src\/db\.js$/i.test(p)) &&
      (diff.removed.some((p) => /src\/db\.js$/i.test(p)) || /hide|rename|internal/i.test(note))) ||
    (paths.some((p) => /package\.json$/i.test(p)) &&
      /exports|\"private\"\s*:\s*true/i.test(note) &&
      !/lint|check-store|scripts\//i.test(pathBlob + note));
  const lint =
    paths.some((p) => /^scripts\/.+\.m?js$/i.test(p) || /eslint|biome|lint/i.test(p)) ||
    /no-restricted-imports|restricted.?import|lint:store|check-store-boundary/i.test(
      pathBlob + '\n' + note,
    );
  const types =
    paths.some((p) => /\.d\.ts$/i.test(p) || /tsconfig/i.test(p)) ||
    (/\btypescript\b|\btypecheck\b|\btsc\b/i.test(note) && paths.some((p) => /\.ts$/i.test(p)));
  const test =
    paths.some((p) => /^test\/.+\.test\.js$/i.test(p)) ||
    (/\bnode --test\b|\bnpm test\b/i.test(note) && !lint);
  const docs = docsOnlyPaths;

  let level = 'none';
  if (architecture) level = 'architecture';
  else if (types) level = 'types';
  else if (lint) level = 'lint';
  else if (test) level = 'test';
  else if (docs) level = 'docs';

  const aboveDocs = ['architecture', 'types', 'lint', 'test'].includes(level);
  return {
    level,
    aboveDocs,
    docsOnly: level === 'docs',
    paths,
  };
}

async function runProofCandidate(cwd, command) {
  if (!command || !command.trim()) return null;
  const child = spawn(command, {
    cwd,
    shell: true,
    env: { ...process.env, PATH: process.env.PATH ?? '' },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    stdout += d.toString('utf8');
  });
  child.stderr.on('data', (d) => {
    stderr += d.toString('utf8');
  });
  const code = await new Promise((resolve) => {
    child.on('close', (c) => resolve(c ?? 1));
  });
  return {
    command,
    exitCode: code,
    failedAsExpected: code !== 0,
    stdout: stdout.slice(0, 2000),
    stderr: stderr.slice(0, 2000),
  };
}

function extractProofCommand(proofText) {
  const text = proofText || '';
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^(node|npm|npx|bun|pnpm|yarn|eslint|biome)\b/i.test(l));
  if (line) return line.replace(/\s+#.*$/, '').replace(/\s+exit.*/i, '').trim();
  const m = text.match(
    /\b((?:node|npm|npx|bun|pnpm|yarn|eslint|biome)[^\n]*?(?:past-mistake|check-|test)[^\n]*)/i,
  );
  return m ? m[1].trim() : null;
}

function scoreCorrect({
  screenText,
  encodingText,
  proofText,
  doneLine,
  diff,
  proofRun,
}) {
  const normalized = stripAnsi(screenText || '');
  const correctSkill =
    /\/correct\b/i.test(normalized) ||
    /\[skill\]\s*correct/i.test(normalized) ||
    /\bUsed correct\b/i.test(normalized) ||
    /\bLoaded correct\b/i.test(normalized) ||
    /\bskill:\s*correct\b/i.test(normalized) ||
    /Encode the mistake at the highest/i.test(normalized) ||
    /highest working level/i.test(normalized);
  const encoding = classifyEncodingLevel(diff, `${encodingText}\n${normalized}\n${proofText}`);
  const proofMentionsPast =
    /past-mistake-1/i.test(proofText || '') ||
    /past-mistake-1/i.test(encodingText || '') ||
    /past-mistake-1/i.test(normalized);
  const proofExitClaim =
    /exit[^0-9]*[1-9]\d*/i.test(proofText || '') ||
    /non-?zero/i.test(proofText || '') ||
    /failed/i.test(proofText || '');
  const proved =
    Boolean(proofRun?.failedAsExpected) ||
    (proofMentionsPast && proofExitClaim && Boolean(proofText?.trim()));
  const doneYes = /^correct=yes$/i.test(doneLine || '');
  const doneNo = /^correct=no$/i.test(doneLine || '');
  const doneFail = /^correct=fail$/i.test(doneLine || '');

  let outcome = 'neither';
  if (encoding.aboveDocs && proved) outcome = 'encoded_with_proof';
  else if (encoding.docsOnly && !encoding.aboveDocs) outcome = 'encoded_docs_only';
  else if (encoding.aboveDocs && !proved) outcome = 'encoded_no_proof';
  else if (correctSkill && !encoding.aboveDocs && !proved) outcome = 'skill_only';
  else if (doneNo || doneFail) outcome = 'neither';
  else if (correctSkill || encoding.level !== 'none') outcome = 'inconclusive';

  return {
    correctSkill,
    encodingLevel: encoding.level,
    aboveDocs: encoding.aboveDocs,
    docsOnly: encoding.docsOnly,
    proved,
    proofMentionsPast,
    proofExitClaim,
    proofRunFailed: Boolean(proofRun?.failedAsExpected),
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

async function readOptional(path) {
  if (!(await pathExists(path))) return { exists: false, path, text: null };
  const text = await readFile(path, 'utf8');
  return { exists: true, path, text };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'cmd-correct-encode',
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
  const backupPath = `${referenceRulePath}.correct-encode-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function restoreFixture() {
  await rm(fixtureApp, { force: true, recursive: true });
  await mkdir(fixtureApp, { recursive: true });
  await cp(baselineRoot, fixtureApp, { recursive: true });
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
      (/fixture-app|store-boundary|correct|medium|Skill conflicts|README|AGENTS/i.test(text) ||
        /db\.js|store/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'correct-fixture-app';
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
  if (best) return best.path;
  // Fallback: newest session under sessions tree mentioning store-boundary or fixture-app
  best = null;
  async function walkAll(dir) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) await walkAll(abs);
      else if (entry.isFile() && entry.name.endsWith('.jsonl') && /fixture-app|store-boundary|correct/i.test(abs)) {
        const st = await stat(abs).catch(() => null);
        if (!st) continue;
        if (!best || st.mtimeMs > best.ms) best = { path: abs, ms: st.mtimeMs };
      }
    }
  }
  await walkAll(sessionsRoot);
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
    if (/\bcorrect\b/i.test(blob) && /skill/i.test(blob)) skillInjected = true;
    if (/\bcorrect\b/i.test(blob) && /prompt/i.test(blob)) promptInjected = true;
    if (/highest working level/i.test(blob)) promptInjected = true;
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
    toolOrder: toolOrder.slice(0, 200),
    assistantJoined: assistantTexts.join('\n\n'),
    lastAssistant: assistantTexts[assistantTexts.length - 1] || '',
    assistantCount: assistantTexts.length,
  };
}

async function waitTurnSettled(attempt, side, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let calm = 0;
  while (Date.now() < deadline) {
    const lines = await screenLines(attempt, GEOMETRY);
    const text = lines.join('\n');
    const done = await readDone(side);
    const proof = await readOptional(proofPath(side));
    const working = observeWorking(text);
    const enough = done.exists || proof.exists;
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
  const backupPath = `${referenceRulePath}.correct-encode-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await rm(proofPath(side), { force: true });
  await rm(notePath(side), { force: true });
  await restoreFixture();
  if (side === 'pi') await ensurePiTrust();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const turn = correctPrompt(side);
  const beforeMap = await fileDigestMap(fixtureApp);
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

    attempt.input(Buffer.from(turn), 'literal_user');
    await sleep(600);
    await dumpScreen(attempt, dir, '01-typed', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '02-submitted', GEOMETRY);

    try {
      await waitEither(
        attempt,
        GEOMETRY,
        ['correct', 'architecture', 'lint', 'test', 'past-mistake', 'store.js', 'db.js', 'encode'],
        900_000,
      );
    } catch {
      // settle may still land artifacts
    }
    await dumpScreen(attempt, dir, '03-signal', GEOMETRY);

    await waitTurnSettled(attempt, side, SETTLE_MS);
    try {
      await waitSettled(attempt, GEOMETRY, 120_000);
    } catch {
      // best-effort
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '04-settled', GEOMETRY);

    const settledText = (await screenLines(attempt, GEOMETRY)).join('\n');
    const ptyText = stripAnsi(outputBytes(attempt.events()).toString('utf8'));
    const done = await readDone(side);
    const proof = await readOptional(proofPath(side));
    const note = await readOptional(notePath(side));
    const afterMap = await fileDigestMap(fixtureApp);
    const diff = diffMaps(beforeMap, afterMap);
    const proofCommand = extractProofCommand(proof.text || note.text || settledText);
    const proofRun = await runProofCandidate(fixtureApp, proofCommand);

    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      sessionSummary = await summarizePiSession(await findLatestPiSession());
    }

    const screenScore = scoreCorrect({
      screenText: settledText,
      encodingText: note.text || '',
      proofText: proof.text || '',
      doneLine: done.line,
      diff,
      proofRun,
    });
    const ptyScore = scoreCorrect({
      screenText: ptyText,
      encodingText: note.text || '',
      proofText: proof.text || '',
      doneLine: done.line,
      diff,
      proofRun,
    });
    const fileScore = scoreCorrect({
      screenText: `${note.text || ''}\n${proof.text || ''}`,
      encodingText: note.text || '',
      proofText: proof.text || '',
      doneLine: done.line,
      diff,
      proofRun,
    });
    const sessionScore = sessionSummary?.lastAssistant
      ? scoreCorrect({
          screenText: sessionSummary.lastAssistant,
          encodingText: note.text || sessionSummary.lastAssistant,
          proofText: proof.text || '',
          doneLine: done.line,
          diff,
          proofRun,
        })
      : null;

    const candidates = [fileScore, sessionScore, screenScore, ptyScore].filter(Boolean);
    const rank = (o) =>
      Number(o.outcome === 'encoded_with_proof') * 4 +
      Number(o.aboveDocs) * 2 +
      Number(o.proved);
    const bestScore = candidates.sort((a, b) => rank(b) - rank(a))[0] || screenScore;

    const skillActivated = Boolean(
      screenScore.correctSkill ||
        ptyScore.correctSkill ||
        sessionSummary?.skillInjected ||
        sessionSummary?.promptInjected ||
        /\/correct\b/i.test(turn),
    );

    // Snapshot fixture after state for the attempt
    const snapshotDir = join(dir, 'fixture-after');
    await rm(snapshotDir, { force: true, recursive: true });
    await cp(fixtureApp, snapshotDir, { recursive: true });

    const observations = {
      skillActivated,
      screenScore,
      ptyScore,
      sessionScore,
      fileScore,
      bestScore,
      outcome: bestScore.outcome,
      encodingLevel: bestScore.encodingLevel,
      aboveDocs: bestScore.aboveDocs,
      docsOnly: bestScore.docsOnly,
      provedFailOnPastMistake: bestScore.proved,
      fixtureDiff: diff,
      proofCommand,
      proofRun,
      done,
      proof: {
        exists: proof.exists,
        path: proof.path,
        digest: proof.exists ? createHash('sha256').update(proof.text).digest('hex') : null,
        preview: (proof.text || '').slice(0, 600),
      },
      encodingNote: {
        exists: note.exists,
        path: note.path,
        digest: note.exists ? createHash('sha256').update(note.text).digest('hex') : null,
        preview: (note.text || '').slice(0, 600),
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
    await writeFile(join(dir, 'prompt-correct.txt'), `${turn}\n`);
    if (proof.exists) await writeFile(join(dir, 'proof-after.txt'), proof.text);
    if (note.exists) await writeFile(join(dir, 'encoding-after.md'), note.text);

    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      ruleUnchanged: afterRule === ruleBytes,
      afterDigest: afterRuleDigest,
      fixtureDigest: ruleDigest,
      prompt: turn,
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

await restoreFixture();
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
    scenario: 'cmd-correct-encode',
    fixtureDigest: preDigest,
    results,
  }),
);
