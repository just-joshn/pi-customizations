#!/usr/bin/env node
// team-kit verify-this pair: Cursor loads locked cursor-team-kit via --plugin-dir;
// Pi gets the same SKILL.md bytes seeded under .pi/skills/verify-this/.
// Real PTY both sides. Oracle is on-disk verdict + STATUS done marker.
//
// Usage: node parity/scripts/capture-team-kit-verify-this.mjs [--cursor-only|--pi-only|--both]
// Evidence: parity/evidence/team-kit/
import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { sha256 } from '../recorder/files.mjs';
import { outputBytes, startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'team-kit');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const lockedSkill = join(
  root,
  'reference',
  'cursor-plugins',
  'cursor-team-kit',
  'skills',
  'verify-this',
  'SKILL.md',
);
const LOCKED_SKILL_SHA256 = 'c1c7b27c1133085bd3409c601ea12b6e6f61b4b23debcd52bc248fc01907e7de';
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 900_000;
const SCENARIO_REF = 'team-kit:verify-this';
const PAIR_ID = 'team-kit-verify-this-1';
const CLAIM = 'probe.txt contains the exact line VALUE=7';

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

function verdictPath(side) {
  return join(writeRootFor(side), 'verify-this', 'verdict.md');
}

function claimPath(side) {
  return join(writeRootFor(side), 'verify-this', 'claim.md');
}

function promptFor(side) {
  const outRoot = writeRootFor(side);
  const verdict = verdictPath(side);
  const claimFile = claimPath(side);
  const done = donePath(side);
  return (
    `/verify-this Claim: ${CLAIM}. ` +
    `Do not ask questions. Follow the verify-this skill. ` +
    `Restate the claim falsifiably in ${claimFile}. ` +
    `Capture baseline by reading probe.txt in this workspace. ` +
    `Treatment is the same file with no edits (expect match). ` +
    `Write ${verdict} whose first non-empty line is exactly one of ` +
    `VERIFIED, NOT VERIFIED, or INCONCLUSIVE. ` +
    `Then write exactly one line to ${done} as ` +
    `STATUS=verified|not-verified|inconclusive|env-blocked reason=<short phrase> and stop. ` +
    `Artifacts stay under ${outRoot}. Do not edit parity ledgers.`
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

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null, status: null };
  const line = (await readFile(path, 'utf8')).trim();
  const m = line.match(/^STATUS=(verified|not-verified|inconclusive|env-blocked)\b/i);
  return { exists: true, path, line, status: m ? m[1].toLowerCase() : null };
}

async function readVerdict(side) {
  const path = verdictPath(side);
  if (!(await pathExists(path))) {
    return { exists: false, path, verdict: null, text: null };
  }
  const text = await readFile(path, 'utf8');
  const first = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  const verdict = /^(VERIFIED|NOT VERIFIED|INCONCLUSIVE)\b/i.test(first || '')
    ? first.toUpperCase().replace(/\s+/g, ' ')
    : null;
  return { exists: true, path, verdict, text };
}

function observeVerify(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  return {
    skillMention:
      /\b\/verify-this\b/i.test(hay) ||
      /\bverify-this\b/i.test(hay) ||
      /\[skill\]\s*verify-this\b/i.test(hay),
    verdictMention: /\b(VERIFIED|NOT VERIFIED|INCONCLUSIVE)\b/i.test(hay),
    probeMention: /\bprobe\.txt\b/i.test(hay) || /\bVALUE=7\b/.test(hay),
    envBlocked: /\benv[- ]blocked\b/i.test(hay),
    working: /[\u2800-\u28FF]/.test(hay) || /\bWorking\b/.test(hay),
  };
}

async function seedPiSkill() {
  const destDir = join(fixtureApp, '.pi', 'skills', 'verify-this');
  const dest = join(destDir, 'SKILL.md');
  await mkdir(destDir, { recursive: true });
  await cp(lockedSkill, dest);
  const digest = (await sha256(dest)).replace(/^sha256:/, '');
  if (digest !== LOCKED_SKILL_SHA256) {
    throw new Error(`Seeded Pi verify-this hash ${digest} != locked ${LOCKED_SKILL_SHA256}`);
  }
  return { path: dest, sha256: digest };
}

async function ensureProbe() {
  const path = join(fixtureApp, 'probe.txt');
  await writeFile(path, 'VALUE=7\n');
  return path;
}

