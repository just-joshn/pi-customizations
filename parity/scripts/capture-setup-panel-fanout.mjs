#!/usr/bin/env node
// setup-panel-list-fanout: plant arena runners as three inherit-parent aliases,
// invoke /arena without an N override, score whether spawn count equals list length.
// Real PTY both sides. Restores the locked reference rule after each side.
//
// Usage: node scripts/capture-setup-panel-fanout.mjs [--cursor-only|--pi-only|--both|--self-test]
// Evidence root: parity/evidence/setup-panel-fanout/
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
const evidenceRoot = join(root, 'evidence', 'setup-panel-fanout');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const fixtureRulePath = join(evidenceRoot, 'fixture-panel-list.mdc');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const EXPECTED_LIST_LENGTH = 3;
const SETTLE_MS = 1_500_000;
const BACKUP_SUFFIX = '.setup-panel-fanout-backup';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stripAnsi = (text) =>
  text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');

function digestBytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function parsePanelList(ruleText, role = 'arena runners') {
  const match = ruleText.match(new RegExp(`^${role}:\\s*(.+)$`, 'm'));
  if (!match) return { raw: null, entries: [], length: 0 };
  const raw = match[1].trim();
  const entries = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return { raw, entries, length: entries.length };
}

function writeRootFor(side) {
  return join(evidenceRoot, 'fixture-out', side);
}

function candidatesRoot(side) {
  return join(writeRootFor(side), 'candidates');
}

function donePath(side) {
  return join(writeRootFor(side), 'done.txt');
}

function notePath(side) {
  return join(writeRootFor(side), 'fanout-note.md');
}

