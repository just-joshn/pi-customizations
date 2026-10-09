#!/usr/bin/env node
// Family 13 /automate-me existing-skill pair: invoke /automate-me update on a
// seeded parity-fixture-mode skill and observe in-place refresh (no parallel
// *-mode skill). Real PTY both sides via the recorder.
//
// Usage: node scripts/capture-automate-me-existing-skill.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/automate-me/
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
const evidenceRoot = join(root, 'evidence', 'automate-me');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;
const POLL_MS = 500;
const HANDLE = 'parity-fixture-mode';
const SEED_MARKER = 'PARITY-FIXTURE-MODE-SEED';
const REFRESH_NEEDLE = 'Prefer one short paragraph';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function skillRel(side) {
  return side === 'cursor'
    ? join('.cursor', 'skills', HANDLE, 'SKILL.md')
    : join('.pi', 'skills', HANDLE, 'SKILL.md');
}

function skillAbs(side) {
  return join(fixtureApp, skillRel(side));
}

function writeRootFor(side) {
  return join(evidenceRoot, 'fixture-out', side);
}

function donePath(side) {
  return join(writeRootFor(side), 'done.txt');
}

function amPrompt(side) {
  const rel = skillRel(side);
  const abs = skillAbs(side);
  const out = donePath(side);
  return (
    `/automate-me update my existing ${HANDLE} skill at ${rel}. ` +
    `I already chose update, not start fresh. Skip AskQuestion and any update-versus-fresh confirm. ` +
    `Skip transcript mining and skip further interview questions. ` +
    `Edit ${rel} in place only. Preserve the ${SEED_MARKER} marker. ` +
    `Under ## Response style add exactly this bullet: "- ${REFRESH_NEEDLE}." ` +
    `Do not create any other *-mode skill. Do not invent a parallel skill path. ` +
    `Work only inside this fixture cwd for skill files. Do not edit ledgers or parity ledgers. ` +
    `When finished, write exactly one line to ${out}: UPDATED=${abs} then stop.`
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

function isModeSkillPath(rel) {
  return /(^|\/)[^/]+-mode\/SKILL\.md$/i.test(rel);
}

async function modeSkillCensus() {
  const files = await walkFiles(fixtureApp);
  return files.filter(isModeSkillPath).sort();
}

async function readSkillState(side) {
  const path = skillAbs(side);
  if (!(await pathExists(path))) {
    return { exists: false, path, digest: null, text: null, hasSeed: false, hasRefresh: false };
  }
  const text = await readFile(path, 'utf8');
  return {
    exists: true,
    path,
    digest: createHash('sha256').update(text).digest('hex'),
    text,
    hasSeed: text.includes(SEED_MARKER),
    hasRefresh: text.includes(REFRESH_NEEDLE),
  };
}

const SEED_BODY = `---
name: parity-fixture-mode
description: "Use for parity-fixture-mode or /parity-fixture-mode when working in the fixture owner's style."
disable-model-invocation: true
---

# Parity fixture mode

PARITY-FIXTURE-MODE-SEED

## Response style

- Keep examples tiny.
`;

async function restoreFixture() {
  const baselineDir = join(evidenceRoot, 'fixture-baseline');
  await mkdir(join(fixtureApp, '.cursor', 'skills', HANDLE), { recursive: true });
  await mkdir(join(fixtureApp, '.pi', 'skills', HANDLE), { recursive: true });
  const readmeSrc = join(baselineDir, 'README.md');
  if (await pathExists(readmeSrc)) {
    await writeFile(join(fixtureApp, 'README.md'), await readFile(readmeSrc));
  }
  for (const side of ['cursor', 'pi']) {
    const rel = skillRel(side);
    const src = join(baselineDir, rel);
    const dst = join(fixtureApp, rel);
    await mkdir(dirname(dst), { recursive: true });
    if (await pathExists(src)) {
      await writeFile(dst, await readFile(src));
    } else {
      await writeFile(dst, SEED_BODY);
    }
  }
  const files = await walkFiles(fixtureApp);
  for (const rel of files) {
    if (rel === 'README.md') continue;
    if (rel === skillRel('cursor') || rel === skillRel('pi')) continue;
    if (isModeSkillPath(rel) || rel.endsWith('.tsv') || rel.startsWith('out/') || rel.startsWith('.audit/')) {
      await rm(join(fixtureApp, rel), { force: true, recursive: true });
    }
  }
  // remove empty parallel mode dirs left behind
  for (const hostRoot of [join(fixtureApp, '.cursor', 'skills'), join(fixtureApp, '.pi', 'skills')]) {
    let entries = [];
    try {
      entries = await readdir(hostRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === HANDLE) continue;
      await rm(join(hostRoot, entry.name), { recursive: true, force: true });
    }
  }
  await rm(join(fixtureApp, '.audit'), { recursive: true, force: true });
  await rm(join(fixtureApp, 'out'), { recursive: true, force: true });
}

async function snapshotBaseline() {
  const baselineDir = join(evidenceRoot, 'fixture-baseline');
  await mkdir(baselineDir, { recursive: true });
  await writeFile(join(baselineDir, 'README.md'), await readFile(join(fixtureApp, 'README.md')));
  for (const side of ['cursor', 'pi']) {
    const rel = skillRel(side);
    const dst = join(baselineDir, rel);
    await mkdir(dirname(dst), { recursive: true });
    const src = join(fixtureApp, rel);
    if (await pathExists(src)) {
      await writeFile(dst, await readFile(src));
    } else {
      await writeFile(dst, SEED_BODY);
      await writeFile(src, SEED_BODY);
    }
  }
}

async function pollOnce(beforeDigest, side) {
  const now = new Date().toISOString();
  const modes = await modeSkillCensus();
  const expected = skillRel(side);
  const state = await readSkillState(side);
  const parallel = modes.filter((p) => p !== expected && p !== skillRel(side === 'cursor' ? 'pi' : 'cursor'));
  const changed = state.exists && state.digest !== beforeDigest;
  return { now, modes, expected, parallel, changed, state };
}

function classifyOutcome({ before, after, parallel, skillSignal }) {
  if (!after.exists) return 'missing_seed';
  if (parallel.length) return 'parallel_skill_created';
  if (after.exists && after.digest !== before.digest && after.hasSeed && after.hasRefresh) {
    return 'refreshed_in_place';
  }
  if (after.exists && after.digest !== before.digest && after.hasSeed) return 'updated_without_refresh_needle';
  if (after.exists && after.digest === before.digest) return 'unchanged';
  if (skillSignal && after.exists) return 'inconclusive';
  return 'inconclusive';
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
    automateMeSkill:
      /\/automate-me\b/i.test(text) ||
      /\[skill\]\s*automate-me/i.test(text) ||
      /\bUsed automate-me\b/i.test(text) ||
      /\bautomate[- ]me\b/i.test(text),
    existingSkillMention:
      /parity-fixture-mode|existing skill|update (the )?existing|in place|SKILL\.md/i.test(text),
    parallelMention: /start fresh|new skill|create a new/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'cmd-automate-me-existing-skill',
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
  const backupPath = `${referenceRulePath}.automate-me-existing-backup`;
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
      (/fixture-app|Skill conflicts|parity-fixture|medium/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.automate-me-existing-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await snapshotBaseline();
  await restoreFixture();
  if (side === 'pi') await ensurePiTrust();
  const before = await readSkillState(side);
  await writeFile(join(dir, 'skill-before.md'), before.text ?? '');
  await writeFile(
    join(dir, 'skill-before.json'),
    `${JSON.stringify({ path: before.path, digest: before.digest, hasSeed: before.hasSeed }, null, 2)}\n`,
  );
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = amPrompt(side);
  const pollLog = [];
  let firstChangeAt = null;
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

    const stopPoll = new AbortController();
    const pollLoop = (async () => {
      while (!stopPoll.signal.aborted) {
        const snap = await pollOnce(before.digest, side);
        if (snap.changed || snap.parallel.length) {
          if (snap.changed && !firstChangeAt) firstChangeAt = snap.now;
          pollLog.push({
            ts: snap.now,
            changed: snap.changed,
            digest: snap.state.digest,
            parallel: snap.parallel,
            modes: snap.modes,
          });
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
        ['automate-me', 'parity-fixture-mode', 'Response style', 'SKILL.md', 'UPDATED='],
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
      const afterProbe = await readSkillState(side);
      const changed = afterProbe.exists && afterProbe.digest !== before.digest;
      if ((done.exists || (changed && afterProbe.hasRefresh)) && !obs.working) {
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

    const after = await readSkillState(side);
    const modes = await modeSkillCensus();
    const expected = skillRel(side);
    const otherHost = skillRel(side === 'cursor' ? 'pi' : 'cursor');
    const parallel = modes.filter((p) => p !== expected && p !== otherHost);
    const screenFinal = observeScreen(await screenLines(attempt, GEOMETRY));
    const outcome = classifyOutcome({
      before,
      after,
      parallel,
      skillSignal: screenFinal.automateMeSkill,
    });
    const observations = {
      screenFinal,
      firstChangeAt,
      before: {
        path: before.path,
        rel: expected,
        digest: before.digest,
        hasSeed: before.hasSeed,
        hasRefresh: before.hasRefresh,
      },
      after: {
        path: after.path,
        rel: expected,
        digest: after.digest,
        hasSeed: after.hasSeed,
        hasRefresh: after.hasRefresh,
      },
      modeSkills: modes,
      parallelModeSkills: parallel,
      existingPathReused: after.exists && parallel.length === 0 && after.hasSeed,
      updatedInPlace: outcome === 'refreshed_in_place',
      outcome,
      automateMeSkill: screenFinal.automateMeSkill,
      done: await readDone(side),
      pollSamples: pollLog.length,
    };

    await writeFile(join(dir, 'skill-after.md'), after.text ?? '');
    await writeFile(
      join(dir, 'skill-after.json'),
      `${JSON.stringify({ path: after.path, digest: after.digest, hasSeed: after.hasSeed, hasRefresh: after.hasRefresh }, null, 2)}\n`,
    );

    const afterRule = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), afterRule);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
    await writeFile(join(dir, 'poll-log.json'), `${JSON.stringify(pollLog, null, 2)}\n`);

    const snapDir = join(attempt.dir, 'fixture-snapshot');
    await mkdir(snapDir, { recursive: true });
    for (const rel of ['README.md', expected, ...parallel]) {
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
    scenario: 'cmd-automate-me-existing-skill',
    fixtureDigest: preDigest,
    results,
  }),
);
