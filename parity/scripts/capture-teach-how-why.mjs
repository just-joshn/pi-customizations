#!/usr/bin/env node
// cmd-teach-how-why: invoke /teach on a tiny clamp module and score whether
// how/why skill work precedes the woven teach explanation. Real PTY both sides.
//
// Usage: node scripts/capture-teach-how-why.mjs [--cursor-only|--pi-only|--both|--self-test]
// Evidence root: parity/evidence/teach/
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
const evidenceRoot = join(root, 'evidence', 'teach');
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

function howPath(side) {
  return join(writeRootFor(side), 'how.md');
}

function whyPath(side) {
  return join(writeRootFor(side), 'why.md');
}

function teachPath(side) {
  return join(writeRootFor(side), 'teach.md');
}

function donePath(side) {
  return join(writeRootFor(side), 'done.txt');
}

function teachPrompt(side) {
  const how = howPath(side);
  const why = whyPath(side);
  const teach = teachPath(side);
  const done = donePath(side);
  return (
    `/teach me how src/clamp.js works and why bound checks live in this helper rather than at every call site. ` +
    `Orient on the file, then run how and why as real skill invocations (in parallel when both are needed). ` +
    `Blend their findings into one plain explanation. Do not edit product code, ledgers, parity/, or paths outside this cwd ` +
    `except the named out paths. ` +
    `After how has run, write its findings to ${how}. After why has run, write its findings to ${why}. ` +
    `Only after those grounding writes, write the woven teach explanation to ${teach}. ` +
    `Then write exactly one line to ${done} as teach=yes|no how=yes|no why=yes|no order=how-why-before-teach|other|unknown, then stop.`
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

export function scoreTeachOrdering({ howText, whyText, teachText, screenText, ptyText, sessionSummary }) {
  const howPatterns = [
    /\bUsed how\b/i,
    /\[skill\]\s*how\b/i,
    /\/how\b/,
    /\bhow explainer\b/i,
    /\bKey Concepts\b/,
    /\bHow It Works\b/,
    /\btraced mental model\b/i,
    /\bPhase A\b/i,
  ];
  const whyPatterns = [
    /\bUsed why\b/i,
    /\[skill\]\s*why\b/i,
    /\/why\b/,
    /\bSources Consulted\b/,
    /\bConfidence Summary\b/,
    /\bwhat forces\b/i,
    /\bmotivation\b/i,
  ];
  const teachPatterns = [
    /\bUsed teach\b/i,
    /\[skill\]\s*teach\b/i,
    /\/teach\b/,
    /\bplain explanation\b/i,
    /\bwoven\b/i,
  ];

  function firstIndex(text, patterns) {
    let best = -1;
    for (const re of patterns) {
      const m = text.search(re);
      if (m >= 0 && (best < 0 || m < best)) best = m;
    }
    return best;
  }

  const howPresent = Boolean(howText && howText.trim());
  const whyPresent = Boolean(whyText && whyText.trim());
  const teachPresent = Boolean(teachText && teachText.trim());
  const groundingPresent = howPresent || whyPresent;

  const howInHow = howPatterns.some((re) => re.test(howText || '')) ||
    /\bclamp\b/i.test(howText || '') ||
    /\bbound/i.test(howText || '');
  const whyInWhy = whyPatterns.some((re) => re.test(whyText || '')) ||
    /\bcall site/i.test(whyText || '') ||
    /\bhelper\b/i.test(whyText || '') ||
    /\brepeat/i.test(whyText || '');
  const teachLooksLikeTeach =
    teachPresent &&
    (/\bclamp\b/i.test(teachText || '') ||
      /\bbound/i.test(teachText || '') ||
      teachPatterns.some((re) => re.test(teachText || '')));

  const combined = [howText || '', whyText || '', teachText || '', screenText || '', ptyText || '', sessionSummary?.assistantJoined || '']
    .join('\n\n---\n\n');
  const howIdx = firstIndex(combined, howPatterns);
  const whyIdx = firstIndex(combined, whyPatterns);
  const teachIdx = firstIndex(combined, [...teachPatterns, /\bclamp returns\b/i]);

  const toolOrder = sessionSummary?.toolOrder || [];
  const toolNames = toolOrder.map((t) => String(t).toLowerCase());
  const skillReadIdx = toolNames.findIndex(
    (n) => n.includes('how/skill') || n.includes('why/skill') || n === 'task' || n.includes('how') || n.includes('why'),
  );
  const teachWriteIdx = toolNames.findIndex((n) => n === 'write' || n === 'edit' || n === 'create_file' || n === 'bash');
  const sessionToolOrderOk =
    skillReadIdx >= 0 && teachWriteIdx >= 0 ? skillReadIdx <= teachWriteIdx : null;

  let order = 'unknown';
  if (!groundingPresent && teachPresent) order = 'teach-without-grounding';
  else if (groundingPresent && !teachPresent) order = 'grounding-only';
  else if (howIdx >= 0 && teachIdx >= 0) {
    const groundIdx = whyIdx >= 0 ? Math.min(howIdx, whyIdx) : howIdx;
    order = groundIdx < teachIdx ? 'how-why-before-teach' : 'teach-before-how-why';
  } else if ((howInHow || whyInWhy) && teachLooksLikeTeach) order = 'how-why-before-teach';
  else if (sessionToolOrderOk === true) order = 'how-why-before-teach';
  else if (sessionToolOrderOk === false) order = 'teach-before-how-why';

  return {
    howPresent,
    whyPresent,
    teachPresent,
    groundingPresent,
    howInHow,
    whyInWhy,
    teachLooksLikeTeach,
    howIdx,
    whyIdx,
    teachIdx,
    sessionToolOrderOk,
    toolOrder: toolNames.slice(0, 40),
    order,
    orderOk: order === 'how-why-before-teach',
    howOrWhyInvoked: Boolean(howPresent || whyPresent || howIdx >= 0 || whyIdx >= 0 || sessionSummary?.howSkill || sessionSummary?.whySkill),
  };
}

function observeSignals(text) {
  const teachSkill =
    /\/teach\b/i.test(text) ||
    /\[skill\]\s*teach/i.test(text) ||
    /\bUsed teach\b/i.test(text) ||
    /\bLoaded teach\b/i.test(text);
  const howSkill =
    /\/how\b/i.test(text) ||
    /\[skill\]\s*how\b/i.test(text) ||
    /\bUsed how\b/i.test(text) ||
    /\bhow explainer\b/i.test(text);
  const whySkill =
    /\/why\b/i.test(text) ||
    /\[skill\]\s*why\b/i.test(text) ||
    /\bUsed why\b/i.test(text) ||
    /\bSources Consulted\b/.test(text);
  const working = /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text);
  const spawnSignal =
    /\bTask\b/i.test(text) ||
    /\bAgent\b/i.test(text) ||
    /\bsubagent\b/i.test(text) ||
    /\bRunning\b.*\b(subagent|agent|task)\b/i.test(text);
  return { teachSkill, howSkill, whySkill, working, spawnSignal };
}

async function readOptional(path) {
  if (!(await pathExists(path))) return { exists: false, path, text: null, mtimeMs: null };
  const text = await readFile(path, 'utf8');
  const st = await stat(path);
  return { exists: true, path, text, mtimeMs: st.mtimeMs };
}

async function productDigest() {
  const bytes = await readFile(join(fixtureApp, 'src', 'clamp.js'));
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'cmd-teach-how-why',
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
  const backupPath = `${referenceRulePath}.teach-how-why-backup`;
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
  const needle = 'teach-fixture-app';
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
  let teachSkill = false;
  let howSkill = false;
  let whySkill = false;
  const assistantTexts = [];
  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const blob = JSON.stringify(o);
    if (/\bteach\b/i.test(blob) && /skill/i.test(blob)) teachSkill = true;
    if (/\bhow\b/i.test(blob) && /skill/i.test(blob)) howSkill = true;
    if (/\bwhy\b/i.test(blob) && /skill/i.test(blob)) whySkill = true;
    const msg = o.message || o;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type === 'toolCall' || part.type === 'tool_use') {
        const name = part.name || part.toolName || '';
        let label = name;
        const argBlob = JSON.stringify(part.arguments || part.input || {});
        if (/how\/SKILL\.md/i.test(argBlob)) label = `${name}(how/SKILL.md)`;
        else if (/why\/SKILL\.md/i.test(argBlob)) label = `${name}(why/SKILL.md)`;
        else if (/teach\/SKILL\.md/i.test(argBlob)) label = `${name}(teach/SKILL.md)`;
        toolOrder.push(label);
      }
      if (part.type === 'text' && typeof part.text === 'string' && (msg.role === 'assistant' || o.type === 'message')) {
        assistantTexts.push(part.text);
      }
    }
  }
  return {
    sessionPath,
    teachSkill,
    howSkill,
    whySkill,
    toolOrder: toolOrder.slice(0, 120),
    assistantJoined: assistantTexts.join('\n\n'),
  };
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.teach-how-why-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(howPath(side), { force: true });
  await rm(whyPath(side), { force: true });
  await rm(teachPath(side), { force: true });
  await rm(donePath(side), { force: true });
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = teachPrompt(side);
  const beforeProduct = await productDigest();
  let attempt;
  try {
    await writeFile(rulePath, ruleBytes);
    if (side === 'pi') await ensurePiTrust();
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(ruleDigest) : piSpec(ruleDigest));
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitEither(attempt, GEOMETRY, ['clamp', 'README', 'pi', 'teach'], 120_000);
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
        ['teach', 'how', 'why', 'clamp', 'bound', 'Sources', 'Key Concepts'],
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
      const how = await readOptional(howPath(side));
      const why = await readOptional(whyPath(side));
      const teach = await readOptional(teachPath(side));
      const done = await readOptional(donePath(side));
      const enough = (how.exists || why.exists) && teach.exists && done.exists;
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
    const how = await readOptional(howPath(side));
    const why = await readOptional(whyPath(side));
    const teach = await readOptional(teachPath(side));
    const done = await readOptional(donePath(side));
    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      sessionSummary = await summarizePiSession(await findLatestPiSession());
    }

    const groundMtimes = [how.mtimeMs, why.mtimeMs].filter((n) => typeof n === 'number');
    const latestGround = groundMtimes.length ? Math.max(...groundMtimes) : null;
    const mtimeOrder =
      latestGround != null && teach.exists
        ? latestGround <= teach.mtimeMs
          ? 'grounding-mtime-before-teach'
          : 'teach-mtime-before-grounding'
        : null;

    const ordering = scoreTeachOrdering({
      howText: how.text,
      whyText: why.text,
      teachText: teach.text,
      screenText: settledText,
      ptyText,
      sessionSummary,
    });

    if (mtimeOrder === 'grounding-mtime-before-teach' && ordering.groundingPresent && ordering.teachPresent) {
      ordering.order = 'how-why-before-teach';
      ordering.orderOk = true;
      ordering.mtimeOrder = mtimeOrder;
    } else if (mtimeOrder === 'teach-mtime-before-grounding') {
      ordering.mtimeOrder = mtimeOrder;
      if (ordering.order === 'unknown') {
        ordering.order = 'teach-before-how-why';
        ordering.orderOk = false;
      }
    } else {
      ordering.mtimeOrder = mtimeOrder;
    }

    const screenObs = observeSignals(settledText);
    const ptyObs = observeSignals(ptyText);
    const afterProduct = await productDigest();
    const observations = {
      teachSkill: Boolean(screenObs.teachSkill || ptyObs.teachSkill || sessionSummary?.teachSkill),
      howSkill: Boolean(screenObs.howSkill || ptyObs.howSkill || sessionSummary?.howSkill),
      whySkill: Boolean(screenObs.whySkill || ptyObs.whySkill || sessionSummary?.whySkill),
      spawnSignal: Boolean(screenObs.spawnSignal || ptyObs.spawnSignal),
      how,
      why,
      teach,
      done: done.exists
        ? { exists: true, path: done.path, line: (done.text || '').trim() }
        : { exists: false, path: done.path, line: null },
      ordering,
      productUnchanged: beforeProduct === afterProduct,
      beforeProduct,
      afterProduct,
      session: sessionSummary
        ? {
            sessionPath: sessionSummary.sessionPath,
            teachSkill: sessionSummary.teachSkill,
            howSkill: sessionSummary.howSkill,
            whySkill: sessionSummary.whySkill,
            toolOrder: sessionSummary.toolOrder,
          }
        : null,
    };

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
    if (how.exists) await writeFile(join(dir, 'how-copy.md'), how.text);
    if (why.exists) await writeFile(join(dir, 'why-copy.md'), why.text);
    if (teach.exists) await writeFile(join(dir, 'teach-copy.md'), teach.text);

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

if (only === '--self-test') {
  const pass = scoreTeachOrdering({
    howText: '## Key Concepts\nclamp bounds n to [lo, hi]\n## How It Works\n',
    whyText: '## Sources Consulted\ngit\n## Confidence Summary\nmedium\n',
    teachText: 'clamp returns lo when n is below lo so call sites stay thin.\n',
    screenText: 'Used how\nUsed why\nUsed teach',
    ptyText: '',
    sessionSummary: { toolOrder: ['read(how/SKILL.md)', 'task', 'write'], assistantJoined: '' },
  });
  const fail = scoreTeachOrdering({
    howText: '',
    whyText: '',
    teachText: 'clamp returns lo when n is below lo.',
    screenText: 'Used teach only',
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
    scenario: 'cmd-teach-how-why',
    fixtureDigest: preDigest,
    results,
  }),
);
