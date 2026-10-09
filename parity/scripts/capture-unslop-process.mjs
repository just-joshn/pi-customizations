#!/usr/bin/env node
// Family 05 /unslop pair: invoke /unslop on a short draft packed with AI tells
// and observe whether a rewrite pass lands on disk.
// Real PTY both sides via the recorder.
//
// Usage: node scripts/capture-unslop-process.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/unslop/
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'unslop');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const DRAFT_REL = 'draft.md';
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;
const POLL_MS = 500;

const AI_TELL_PATTERNS = [
  { id: 'rule7-delve', re: /\bdelve\b/i },
  { id: 'rule7-crucial', re: /\bcrucial\b/i },
  { id: 'rule7-vibrant', re: /\bvibrant\b/i },
  { id: 'rule7-landscape', re: /\blandscape\b/i },
  { id: 'rule7-pivotal', re: /\bpivotal\b/i },
  { id: 'rule7-intricate', re: /\bintricate\b/i },
  { id: 'rule7-fostering', re: /\bfostering\b/i },
  { id: 'rule7-enduring', re: /\benduring\b/i },
  { id: 'rule7-tapestry', re: /\btapestry\b/i },
  { id: 'rule7-testament', re: /\btestament\b/i },
  { id: 'rule7-underscore', re: /\bunderscore[sd]?\b/i },
  { id: 'rule7-showcase', re: /\bshowcas(e|ing)\b/i },
  { id: 'rule7-additionally', re: /\badditionally\b/i },
  { id: 'rule7-enhance', re: /\benhance[sd]?\b/i },
  { id: 'rule7-interplay', re: /\binterplay\b/i },
  { id: 'rule8-serves-as', re: /\bserves as\b/i },
  { id: 'rule8-boasts', re: /\bboasts\b/i },
  { id: 'rule9-not-just', re: /\bnot just\b[\s\S]{0,40}\bbut\b/i },
  { id: 'rule13-emdash', re: /\u2014/ },
  { id: 'rule20-hope-helps', re: /\bI hope this helps\b/i },
  { id: 'rule20-let-me-know', re: /\bLet me know if\b/i },
  { id: 'rule20-of-course', re: /\bOf course\b/i },
  { id: 'rule22-absolutely-right', re: /\babsolutely right\b/i },
  { id: 'rule23-in-order-to', re: /\bIn order to\b/i },
  { id: 'rule23-important-to-note', re: /\bIt is important to note that\b/i },
  { id: 'rule24-hedge-stack', re: /\bcould potentially possibly\b/i },
  { id: 'rule5-experts-believe', re: /\bexperts believe\b/i },
  { id: 'rule16-perf-colon', re: /\*\*Performance:\*\*/ },
  { id: 'rule16-clarity-colon', re: /\*\*Clarity:\*\*/ },
  { id: 'rule31-utilize', re: /\butilize\b/i },
  { id: 'rule31-leveraging', re: /\bleverag(e|ing)\b/i },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeRootFor(side) {
  return join(evidenceRoot, 'fixture-out', side);
}

function donePath(side) {
  return join(writeRootFor(side), 'done.txt');
}

function unslopPrompt(side) {
  const out = donePath(side);
  return (
    `/unslop rewrite draft.md in place to cut AI tells. ` +
    `Scan for the listed unslop patterns and rewrite the prose. ` +
    `Preserve meaning and intended tone. Keep it a short notes-helper README. ` +
    `Work only inside this fixture cwd. Do not edit ledgers, parity/, or files outside this cwd. ` +
    `When finished, write exactly one line to ${out} naming draft.md and that unslop rewrite applied, then stop.`
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

async function walkFiles(dir, base = dir) {
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
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      out.push(...(await walkFiles(abs, base)));
    } else if (entry.isFile()) {
      out.push(relative(base, abs));
    }
  }
  return out;
}

async function fileDigest(path) {
  const body = await readFile(path);
  return createHash('sha256').update(body).digest('hex');
}

function scanTells(text) {
  const hits = [];
  for (const p of AI_TELL_PATTERNS) {
    if (p.re.test(text)) hits.push(p.id);
  }
  return hits;
}

async function restoreFixture() {
  const baselineDir = join(evidenceRoot, 'fixture-baseline');
  for (const rel of [DRAFT_REL, 'package.json']) {
    const src = join(baselineDir, rel);
    const dst = join(fixtureApp, rel);
    if (await pathExists(src)) {
      await mkdir(dirname(dst), { recursive: true });
      await writeFile(dst, await readFile(src));
    }
  }
  const files = await walkFiles(fixtureApp);
  for (const rel of files) {
    if (rel === DRAFT_REL || rel === 'package.json') continue;
    if (rel.endsWith('.tsv') || rel.startsWith('out/') || rel.startsWith('.audit/')) {
      await rm(join(fixtureApp, rel), { force: true, recursive: true });
    }
  }
  await rm(join(fixtureApp, '.audit'), { recursive: true, force: true });
  await rm(join(fixtureApp, 'out'), { recursive: true, force: true });
}

async function snapshotBaseline() {
  const baselineDir = join(evidenceRoot, 'fixture-baseline');
  for (const rel of [DRAFT_REL, 'package.json']) {
    const dst = join(baselineDir, rel);
    await mkdir(dirname(dst), { recursive: true });
    await writeFile(dst, await readFile(join(fixtureApp, rel)));
  }
}

async function pollOnce(draftBaseline) {
  const now = new Date().toISOString();
  const abs = join(fixtureApp, DRAFT_REL);
  const dig = await fileDigest(abs);
  return { now, changed: dig !== draftBaseline, digest: dig };
}

function classifyOutcome({ skill, rewritten, tellDelta, firstRewriteAt }) {
  if (skill && rewritten && tellDelta > 0) return 'rewrite_applied';
  if (skill && rewritten && tellDelta <= 0) return 'rewrite_no_tell_drop';
  if (skill && !rewritten) return 'skill_only';
  if (!skill && rewritten && tellDelta > 0) return 'rewrite_without_skill_signal';
  if (firstRewriteAt || rewritten) return 'inconclusive';
  return 'neither';
}

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line };
}