function arenaPrompt(side) {
  const out = writeRootFor(side);
  const cands = candidatesRoot(side);
  const note = notePath(side);
  const done = donePath(side);
  return (
    `/arena Use the arena runners line in pstack-models.mdc as the sole source of fan-out count. ` +
    `One subagent per list entry, including alias entries. Do not invent a different N and do not ` +
    `collapse duplicate aliases. Bake off structurally distinct pure JS clamp(n, lo, hi) helpers ` +
    `that return a number. Same task prompt for every candidate. Work only inside this fixture cwd. ` +
    `Do not edit ledgers, parity/, or files outside this cwd except the named out paths. ` +
    `Each candidate writes under ${cands}/cN/ (clamp.js plus rationale.md). ` +
    `After runners finish, write ${note} naming the arena runners list you read, its length, ` +
    `and how many runners you spawned. Then write exactly one line to ${done} as ` +
    `listLength=N spawnCount=N panelDriven=yes|no, then stop.`
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

async function readOptional(path) {
  try {
    return { exists: true, path, text: await readFile(path, 'utf8') };
  } catch {
    return { exists: false, path, text: '' };
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
    dirs.push({
      name: entry.name,
      path: abs,
      hasCode: await pathExists(join(abs, 'clamp.js')),
      hasRationale: await pathExists(join(abs, 'rationale.md')),
    });
  }
  return dirs.sort((a, b) => a.name.localeCompare(b.name));
}

function parseDoneLine(text) {
  const line = (text || '').trim().split('\n').filter(Boolean).at(-1) || '';
  const get = (key) => {
    const m = line.match(new RegExp(`${key}=([^\\s]+)`, 'i'));
    return m ? m[1] : null;
  };
  return {
    raw: line || null,
    listLength: get('listLength'),
    spawnCount: get('spawnCount'),
    panelDriven: get('panelDriven'),
  };
}

function countTaskSpawns(toolOrder) {
  return (toolOrder || []).filter((name) => /^task$/i.test(String(name))).length;
}

export function scorePanelFanout({
  expectedListLength,
  panelList,
  doneLine,
  noteText,
  screenText,
  ptyText,
  sessionSummary,
  candidateDirs,
}) {
  const blobs = [noteText || '', screenText || '', ptyText || '', sessionSummary?.assistantJoined || ''].join(
    '\n\n---\n\n',
  );
  const candidateCountOnDisk = (candidateDirs || []).filter((c) => c.hasCode || c.hasRationale).length;
  const doneParsed = parseDoneLine(doneLine);
  const taskCount = countTaskSpawns(sessionSummary?.toolOrder);
  const nThreeChrome =
    /\bN\s*=\s*3\b/i.test(blobs) ||
    /\b3\s+candidates?\b/i.test(blobs) ||
    /\bthree\s+candidates?\b/i.test(blobs) ||
    /\bFan(?:\s|-)?out\b.*\b3\b/i.test(blobs) ||
    /\bspawn(?:ed)?\s+(?:three|3)\b/i.test(blobs);
  const panelMention =
    /\barena runners\b/i.test(blobs) ||
    /\bpanel\b/i.test(blobs) ||
    /\blist length\b/i.test(blobs) ||
    /\binherit-parent,\s*inherit-parent,\s*inherit-parent\b/i.test(blobs);
  const spawnFromDone = doneParsed.spawnCount ? Number(doneParsed.spawnCount) : null;
  const spawnCount = Number.isFinite(spawnFromDone)
    ? spawnFromDone
    : taskCount > 0
      ? taskCount
      : candidateCountOnDisk;
  const listLengthObserved = panelList?.length ?? expectedListLength;
  const lengthMatches =
    listLengthObserved === expectedListLength &&
    (spawnCount === expectedListLength ||
      candidateCountOnDisk === expectedListLength ||
      (taskCount === expectedListLength && taskCount > 0));
  const panelDriven =
    doneParsed.panelDriven === 'yes' ||
    (panelMention && nThreeChrome) ||
    (panelMention && lengthMatches);
  const contractOk = Boolean(
    panelList?.length === expectedListLength &&
      lengthMatches &&
      (panelDriven || doneParsed.panelDriven === 'yes') &&
      (candidateCountOnDisk === expectedListLength || taskCount === expectedListLength || spawnCount === expectedListLength),
  );
  return {
    expectedListLength,
    panelListLength: panelList?.length ?? 0,
    panelEntries: panelList?.entries ?? [],
    candidateCountOnDisk,
    taskCount,
    spawnCount,
    nThreeChrome,
    panelMention,
    panelDriven,
    lengthMatches,
    contractOk,
    doneParsed,
    toolOrder: sessionSummary?.toolOrder ?? null,
  };
}

function observeSignals(text) {
  return {
    arenaSkill: /\barena\b/i.test(text) && (/skill/i.test(text) || /Phase\s+[AB]/i.test(text) || /Fan(?:\s|-)?out/i.test(text)),
    fanoutChrome: /\bFan(?:\s|-)?out\b/i.test(text) || /\bN\s*=\s*\d+\b/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'setup-panel-list-fanout',
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

async function restoreLocked(lockedBytes) {
  const backupPath = `${referenceRulePath}${BACKUP_SUFFIX}`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, lockedBytes);
  }
  await writeFile(piRulePath, lockedBytes);
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
  const needle = 'setup-panel-fanout';
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
        if (!best || st.mtimeMs > best.ms) best = { path: abs, ms: st.mtimeMs };
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
    toolOrder: toolOrder.slice(0, 160),
    assistantJoined: assistantTexts.join('\n\n'),
  };
}

async function clearSideOutputs(side) {
  const out = writeRootFor(side);
  await mkdir(out, { recursive: true });
  await rm(candidatesRoot(side), { recursive: true, force: true });
  await rm(donePath(side), { force: true });
  await rm(notePath(side), { force: true });
  await mkdir(candidatesRoot(side), { recursive: true });
}

async function runSide(side, lockedBytes, panelBytes, panelDigest, panelList) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}${BACKUP_SUFFIX}`;
  await mkdir(dir, { recursive: true });
  await clearSideOutputs(side);
  await writeFile(backupPath, lockedBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = arenaPrompt(side);
  let attempt;
  try {
    await writeFile(rulePath, panelBytes);
    if (side === 'pi') await ensurePiTrust();
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(panelDigest) : piSpec(panelDigest));
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitEither(attempt, GEOMETRY, ['clamp', 'README', 'pi', 'bakeoff', 'panel'], 120_000);
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
        ['arena', 'Fan', 'candidate', 'runners', 'clamp', 'listLength', 'spawnCount'],
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
      const done = await readOptional(donePath(side));
      const note = await readOptional(notePath(side));
      const cands = await listCandidateDirs(side);
      const enough =
        done.exists ||
        (note.exists && cands.filter((c) => c.hasCode).length >= EXPECTED_LIST_LENGTH);
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
    const done = await readOptional(donePath(side));
    const note = await readOptional(notePath(side));
    const candidateDirs = await listCandidateDirs(side);
    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      sessionSummary = await summarizePiSession(await findLatestPiSession());
    }

    const scoring = scorePanelFanout({
      expectedListLength: EXPECTED_LIST_LENGTH,
      panelList,
      doneLine: done.text,
      noteText: note.text,
      screenText: settledText,
      ptyText,
      sessionSummary,
      candidateDirs,
    });

    const screenObs = observeSignals(settledText);
    const observations = {
      arenaSkill: Boolean(screenObs.arenaSkill || sessionSummary?.arenaSkillInjected),
      fanoutChrome: Boolean(screenObs.fanoutChrome),
      candidateDirs,
      note,
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
    if (note.exists) await writeFile(join(dir, 'fanout-note-copy.md'), note.text);
    if (done.exists) await writeFile(join(dir, 'done-copy.txt'), done.text);

    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      ruleUnchanged: after === panelBytes,
      afterDigest,
      fixtureDigest: panelDigest,
      prompt,
      observations,
    };
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
    await restoreLocked(lockedBytes);
  }
}

const lockedBytes = await readFile(referenceRulePath, 'utf8');
const lockedDigest = await sha256(referenceRulePath);
if (lockedDigest !== LOCKED_FIXTURE_DIGEST) {
  console.error(`Reference rule digest ${lockedDigest} does not match the locked fixture ${LOCKED_FIXTURE_DIGEST}`);
  process.exit(1);
}

const panelBytes = await readFile(fixtureRulePath, 'utf8');
const panelDigest = digestBytes(panelBytes);
const panelList = parsePanelList(panelBytes);
if (panelList.length !== EXPECTED_LIST_LENGTH) {
  console.error(`Fixture arena runners length ${panelList.length} != ${EXPECTED_LIST_LENGTH}`);
  process.exit(1);
}

if (only === '--self-test') {
  const pass = scorePanelFanout({
    expectedListLength: 3,
    panelList,
    doneLine: 'listLength=3 spawnCount=3 panelDriven=yes',
    noteText: 'Read arena runners: inherit-parent, inherit-parent, inherit-parent (length 3). Spawned 3.',
    screenText: 'Fan out N=3 candidates\narena runners list length 3',
    ptyText: '',
    sessionSummary: { toolOrder: ['TodoWrite', 'task', 'task', 'task'], assistantJoined: '', arenaSkillInjected: true },
    candidateDirs: [
      { name: 'c1', hasCode: true, hasRationale: true },
      { name: 'c2', hasCode: true, hasRationale: true },
      { name: 'c3', hasCode: true, hasRationale: true },
    ],
  });
  const fail = scorePanelFanout({
    expectedListLength: 3,
    panelList,
    doneLine: 'listLength=3 spawnCount=2 panelDriven=no',
    noteText: 'Ignored aliases; spawned 2',
    screenText: 'Fan out N=2',
    ptyText: '',
    sessionSummary: { toolOrder: ['task', 'task'], assistantJoined: '', arenaSkillInjected: true },
    candidateDirs: [
      { name: 'c1', hasCode: true, hasRationale: true },
      { name: 'c2', hasCode: true, hasRationale: true },
    ],
  });
  console.log(JSON.stringify({ pass, fail, panelList }));
  if (!pass.contractOk || fail.contractOk) process.exit(1);
  process.exit(0);
}

const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
const results = [];
for (const side of sides) {
  const result = await runSide(side, lockedBytes, panelBytes, panelDigest, panelList);
  results.push(result);
  console.log(JSON.stringify(result));
}
console.log(
  JSON.stringify({
    scenario: 'setup-panel-list-fanout',
    lockedDigest,
    panelDigest,
    panelList,
    expectedListLength: EXPECTED_LIST_LENGTH,
    results,
  }),
);
