#!/usr/bin/env node
// cmd-architect-ground-how pair: invoke /architect on a non-greenfield ticket-desk
// fixture and score whether how grounding precedes sketch. Real PTY both sides.
//
// Usage: node scripts/capture-architect-ground-how.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/architect/
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
const evidenceRoot = join(root, 'evidence', 'architect');
const fixtureApp = join(evidenceRoot, 'fixture-app');
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

function groundingPath(side) {
  return join(writeRootFor(side), 'grounding.md');
}

function sketchPath(side) {
  return join(writeRootFor(side), 'sketch.md');
}

function donePath(side) {
  return join(writeRootFor(side), 'done.txt');
}

function architectPrompt(side) {
  const grounding = groundingPath(side);
  const sketch = sketchPath(side);
  const done = donePath(side);
  return (
    `/architect design soft-delete for tickets across the existing store, api, and cli. ` +
    `Surrounding system already exists in src/store.js, src/api.js, and src/cli.js (not greenfield). ` +
    `Phase A must run how over those subsystems and produce a traced mental model before any sketch. ` +
    `Then produce a types/signatures sketch with not-implemented bodies. Do not implement product code. ` +
    `Work only inside this fixture cwd. Do not edit ledgers, parity/, or files outside this cwd ` +
    `except the named out paths. ` +
    `Write the how-traced grounding to ${grounding}, then write the sketch to ${sketch}, ` +
    `then write exactly one line to ${done} as grounded=yes|no sketch=yes|no order=how-before-sketch|other|unknown, then stop.`
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

export function scoreOrdering({ groundingText, sketchText, screenText, ptyText, sessionSummary }) {
  const blobs = [
    { name: 'grounding', text: groundingText || '' },
    { name: 'sketch', text: sketchText || '' },
    { name: 'screen', text: screenText || '' },
    { name: 'pty', text: ptyText || '' },
    { name: 'session', text: sessionSummary?.assistantJoined || '' },
  ];

  const howPatterns = [
    /\bPhase A\b/i,
    /\bhow explainer\b/i,
    /\bUsed how\b/i,
    /\[skill\]\s*how\b/i,
    /\/how\b/,
    /\bKey Concepts\b/,
    /\bHow It Works\b/,
    /\btraced mental model\b/i,
    /\bGround(?:ing| the problem)\b/i,
  ];
  const sketchPatterns = [
    /\bPhase B\b/i,
    /\bnot implemented\b/i,
    /\bdesign (?:package|sketch)\b/i,
    /\barena\b/i,
    /\bmodule (?:map|boundary)\b/i,
    /\bfunction signature/i,
    /\bSynthesis decision\b/i,
    /\btypes?(?:\/| and )signatures?\b/i,
  ];

  function firstIndex(text, patterns) {
    let best = -1;
    for (const re of patterns) {
      const m = text.search(re);
      if (m >= 0 && (best < 0 || m < best)) best = m;
    }
    return best;
  }

  const artifactOrder = (() => {
    const g = Boolean(groundingText && groundingText.trim());
    const s = Boolean(sketchText && sketchText.trim());
    if (!g && !s) return 'missing-both';
    if (g && !s) return 'grounding-only';
    if (!g && s) return 'sketch-without-grounding';
    // Both exist on disk; mtime ordering is checked by caller when available.
    return 'both-present';
  })();

  const combined = blobs.map((b) => b.text).join('\n\n---\n\n');
  const howIdx = firstIndex(combined, howPatterns);
  const sketchIdx = firstIndex(combined, sketchPatterns);
  const howInGrounding = howPatterns.some((re) => re.test(groundingText || ''));
  const sketchInSketch = sketchPatterns.some((re) => re.test(sketchText || '')) ||
    /\b(export )?(function|type|interface|class)\b/.test(sketchText || '') ||
    /```/.test(sketchText || '');

  const toolOrder = sessionSummary?.toolOrder || [];
  const toolNames = toolOrder.map((t) => String(t).toLowerCase());
  const howTaskIdx = toolNames.findIndex(
    (n) => n === 'task' || n.includes('how') || n === 'agent',
  );
  // Prefer read/explore before write of sketch paths when session lists tools.
  const firstWriteIdx = toolNames.findIndex((n) => n === 'write' || n === 'edit' || n === 'create_file');
  const sessionToolOrderOk =
    howTaskIdx >= 0 && firstWriteIdx >= 0 ? howTaskIdx < firstWriteIdx : null;

  let order = 'unknown';
  if (artifactOrder === 'sketch-without-grounding') order = 'sketch-first-or-only';
  else if (howIdx >= 0 && sketchIdx >= 0) order = howIdx < sketchIdx ? 'how-before-sketch' : 'sketch-before-how';
  else if (howIdx >= 0 && artifactOrder === 'grounding-only') order = 'how-before-sketch';
  else if (howInGrounding && sketchInSketch) order = 'how-before-sketch';
  else if (sessionToolOrderOk === true) order = 'how-before-sketch';
  else if (sessionToolOrderOk === false) order = 'sketch-before-how';

  const grounded = Boolean(
    howInGrounding ||
      howIdx >= 0 ||
      /Overview|Where Things Live|Gotchas/i.test(groundingText || ''),
  );
  const sketched = Boolean(sketchInSketch || artifactOrder === 'both-present' || artifactOrder === 'sketch-without-grounding');

  return {
    grounded,
    sketched,
    howInGrounding,
    sketchInSketch,
    artifactOrder,
    howIdx,
    sketchIdx,
    sessionToolOrderOk,
    toolOrder: toolNames.slice(0, 40),
    order,
    orderOk: order === 'how-before-sketch',
  };
}

function observeSignals(text) {
  const architectSkill =
    /\/architect\b/i.test(text) ||
    /\[skill\]\s*architect/i.test(text) ||
    /\bUsed architect\b/i.test(text);
  const howSkill =
    /\/how\b/i.test(text) ||
    /\[skill\]\s*how\b/i.test(text) ||
    /\bUsed how\b/i.test(text) ||
    /\bhow explainer\b/i.test(text);
  const working = /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text);
  return { architectSkill, howSkill, working };
}

async function readOptional(path) {
  if (!(await pathExists(path))) return { exists: false, path, text: null, mtimeMs: null };
  const text = await readFile(path, 'utf8');
  const st = await stat(path);
  return { exists: true, path, text, mtimeMs: st.mtimeMs };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'cmd-architect-ground-how',
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
  const backupPath = `${referenceRulePath}.architect-ground-how-backup`;
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

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'architect-fixture-app';
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
  const assistantTexts = [];
  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const blob = JSON.stringify(o);
    if (/\barchitect\b/i.test(blob) && /skill/i.test(blob)) skillInjected = true;
    if (/\bhow\b/i.test(blob) && /skill/i.test(blob)) skillInjected = skillInjected || true;
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
    toolOrder: toolOrder.slice(0, 120),
    assistantJoined: assistantTexts.join('\n\n'),
  };
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.architect-ground-how-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(groundingPath(side), { force: true });
  await rm(sketchPath(side), { force: true });
  await rm(donePath(side), { force: true });
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = architectPrompt(side);
  let attempt;
  try {
    await writeFile(rulePath, ruleBytes);
    if (side === 'pi') await ensurePiTrust();
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(ruleDigest) : piSpec(ruleDigest));
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitEither(attempt, GEOMETRY, ['ticket', 'README', 'pi', 'store'], 120_000);
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
        ['architect', 'how', 'Ground', 'Phase A', 'sketch', 'store.js', 'soft-delete'],
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
      const grounding = await readOptional(groundingPath(side));
      const sketch = await readOptional(sketchPath(side));
      const done = await readOptional(donePath(side));
      const enough = (grounding.exists && sketch.exists) || done.exists;
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
    const grounding = await readOptional(groundingPath(side));
    const sketch = await readOptional(sketchPath(side));
    const done = await readOptional(donePath(side));
    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      sessionSummary = await summarizePiSession(await findLatestPiSession());
    }

    const mtimeOrder =
      grounding.exists && sketch.exists
        ? grounding.mtimeMs <= sketch.mtimeMs
          ? 'grounding-mtime-before-sketch'
          : 'sketch-mtime-before-grounding'
        : null;

    const ordering = scoreOrdering({
      groundingText: grounding.text,
      sketchText: sketch.text,
      screenText: settledText,
      ptyText,
      sessionSummary,
    });

    // Prefer durable artifact mtime when both files exist.
    if (mtimeOrder === 'grounding-mtime-before-sketch' && ordering.grounded && ordering.sketched) {
      ordering.order = 'how-before-sketch';
      ordering.orderOk = true;
      ordering.mtimeOrder = mtimeOrder;
    } else if (mtimeOrder === 'sketch-mtime-before-grounding') {
      ordering.mtimeOrder = mtimeOrder;
      if (ordering.order === 'unknown') {
        ordering.order = 'sketch-before-how';
        ordering.orderOk = false;
      }
    } else {
      ordering.mtimeOrder = mtimeOrder;
    }

    const screenObs = observeSignals(settledText);
    const ptyObs = observeSignals(ptyText);
    const observations = {
      architectSkill: Boolean(screenObs.architectSkill || ptyObs.architectSkill || sessionSummary?.skillInjected),
      howSkill: Boolean(screenObs.howSkill || ptyObs.howSkill),
      grounding,
      sketch,
      done: done.exists
        ? { exists: true, path: done.path, line: (done.text || '').trim() }
        : { exists: false, path: done.path, line: null },
      ordering,
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
    if (grounding.exists) await writeFile(join(dir, 'grounding-copy.md'), grounding.text);
    if (sketch.exists) await writeFile(join(dir, 'sketch-copy.md'), sketch.text);

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

// Synthetic self-check when --self-test is passed.
if (only === '--self-test') {
  const pass = scoreOrdering({
    groundingText: '## Overview\n## Key Concepts\nstore owns ids\n## How It Works\n',
    sketchText: '```ts\nexport function softDelete(id: string): void { /* not implemented */ }\n```\n',
    screenText: 'Phase A grounding\nPhase B sketch',
    ptyText: '',
    sessionSummary: { toolOrder: ['read', 'task', 'write'], assistantJoined: '' },
  });
  const fail = scoreOrdering({
    groundingText: '',
    sketchText: 'export function softDelete() { /* not implemented */ }',
    screenText: 'Phase B sketch first',
    ptyText: '',
    sessionSummary: null,
  });
  console.log(JSON.stringify({ pass, fail }));
  if (!pass.orderOk || fail.orderOk) process.exit(1);
  process.exit(0);
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
    scenario: 'cmd-architect-ground-how',
    fixtureDigest: preDigest,
    results,
  }),
);
