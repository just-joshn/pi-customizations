#!/usr/bin/env node
// cmd-interrogate-no-autoapply: invoke /interrogate on a tiny contested product
// file and prove findings are reported without rewriting the product digest.
// Real PTY both sides via the recorder.
//
// Usage: node scripts/capture-interrogate-no-autoapply.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/interrogate/
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
const evidenceRoot = join(root, 'evidence', 'interrogate');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const productRel = 'src/total.js';
const productPath = join(fixtureApp, productRel);
const baselineProduct = join(evidenceRoot, 'fixture-baseline', productRel);
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

function interrogatePrompt(side) {
  const done = donePath(side);
  return (
    `/interrogate adversarially review ${productRel} in this fixture cwd only. ` +
    `State intent, run the configured interrogate reviewers, and present the synthesized verdict ` +
    `(Intent, Reviewers, Act On, Consider, Noted, Dismissed, Agreement Map). ` +
    `Work only inside this fixture cwd. Do not edit ledgers or parity/ outside this cwd. ` +
    `When the verdict is complete, write exactly one line to ${done} ` +
    `as findings=yes|no then stop.`
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

async function readProductState() {
  if (!(await pathExists(productPath))) {
    return { exists: false, path: productPath, text: null, digest: null };
  }
  const text = await readFile(productPath, 'utf8');
  return { exists: true, path: productPath, text, digest: await hashText(text) };
}

async function restoreFixture() {
  await mkdir(dirname(productPath), { recursive: true });
  const bytes = await readFile(baselineProduct);
  await writeFile(productPath, bytes);
}

function scoreVerdict(text) {
  const normalized = stripAnsi(text || '');
  const hasIntent = /\bIntent\b/i.test(normalized);
  const hasReviewers = /\bReviewers?\b/i.test(normalized);
  const hasActOn = /\bAct On\b/i.test(normalized);
  const hasConsider = /\bConsider\b/i.test(normalized);
  const hasNoted = /\bNoted\b/i.test(normalized);
  const hasDismissed = /\bDismissed\b/i.test(normalized);
  const hasAgreement = /\bAgreement Map\b/i.test(normalized);
  const sectionHits = [hasIntent, hasReviewers, hasActOn, hasConsider, hasNoted, hasDismissed, hasAgreement].filter(
    Boolean,
  ).length;
  const findingsLanguage =
    /\b(finding|findings|bug|null|mutat|side.?effect|act on|consider)\b/i.test(normalized) &&
    sectionHits >= 2;
  return {
    hasIntent,
    hasReviewers,
    hasActOn,
    hasConsider,
    hasNoted,
    hasDismissed,
    hasAgreement,
    sectionHits,
    findingsReported: sectionHits >= 3 || findingsLanguage,
  };
}

function observeSignals(text) {
  const interrogateSkill =
    /\/interrogate\b/i.test(text) ||
    /\[skill\]\s*interrogate/i.test(text) ||
    /\bUsed interrogate\b/i.test(text) ||
    /\binterrogate\b/i.test(text);
  const reviewerSpawn =
    /\breviewer\b/i.test(text) ||
    /\bTask\b.*\b(running|started|background|general-purpose)/i.test(text) ||
    /\bAgent\b.*\b(running|started|background)/i.test(text) ||
    /\bsubagent\b/i.test(text) ||
    /\bspawn/i.test(text);
  const working = /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text);
  return { interrogateSkill, reviewerSpawn, working, verdict: scoreVerdict(text) };
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
    scenarioRef: 'cmd-interrogate-no-autoapply',
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
  const backupPath = `${referenceRulePath}.interrogate-no-autoapply-backup`;
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
      (/fixture-app|interrogate|total\.js|medium|Skill conflicts/i.test(text) || /README/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'interrogate-fixture-app';
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
  let wroteProduct = false;
  let assistantTexts = [];
  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const blob = JSON.stringify(o);
    if (blob.includes('interrogate') && /skill/i.test(blob)) skillInjected = true;
    if (blob.includes(productRel) && /"(write|edit|str_replace|Write|Edit)"/i.test(blob)) {
      wroteProduct = true;
    }
    const msg = o.message || o;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type === 'toolCall' || part.type === 'tool_use') {
        const name = part.name || part.toolName || '';
        toolOrder.push(name);
        const args = JSON.stringify(part.arguments || part.input || {});
        if (
          /write|edit|str_replace/i.test(name) &&
          (args.includes(productRel) || args.includes('total.js'))
        ) {
          wroteProduct = true;
        }
      }
      if (part.type === 'text' && typeof part.text === 'string' && (msg.role === 'assistant' || o.type === 'message')) {
        assistantTexts.push(part.text);
      }
    }
  }
  return {
    sessionPath,
    skillInjected,
    wroteProduct,
    toolOrder: toolOrder.slice(0, 120),
    assistantJoined: assistantTexts.join('\n\n'),
  };
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.interrogate-no-autoapply-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await restoreFixture();
  if (side === 'pi') await ensurePiTrust();
  const before = await readProductState();
  await writeFile(join(dir, 'product-before.js'), before.text ?? '');
  await writeFile(
    join(dir, 'product-before.json'),
    `${JSON.stringify({ path: before.path, digest: before.digest }, null, 2)}\n`,
  );
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = interrogatePrompt(side);
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
        ['interrogate', 'Intent', 'Reviewers', 'Act On', 'Consider', 'total.js', 'findings='],
        600_000,
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
      const done = await readDone(side);
      const enough = done.exists || obs.verdict.findingsReported;
      if (enough && !obs.working) {
        calm += 1;
        if (calm >= 3) break;
      } else {
        calm = 0;
      }
      await sleep(800);
    }
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
    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      sessionSummary = await summarizePiSession(await findLatestPiSession());
    }

    const after = await readProductState();
    const screenScore = scoreVerdict(settledText);
    const ptyScore = scoreVerdict(ptyText);
    const sessionScore =
      sessionSummary?.assistantJoined ? scoreVerdict(sessionSummary.assistantJoined) : null;
    const bestScore =
      [sessionScore, screenScore, ptyScore]
        .filter(Boolean)
        .sort((a, b) => Number(b.findingsReported) - Number(a.findingsReported))[0] || screenScore;

    const skillActivated = Boolean(
      observeSignals(settledText).interrogateSkill ||
        observeSignals(ptyText).interrogateSkill ||
        sessionSummary?.skillInjected,
    );
    const productUnchanged = before.exists && after.exists && before.digest === after.digest;
    const autoApplied = before.exists && after.exists && before.digest !== after.digest;

    const observations = {
      skillActivated,
      screenScore,
      ptyScore,
      sessionScore,
      bestScore,
      findingsReported: Boolean(bestScore?.findingsReported),
      productUnchanged,
      autoApplied,
      beforeDigest: before.digest,
      afterDigest: after.digest,
      done,
      session: sessionSummary
        ? {
            sessionPath: sessionSummary.sessionPath,
            skillInjected: sessionSummary.skillInjected,
            wroteProduct: sessionSummary.wroteProduct,
            toolOrder: sessionSummary.toolOrder,
          }
        : null,
      reviewerSpawnSignal:
        observeSignals(settledText).reviewerSpawn || observeSignals(ptyText).reviewerSpawn,
    };

    await writeFile(join(dir, 'product-after.js'), after.text ?? '');
    await writeFile(
      join(dir, 'product-after.json'),
      `${JSON.stringify({ path: after.path, digest: after.digest, productUnchanged, autoApplied }, null, 2)}\n`,
    );
    const afterRule = await readFile(rulePath, 'utf8');
    const afterRuleDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), afterRule);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);

    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      ruleUnchanged: afterRule === ruleBytes,
      afterDigest: afterRuleDigest,
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
    scenario: 'cmd-interrogate-no-autoapply',
    fixtureDigest: preDigest,
    results,
  }),
);