function observeScreen(lines) {
  const text = lines.join('\n');
  return {
    unslopSkill:
      /\/unslop\b/i.test(text) ||
      /\[skill\]\s*unslop/i.test(text) ||
      /\bUsed unslop\b/i.test(text) ||
      /\bunslop\b/i.test(text),
    patternScanMention: /\b(scan|pattern|AI[- ]tell|rewrite)\b/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'cmd-unslop-process',
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
  const backupPath = `${referenceRulePath}.unslop-process-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.unslop-process-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await snapshotBaseline();
  await restoreFixture();
  const draftAbs = join(fixtureApp, DRAFT_REL);
  const beforeText = await readFile(draftAbs, 'utf8');
  const draftBaseline = await fileDigest(draftAbs);
  const beforeTells = scanTells(beforeText);
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = unslopPrompt(side);
  const pollLog = [];
  let firstRewriteAt = null;
  let afterDigest = draftBaseline;
  let attempt;
  try {
    await writeFile(rulePath, ruleBytes);
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(ruleDigest) : piSpec(ruleDigest));
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitEither(attempt, GEOMETRY, ['draft', 'notes', 'pi', 'README'], 120_000);
    }
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);

    const stopPoll = new AbortController();
    const pollLoop = (async () => {
      while (!stopPoll.signal.aborted) {
        const snap = await pollOnce(draftBaseline);
        if (snap.changed) {
          afterDigest = snap.digest;
          if (!firstRewriteAt) firstRewriteAt = snap.now;
          pollLog.push({ ts: snap.now, digest: snap.digest });
        }
        await sleep(POLL_MS);
      }
    })();

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
        ['unslop', 'rewrite', 'draft.md', 'AI tell', 'pattern'],
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
      const obs = observeScreen(lines);
      const done = await readDone(side);
      const snap = await pollOnce(draftBaseline);
      if (snap.changed) {
        afterDigest = snap.digest;
        if (!firstRewriteAt) firstRewriteAt = snap.now;
      }
      if ((done.exists || snap.changed) && !obs.working) {
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

    stopPoll.abort();
    await pollLoop.catch(() => {});

    const finalSnap = await pollOnce(draftBaseline);
    if (finalSnap.changed) {
      afterDigest = finalSnap.digest;
      if (!firstRewriteAt) firstRewriteAt = finalSnap.now;
    }

    const afterText = await readFile(draftAbs, 'utf8');
    const afterTells = scanTells(afterText);
    const rewritten = afterDigest !== draftBaseline;
    const tellDelta = beforeTells.length - afterTells.length;
    const screenFinal = observeScreen(await screenLines(attempt, GEOMETRY));
    const outcome = classifyOutcome({
      skill: screenFinal.unslopSkill,
      rewritten,
      tellDelta,
      firstRewriteAt,
    });
    const observations = {
      screenFinal,
      firstRewriteAt,
      beforeDigest: draftBaseline,
      afterDigest,
      rewritten,
      beforeTellCount: beforeTells.length,
      afterTellCount: afterTells.length,
      tellDelta,
      beforeTells,
      afterTells,
      remainingTells: afterTells,
      outcome,
      unslopProcessApplied: outcome === 'rewrite_applied' || outcome === 'rewrite_without_skill_signal',
      unslopSkill: screenFinal.unslopSkill,
      done: await readDone(side),
      pollSamples: pollLog.length,
    };

    const afterRule = await readFile(rulePath, 'utf8');
    const afterRuleDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), afterRule);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
    await writeFile(join(dir, 'poll-log.json'), `${JSON.stringify(pollLog, null, 2)}\n`);
    await writeFile(join(dir, 'draft-before.md'), beforeText);
    await writeFile(join(dir, 'draft-after.md'), afterText);
    await writeFile(
      join(dir, 'baseline-draft.json'),
      `${JSON.stringify({ digest: draftBaseline, tellCount: beforeTells.length, tells: beforeTells }, null, 2)}\n`,
    );

    const snapDir = join(attempt.dir, 'fixture-snapshot');
    await mkdir(snapDir, { recursive: true });
    for (const rel of [DRAFT_REL, 'package.json']) {
      const abs = join(fixtureApp, rel);
      if (await pathExists(abs)) {
        await mkdir(dirname(join(snapDir, rel)), { recursive: true });
        await writeFile(join(snapDir, rel), await readFile(abs));
      }
    }

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

await snapshotBaseline();
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
    scenario: 'cmd-unslop-process',
    fixtureDigest: preDigest,
    results,
  }),
);
