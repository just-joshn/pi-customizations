#!/usr/bin/env node
// cmd-arena-base-graft pair: invoke /arena on a tiny bakeoff and score whether
// fan-out, base pick, and graft are observable. Real PTY both sides.
//
// Usage: node scripts/capture-arena-base-graft.mjs [--cursor-only|--pi-only|--both|--self-test]
// Evidence root: parity/evidence/arena/
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
const evidenceRoot = join(root, 'evidence', 'arena');
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

function candidatesRoot(side) {
  return join(writeRootFor(side), 'candidates');
}

function synthesisPath(side) {
  return join(writeRootFor(side), 'synthesis.md');
}

function synthesizedPath(side) {
  return join(writeRootFor(side), 'synthesized', 'parseQuery.js');
}

function donePath(side) {
  return join(writeRootFor(side), 'done.txt');
}

function arenaPrompt(side) {
  const out = writeRootFor(side);
  const cands = candidatesRoot(side);
  const synthNote = synthesisPath(side);
  const synthCode = synthesizedPath(side);
  const done = donePath(side);
  return (
    `/arena N=2 bake off two structurally distinct pure JS implementations of ` +
    `parseQuery(qs) that returns Record<string, string[]> for URL query strings. ` +
    `Same task prompt for both candidates. Work only inside this fixture cwd. ` +
    `Do not edit ledgers, parity/, or files outside this cwd except the named out paths. ` +
    `Each candidate writes under ${cands}/c1/ and ${cands}/c2/ (parseQuery.js plus rationale.md). ` +
    `After both finish, pick a base, graft the strongest pieces from the loser into it, ` +
    `verify the result, write the synthesized module to ${synthCode}, and write a synthesis ` +
    `note to ${synthNote} that names the base candidate id, each graft with its source ` +
    `candidate, rejections, and verification. If candidates converge so no graft is needed, ` +
    `say that explicitly in the note. Then write exactly one line to ${done} as ` +
    `fanout=yes|no base=yes|no graft=yes|no|none-needed verify=yes|no candidates=N, then stop.`
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

async function listCandidateDirs(side) {
  const rootDir = candidatesRoot(side);
  if (!(await pathExists(rootDir))) return [];
  const entries = await readdir(rootDir, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const abs = join(rootDir, entry.name);
    const hasCode = await pathExists(join(abs, 'parseQuery.js'));
    const hasRationale = await pathExists(join(abs, 'rationale.md'));
    dirs.push({ name: entry.name, path: abs, hasCode, hasRationale });
  }
  return dirs.sort((a, b) => a.name.localeCompare(b.name));
}

export function scoreArena({
  synthesisText,
  synthesizedText,
  doneLine,
  screenText,
  ptyText,
  sessionSummary,
  candidateDirs,
}) {
  const blobs = [synthesisText || '', screenText || '', ptyText || '', sessionSummary?.assistantJoined || ''].join(
    '\n\n---\n\n',
  );
  const candidateCountOnDisk = (candidateDirs || []).filter((c) => c.hasCode || c.hasRationale).length;
  const fanoutPatterns = [
    /\bFan(?:\s|-)?out\b/i,
    /\bcandidate[-_\s]?[12]\b/i,
    /\bN\s*=\s*[23]\b/i,
    /\bparallel candidates?\b/i,
    /\barena runners?\b/i,
    /\bspawn(?:ed)?\s+(?:two|2|three|3)\b/i,
  ];
  const basePatterns = [
    /\bBase\b\s*[:#]/i,
    /\bpicked?\s+(?:the\s+)?base\b/i,
    /\bbase candidate\b/i,
    /\bchose\s+c[12]\b/i,
    /\bpick(?:ed)?\s+c[12]\b/i,
  ];
  const graftPatterns = [
    /\bGrafts?\b\s*[:#]/i,
    /\bgrafted\b/i,
    /\bfrom candidate\b/i,
    /\bfrom c[12]\b/i,
    /\bport(?:ed)?\s+from\b/i,
  ];
  const noneNeededPatterns = [
    /\bno graft (?:is )?needed\b/i,
    /\bgraft=none-needed\b/i,
    /\bconverg(?:ed|ence)\b/i,
  ];
  const verifyPatterns = [
    /\bverif(?:y|ied|ication)\b/i,
    /\bprove it works\b/i,
    /\bself-?test\b/i,
  ];

  const fanoutText = fanoutPatterns.some((re) => re.test(blobs));
  const baseText = basePatterns.some((re) => re.test(synthesisText || '') || re.test(blobs));
  const graftText = graftPatterns.some((re) => re.test(synthesisText || '') || re.test(blobs));
  const noneNeeded = noneNeededPatterns.some((re) => re.test(synthesisText || '') || re.test(doneLine || '') || re.test(blobs));
  const verifyText = verifyPatterns.some((re) => re.test(synthesisText || '') || re.test(blobs));

  const toolOrder = sessionSummary?.toolOrder || [];
  const toolNames = toolOrder.map((t) => String(t).toLowerCase());
  const taskCount = toolNames.filter((n) => n === 'task' || n === 'agent').length;
  const arenaSkill =
    /\/arena\b/i.test(blobs) ||
    /\[skill\]\s*arena/i.test(blobs) ||
    /\bUsed arena\b/i.test(blobs) ||
    Boolean(sessionSummary?.arenaSkillInjected);

  const doneParsed = parseDoneLine(doneLine);
  const fanout =
    candidateCountOnDisk >= 2 ||
    taskCount >= 2 ||
    fanoutText ||
    doneParsed.fanout === 'yes';
  const base =
    Boolean(synthesizedText && synthesizedText.trim()) &&
    (baseText || doneParsed.base === 'yes' || /base/i.test(synthesisText || ''));
  let graft = 'no';
  if (graftText || doneParsed.graft === 'yes') graft = 'yes';
  else if (noneNeeded || doneParsed.graft === 'none-needed') graft = 'none-needed';
  const verify =
    verifyText ||
    doneParsed.verify === 'yes' ||
    Boolean(synthesizedText && synthesizedText.trim() && synthesisText && synthesisText.trim());

  const contractOk = Boolean(fanout && base && (graft === 'yes' || graft === 'none-needed') && verify);

  return {
    arenaSkill,
    candidateCountOnDisk,
    taskCount,
    fanout,
    base,
    graft,
    verify,
    contractOk,
    doneParsed,
    toolOrder: toolNames.slice(0, 40),
  };
}

function parseDoneLine(line) {
  const text = String(line || '').trim();
  const get = (key) => {
    const m = text.match(new RegExp(`${key}=(none-needed|yes|no|\\d+)`, 'i'));
    return m ? m[1].toLowerCase() : null;
  };
  return {
    raw: text || null,
    fanout: get('fanout'),
    base: get('base'),
    graft: get('graft'),
    verify: get('verify'),
    candidates: get('candidates'),
  };
}

function observeSignals(text) {
  const arenaSkill =
    /\/arena\b/i.test(text) || /\[skill\]\s*arena/i.test(text) || /\bUsed arena\b/i.test(text);
  const working = /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text);
  const fanoutChrome =
    /\bFan(?:\s|-)?out\b/i.test(text) || /\bcandidate[-_\s]?[12]\b/i.test(text) || /\bPhase B\b/i.test(text);
  const baseChrome = /\bBase\b\s*[:#]/i.test(text) || /\bPick(?:ed)?\b/i.test(text);
  const graftChrome = /\bGraft/i.test(text);
  return { arenaSkill, working, fanoutChrome, baseChrome, graftChrome };
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
    scenarioRef: 'cmd-arena-base-graft',
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
  const backupPath = `${referenceRulePath}.arena-base-graft-backup`;
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
  const needle = 'arena-fixture-app';
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
  let arenaSkillInjected = false;
  const assistantTexts = [];
  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const blob = JSON.stringify(o);
    if (/\barena\b/i.test(blob) && /skill/i.test(blob)) arenaSkillInjected = true;
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
    arenaSkillInjected,
    toolOrder: toolOrder.slice(0, 120),
    assistantJoined: assistantTexts.join('\n\n'),
  };
}

async function clearSideOutputs(side) {
  const out = writeRootFor(side);
  await mkdir(out, { recursive: true });
  await rm(candidatesRoot(side), { recursive: true, force: true });
  await rm(join(out, 'synthesized'), { recursive: true, force: true });
  await rm(synthesisPath(side), { force: true });
  await rm(donePath(side), { force: true });
  await mkdir(candidatesRoot(side), { recursive: true });
  await mkdir(join(out, 'synthesized'), { recursive: true });
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.arena-base-graft-backup`;
  await mkdir(dir, { recursive: true });
  await clearSideOutputs(side);
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = arenaPrompt(side);
  let attempt;
  try {
    await writeFile(rulePath, ruleBytes);
    if (side === 'pi') await ensurePiTrust();
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(ruleDigest) : piSpec(ruleDigest));
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitEither(attempt, GEOMETRY, ['parse', 'README', 'pi', 'bakeoff'], 120_000);
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
        ['arena', 'Fan', 'candidate', 'Frame', 'parseQuery', 'Base', 'Graft'],
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
      const synthesis = await readOptional(synthesisPath(side));
      const synthesized = await readOptional(synthesizedPath(side));
      const done = await readOptional(donePath(side));
      const cands = await listCandidateDirs(side);
      const enough =
        (synthesis.exists && synthesized.exists) ||
        done.exists ||
        (cands.filter((c) => c.hasCode).length >= 2 && synthesis.exists);
      if (enough && !obs.working) {
        calm += 1;
        if (calm >= 3) break;
      } else {
        calm = 0;
      }
      await sleep(800);
    }
    try {
      await waitSettled(attempt, GEOMETRY, 180_000);
    } catch {
      // best-effort
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '04-settled', GEOMETRY);

    const settledText = (await screenLines(attempt, GEOMETRY)).join('\n');
    const ptyText = stripAnsi(outputBytes(attempt.events()).toString('utf8'));
    const synthesis = await readOptional(synthesisPath(side));
    const synthesized = await readOptional(synthesizedPath(side));
    const done = await readOptional(donePath(side));
    const candidateDirs = await listCandidateDirs(side);
    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      sessionSummary = await summarizePiSession(await findLatestPiSession());
    }

    const scoring = scoreArena({
      synthesisText: synthesis.text,
      synthesizedText: synthesized.text,
      doneLine: done.text,
      screenText: settledText,
      ptyText,
      sessionSummary,
      candidateDirs,
    });

    const screenObs = observeSignals(settledText);
    const ptyObs = observeSignals(ptyText);
    const observations = {
      arenaSkill: Boolean(screenObs.arenaSkill || ptyObs.arenaSkill || sessionSummary?.arenaSkillInjected),
      fanoutChrome: Boolean(screenObs.fanoutChrome || ptyObs.fanoutChrome),
      baseChrome: Boolean(screenObs.baseChrome || ptyObs.baseChrome),
      graftChrome: Boolean(screenObs.graftChrome || ptyObs.graftChrome),
      candidateDirs,
      synthesis,
      synthesized,
      done: done.exists
        ? { exists: true, path: done.path, line: (done.text || '').trim() }
        : { exists: false, path: done.path, line: null },
      scoring,
      session: sessionSummary
        ? {
            sessionPath: sessionSummary.sessionPath,
            arenaSkillInjected: sessionSummary.arenaSkillInjected,
            toolOrder: sessionSummary.toolOrder,
          }
        : null,
    };

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
    if (synthesis.exists) await writeFile(join(dir, 'synthesis-copy.md'), synthesis.text);
    if (synthesized.exists) await writeFile(join(dir, 'synthesized-copy.js'), synthesized.text);

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
  const pass = scoreArena({
    synthesisText:
      '## Synthesis\n**Base:** c1\n**Grafts:** URLSearchParams edge handling from c2\n**Verification:** node -e checks pass\n',
    synthesizedText: 'export function parseQuery(qs) { return {}; }\n',
    doneLine: 'fanout=yes base=yes graft=yes verify=yes candidates=2',
    screenText: 'Fan out 2 candidates\nPick base c1\nGraft from c2',
    ptyText: '',
    sessionSummary: { toolOrder: ['Task', 'Task', 'Write'], assistantJoined: '', arenaSkillInjected: true },
    candidateDirs: [
      { name: 'c1', hasCode: true, hasRationale: true },
      { name: 'c2', hasCode: true, hasRationale: true },
    ],
  });
  const fail = scoreArena({
    synthesisText: 'one shot answer',
    synthesizedText: 'export function parseQuery() {}',
    doneLine: 'fanout=no base=yes graft=no verify=yes candidates=1',
    screenText: 'wrote one file',
    ptyText: '',
    sessionSummary: null,
    candidateDirs: [{ name: 'c1', hasCode: true, hasRationale: false }],
  });
  const converge = scoreArena({
    synthesisText: 'Base: c1. Candidates converged; no graft is needed. Verified with samples.',
    synthesizedText: 'export function parseQuery(qs) { return {}; }\n',
    doneLine: 'fanout=yes base=yes graft=none-needed verify=yes candidates=2',
    screenText: 'Fan out\nBase c1\nconvergence',
    ptyText: '',
    sessionSummary: { toolOrder: ['Task', 'Task'], assistantJoined: '', arenaSkillInjected: true },
    candidateDirs: [
      { name: 'c1', hasCode: true, hasRationale: true },
      { name: 'c2', hasCode: true, hasRationale: true },
    ],
  });
  console.log(JSON.stringify({ pass, fail, converge }));
  if (!pass.contractOk || fail.contractOk || !converge.contractOk) process.exit(1);
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
    scenario: 'cmd-arena-base-graft',
    fixtureDigest: preDigest,
    results,
  }),
);