async function cleanGenerated(side) {
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(join(writeRootFor(side), 'verify-this'), { recursive: true, force: true });
  await rm(donePath(side), { force: true });
  await mkdir(join(writeRootFor(side), 'verify-this'), { recursive: true });
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: SCENARIO_REF,
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
  const backupPath = `${referenceRulePath}.team-kit-verify-this-backup`;
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
      (/fixture-app|verify-this|Skill conflicts|medium/i.test(text) || /probe/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

function scoreVerify({ verdict, done, screenObs, ptyObs }) {
  const verdictOk = verdict?.verdict === 'VERIFIED';
  const skillPath =
    Boolean(screenObs?.skillMention) || Boolean(ptyObs?.skillMention);
  const envBlocked = done?.status === 'env-blocked' || Boolean(screenObs?.envBlocked);
  return {
    verdictOk,
    skillPath,
    envBlocked,
    doneStatus: done?.status ?? null,
    verdict: verdict?.verdict ?? null,
    closed: Boolean(verdictOk && skillPath && done?.status === 'verified'),
    honestBlocker: !verdictOk && envBlocked,
  };
}

async function waitVerifySettled(attempt, side, timeoutMs, prompt) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let calm = 0;
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observeVerify(last.join('\n'), { ignorePromptSlice: prompt });
    const verdict = await readVerdict(side);
    const done = await readDone(side);
    const enough =
      (verdict.verdict === 'VERIFIED' && (done.status === 'verified' || done.exists)) ||
      done.status === 'env-blocked';
    if (enough && !obs.working) {
      calm += 1;
      if (calm >= 3) return last;
    } else {
      calm = 0;
    }
    await sleep(800);
  }
  return last;
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.team-kit-verify-this-backup`;
  await mkdir(dir, { recursive: true });
  await ensureProbe();
  await cleanGenerated(side);
  let seeded = null;
  if (side === 'pi') seeded = await seedPiSkill();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = promptFor(side);
  const observations = {};
  let attempt;
  try {
    await writeFile(rulePath, ruleBytes);
    if (side === 'pi') await ensurePiTrust();
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
        ['verify-this', 'VERIFIED', 'NOT VERIFIED', 'INCONCLUSIVE', 'STATUS=', 'probe.txt'],
        300_000,
      );
    } catch {
      // settle may still land artifacts
    }
    await dumpScreen(attempt, dir, '03-signal', GEOMETRY);

    const settledLines = await waitVerifySettled(attempt, side, SETTLE_MS, prompt);
    try {
      await waitSettled(attempt, GEOMETRY, 60_000);
    } catch {
      // best-effort
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '04-settled', GEOMETRY);

    const finalLines = settledLines.length ? settledLines : await screenLines(attempt, GEOMETRY);
    const ptyText = Buffer.from(outputBytes(attempt.events())).toString('utf8');
    observations.screenFinal = observeVerify(finalLines.join('\n'), { ignorePromptSlice: prompt });
    observations.pty = observeVerify(ptyText, { ignorePromptSlice: prompt });
    observations.verdict = await readVerdict(side);
    observations.done = await readDone(side);
    observations.claimExists = await pathExists(claimPath(side));
    observations.seededSkill = seeded;
    observations.score = scoreVerify({
      verdict: observations.verdict,
      done: observations.done,
      screenObs: observations.screenFinal,
      ptyObs: observations.pty,
    });

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt-verify-this.txt'), `${prompt}\n`);
    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      ruleUnchanged: after === ruleBytes,
      afterDigest,
      fixtureDigest: ruleDigest,
      prompt,
      observations,
      identity: JSON.parse(await readFile(join(attempt.dir, 'identity.json'), 'utf8')),
    };
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
    await restoreRule(ruleBytes);
  }
}

async function loadSideFromDisk(side) {
  const obsPath = join(evidenceRoot, side, 'observations.json');
  if (!(await pathExists(obsPath))) return null;
  const observations = JSON.parse(await readFile(obsPath, 'utf8'));
  const sideRoot = join(evidenceRoot, side);
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(sideRoot, { withFileTypes: true });
  let attemptId = null;
  let attemptDir = null;
  let identity = null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const identPath = join(sideRoot, entry.name, 'identity.json');
    if (!(await pathExists(identPath))) continue;
    attemptId = entry.name;
    attemptDir = join(sideRoot, entry.name);
    identity = JSON.parse(await readFile(identPath, 'utf8'));
  }
  if (!attemptId) return null;
  return {
    side,
    attemptId,
    attemptDir,
    ruleUnchanged: true,
    afterDigest: identity?.fixtureRef?.digest ?? null,
    observations,
    identity,
  };
}

async function writePair(results, preDigest, lockedSkillDigest) {
  const bySide = Object.fromEntries(results.map((r) => [r.side, r]));
  if (!bySide.cursor) bySide.cursor = await loadSideFromDisk('cursor');
  if (!bySide.pi) bySide.pi = await loadSideFromDisk('pi');
  if (!bySide.cursor || !bySide.pi) return null;
  const cursor = bySide.cursor;
  const pi = bySide.pi;
  const bothClosed =
    Boolean(cursor.observations?.score?.closed) && Boolean(pi.observations?.score?.closed);
  const pair = {
    schema: 1,
    pairId: PAIR_ID,
    scenarioRef: SCENARIO_REF,
    journeyFamily: 'cursor-team-kit',
    skillId: 'verify-this',
    skillMdPath: 'parity/reference/cursor-plugins/cursor-team-kit/skills/verify-this/SKILL.md',
    skillMdSha256: lockedSkillDigest,
    fixtureDigest: preDigest,
    claim: CLAIM,
    steps: [
      { wait: 'ready screen (Tip: on Cursor; Pi chat ready without Trust dialog)' },
      { send: '/verify-this Claim: probe.txt contains VALUE=7 ...' },
      { send: '\r' },
      { wait: 'verdict.md first line VERIFIED and STATUS=verified, or STATUS=env-blocked' },
      { cancel: true },
    ],
    cursor: {
      attemptId: cursor.attemptId,
      dir: cursor.attemptDir,
      ruleUnchanged: cursor.ruleUnchanged,
      afterDigest: cursor.afterDigest,
      executable: cursor.identity?.executable ?? null,
      observedEnv: cursor.identity?.observedEnv ?? null,
      verdictPath: verdictPath('cursor'),
      donePath: donePath('cursor'),
      observations: cursor.observations?.score ?? null,
    },
    pi: {
      attemptId: pi.attemptId,
      dir: pi.attemptDir,
      ruleUnchanged: pi.ruleUnchanged,
      afterDigest: pi.afterDigest,
      executable: pi.identity?.executable ?? null,
      observedEnv: pi.identity?.observedEnv ?? null,
      verdictPath: verdictPath('pi'),
      donePath: donePath('pi'),
      seededSkill: pi.observations?.seededSkill ?? null,
      observations: pi.observations?.score ?? null,
    },
    skillClosure: {
      'verify-this': bothClosed ? 'closed_by_this_pair' : 'open',
    },
    note:
      'Cursor loads locked team-kit via --plugin-dir. Pi seeds the same SKILL.md bytes under .pi/skills/verify-this/. Full 18-skill team-kit closure is not claimed by this pair alone.',
    verdict: bothClosed ? 'pass' : 'fail',
  };
  const pairPath = join(evidenceRoot, `pair-${PAIR_ID}.json`);
  await writeFile(pairPath, `${JSON.stringify(pair, null, 2)}\n`, { flag: 'w' });
  return pairPath;
}

if (isMain) {
  const preRule = await readFile(referenceRulePath, 'utf8');
  const preDigest = await sha256(referenceRulePath);
  if (preDigest !== LOCKED_FIXTURE_DIGEST) {
    console.error(
      `Reference rule digest ${preDigest} does not match the locked fixture ${LOCKED_FIXTURE_DIGEST}`,
    );
    process.exit(1);
  }
  const lockedSkillDigest = (await sha256(lockedSkill)).replace(/^sha256:/, '');
  if (lockedSkillDigest !== LOCKED_SKILL_SHA256) {
    console.error(`Locked verify-this SKILL.md hash drift: ${lockedSkillDigest}`);
    process.exit(1);
  }
  const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
  const results = [];
  for (const side of sides) {
    const result = await runSide(side, preRule, preDigest);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  const pairPath = await writePair(results, preDigest, lockedSkillDigest);
  await writeFile(
    join(evidenceRoot, 'capture-results-verify-this.json'),
    `${JSON.stringify({ scenario: SCENARIO_REF, fixtureDigest: preDigest, pairPath, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      scenario: SCENARIO_REF,
      fixtureDigest: preDigest,
      pairPath,
      results: results.map((r) => ({
        side: r.side,
        attemptId: r.attemptId,
        closed: r.observations.score.closed,
        verdict: r.observations.score.verdict,
        doneStatus: r.observations.score.doneStatus,
        skillPath: r.observations.score.skillPath,
        honestBlocker: r.observations.score.honestBlocker,
      })),
    }),
  );
}
