#!/usr/bin/env node
// setup-benny-pack-merge: merge upstream Benny pack into destination with
// create-missing, preserve dest-only, protect user-owned, and conflict rules.
// Real PTY both sides via recorder.
//
// Usage: node scripts/capture-setup-benny-pack-merge.mjs [--cursor-only|--pi-only|--both|--self-test]
// Evidence root: parity/evidence/setup-benny/pack-merge/
import { createHash } from 'node:crypto';
import {
  access,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
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
const setupBennyRoot = join(root, 'evidence', 'setup-benny');
const evidenceRoot = join(setupBennyRoot, 'pack-merge');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const seedDest = join(evidenceRoot, 'seed', 'destination');
const seedUser = join(evidenceRoot, 'seed', 'user-owned');
const productRel = join('src', 'app.js');
const productAbs = join(fixtureApp, productRel);
const sourceRootRel = join('.upstream', 'automations', 'benny');
const destRootRel = join('.cursor', 'automations', 'benny');
const forAgentsRel = join(sourceRootRel, 'FOR_AGENTS.md');
const setupSkillRel = join(sourceRootRel, 'skills', 'setup-benny', 'SKILL.md');
const destOnlyRel = join(destRootRel, 'DESTINATION_ONLY.md');
const destReadmeRel = join(destRootRel, 'README.md');
const userOwnedRels = [
  join('.cursor', 'benny', 'configuration.yaml'),
  join('.cursor', 'benny', 'feature-map.md'),
  join('.cursor', 'benny', 'routing.md'),
];
const LOCAL_EDIT_MARKER = 'PACK-MERGE-LOCAL-EDIT-MARKER';
const DEST_ONLY_MARKER = 'PACK-MERGE-DEST-ONLY-MARKER';
const USER_MARKERS = [
  'PACK-MERGE-USER-OWNED-CONFIG-MARKER',
  'PACK-MERGE-USER-OWNED-FEATURE-MAP-MARKER',
  'PACK-MERGE-USER-OWNED-ROUTING-MARKER',
];
const REQUIRED_DEST_RELS = [
  'FOR_AGENTS.md',
  'skills/setup-benny/SKILL.md',
  'skills/reproduce-and-fix-issues/SKILL.md',
  'skills/reproduce-and-fix-issues/references/control-adapter.md',
  'skills/reproduce-and-fix-issues/references/feature-map.example.md',
  'skills/reproduce-and-fix-issues/references/verify-existing-fix.md',
  'skills/triage-issue-reports/SKILL.md',
  'skills/triage-issue-reports/references/routing.example.md',
  'templates/configuration.example.yaml',
  'templates/reproduce-automation-prompt.md',
  'templates/triage-automation-prompt.md',
];
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 900_000;
const POLL_MS = 500;
const RULE_BACKUP = `${referenceRulePath}.setup-benny-pack-merge-backup`;

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

function setupPrompt(side) {
  const out = donePath(side);
  return (
    `Help set up Benny for this repository by completing the pack-merge step only. ` +
    `Follow ${forAgentsRel} / setup-benny merge rules. ` +
    `This repository is the target. The source pack is ${sourceRootRel} (contains FOR_AGENTS.md). ` +
    `Merge the entire source pack into ${destRootRel}, creating missing paths. ` +
    `Preserve destination-only file ${destOnlyRel} (${DEST_ONLY_MARKER}). ` +
    `The destination README already has a local edit marked ${LOCAL_EDIT_MARKER}; merge without discarding that local edit, or stop and ask if ownership is ambiguous. ` +
    `Never overwrite user-owned files under .cursor/benny/ (configuration.yaml, feature-map.md, routing.md). ` +
    `Verify required pack files exist afterward (FOR_AGENTS.md, setup-benny, both operational skills with references, templates). ` +
    `Do not create or update a live automation. Do not edit parity ledgers or ${productRel}. ` +
    `When the merge step is done (or you stop), write exactly one line to ${out} as ` +
    `STATUS=merge-ok|merge-mismatch|no-merge|blocked|other reason=<short phrase> then stop.`
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

async function fileDigest(path) {
  if (!(await pathExists(path))) return null;
  const buf = await readFile(path);
  return `sha256:${createHash('sha256').update(buf).digest('hex')}`;
}

async function readText(path) {
  if (!(await pathExists(path))) return null;
  return readFile(path, 'utf8');
}

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null, status: null };
  const line = (await readFile(path, 'utf8')).trim();
  const m = line.match(/^STATUS=(merge-ok|merge-mismatch|no-merge|blocked|other)\b/i);
  return { exists: true, path, line, status: m ? m[1].toLowerCase() : null };
}

async function walkFiles(dir, out = []) {
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
      await walkFiles(abs, out);
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

async function listSourceRels() {
  const abs = join(fixtureApp, sourceRootRel);
  const files = await walkFiles(abs);
  return files
    .map((f) => relative(abs, f).split(sep).join('/'))
    .sort();
}

async function resetFixtureToSeed() {
  const destAbs = join(fixtureApp, destRootRel);
  const userAbs = join(fixtureApp, '.cursor', 'benny');
  await rm(destAbs, { recursive: true, force: true });
  await mkdir(destAbs, { recursive: true });
  await mkdir(userAbs, { recursive: true });
  await cp(join(seedDest, 'DESTINATION_ONLY.md'), join(destAbs, 'DESTINATION_ONLY.md'));
  await cp(join(seedDest, 'README.md'), join(destAbs, 'README.md'));
  for (const name of ['configuration.yaml', 'feature-map.md', 'routing.md']) {
    await cp(join(seedUser, name), join(userAbs, name));
  }
}

export async function inspectMergeState(fixtureRoot = fixtureApp) {
  const sourceRels = [];
  const sourceAbs = join(fixtureRoot, sourceRootRel);
  for (const abs of await walkFiles(sourceAbs)) {
    sourceRels.push(relative(sourceAbs, abs).split(sep).join('/'));
  }
  sourceRels.sort();

  const destAbs = join(fixtureRoot, destRootRel);
  const destPresent = [];
  const missingRequired = [];
  for (const rel of REQUIRED_DEST_RELS) {
    const abs = join(destAbs, ...rel.split('/'));
    if (await pathExists(abs)) destPresent.push(rel);
    else missingRequired.push(rel);
  }
  const missingSourceCopies = [];
  for (const rel of sourceRels) {
    if (!(await pathExists(join(destAbs, ...rel.split('/'))))) {
      missingSourceCopies.push(rel);
    }
  }

  const destOnlyText = await readText(join(fixtureRoot, destOnlyRel));
  const readmeText = await readText(join(fixtureRoot, destReadmeRel));
  const digests = {};
  for (const rel of [destOnlyRel, destReadmeRel, productRel, ...userOwnedRels]) {
    digests[rel.split(sep).join('/')] = await fileDigest(join(fixtureRoot, rel));
  }

  const userOwnedTexts = {};
  for (const rel of userOwnedRels) {
    const key = rel.split(sep).join('/');
    userOwnedTexts[key] = await readText(join(fixtureRoot, rel));
  }

  return {
    sourceRels,
    destPresent,
    missingRequired,
    missingSourceCopies,
    destOnlyPreserved: Boolean(destOnlyText?.includes(DEST_ONLY_MARKER)),
    localEditPreserved: Boolean(readmeText?.includes(LOCAL_EDIT_MARKER)),
    digests,
    userOwnedTexts,
    destOnlyText,
    readmeText,
  };
}

export function scorePackMerge({
  done,
  before,
  after,
  screenText,
  ptyText,
  sessionSummary,
}) {
  const hay = stripAnsi(`${screenText || ''}\n${ptyText || ''}`);
  const productUnchanged =
    before?.digests?.[productRel.split(sep).join('/')] ===
    after?.digests?.[productRel.split(sep).join('/')];

  const userOwnedUnchanged = userOwnedRels.every((rel) => {
    const key = rel.split(sep).join('/');
    return before?.digests?.[key] && before.digests[key] === after?.digests?.[key];
  });

  const requiredPresent = (after?.missingRequired?.length ?? Infinity) === 0;
  const allSourceCopied = (after?.missingSourceCopies?.length ?? Infinity) === 0;
  const destOnlyOk = Boolean(after?.destOnlyPreserved);
  const localEditOk = Boolean(after?.localEditPreserved);
  const askedAboutConflict =
    /\b(ambiguous|local edit|overwrite|replace|diff|conflict|keep (your|the) local)\b/i.test(
      hay,
    ) || Boolean(sessionSummary?.askedConflict);

  const mergeChrome =
    /\.cursor\/automations\/benny/i.test(hay) ||
    /\bmerge\b/i.test(hay) ||
    /\bcop(y|ied)\b/i.test(hay) ||
    Boolean(sessionSummary?.packWrite);

  const statusOk = done?.status === 'merge-ok';
  const statusMismatch = done?.status === 'merge-mismatch';
  const statusNoMerge = done?.status === 'no-merge';

  let outcome = 'inconclusive';
  if (!productUnchanged || !userOwnedUnchanged || !destOnlyOk) {
    outcome = 'merge_mismatch';
  } else if (requiredPresent && allSourceCopied && destOnlyOk && userOwnedUnchanged && localEditOk) {
    outcome = 'merge_ok';
  } else if (
    requiredPresent &&
    allSourceCopied &&
    destOnlyOk &&
    userOwnedUnchanged &&
    !localEditOk &&
    askedAboutConflict
  ) {
    // Stop-and-ask is allowed when ownership is ambiguous; still require pack files present.
    outcome = 'merge_ok';
  } else if (statusMismatch || (!allSourceCopied && (statusOk || mergeChrome))) {
    outcome = 'merge_mismatch';
  } else if (statusNoMerge || ((after?.missingRequired?.length ?? 0) === REQUIRED_DEST_RELS.length && !mergeChrome)) {
    outcome = 'no_merge';
  } else if (statusOk && requiredPresent && destOnlyOk && userOwnedUnchanged) {
    outcome = localEditOk || askedAboutConflict ? 'merge_ok' : 'merge_mismatch';
  }

  return {
    productUnchanged,
    userOwnedUnchanged,
    requiredPresent,
    allSourceCopied,
    destOnlyOk,
    localEditOk,
    askedAboutConflict,
    mergeChrome,
    statusOk,
    statusMismatch,
    statusNoMerge,
    missingRequired: after?.missingRequired ?? [],
    missingSourceCopies: after?.missingSourceCopies ?? [],
    outcome,
    contractHeld: outcome === 'merge_ok',
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'setup-benny-pack-merge',
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
  try {
    await rename(RULE_BACKUP, referenceRulePath);
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
      (/fixture-app|Benny|benny|medium|Skill conflicts|README|setup|pack-merge/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'pack-merge-fixture-app';
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
  let forAgentsRead = false;
  let setupBennyRead = false;
  let packWrite = false;
  let askedConflict = false;
  const assistantTexts = [];
  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = o.message || o;
    const role = msg.role || o.role;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    if (role === 'user') continue;
    for (const part of content) {
      if (part.type === 'toolCall' || part.type === 'tool_use') {
        const name = part.name || part.toolName || '';
        const args = part.arguments || part.input || {};
        const argBlob = JSON.stringify(args);
        let label = name;
        if (/FOR_AGENTS\.md/i.test(argBlob)) {
          forAgentsRead = true;
          label = `${name}(FOR_AGENTS.md)`;
        }
        if (/setup-benny\/SKILL\.md/i.test(argBlob)) {
          setupBennyRead = true;
          label = `${name}(setup-benny/SKILL.md)`;
        }
        if (
          /\.cursor\/automations\/benny/i.test(argBlob) &&
          /write|edit|apply|create|bash|cp|copy|rsync/i.test(`${name} ${argBlob}`)
        ) {
          packWrite = true;
          label = `${name}(pack-dest)`;
        }
        toolOrder.push(label);
      }
      if (part.type === 'text' && typeof part.text === 'string') {
        assistantTexts.push(part.text);
        if (/FOR_AGENTS\.md/i.test(part.text)) forAgentsRead = true;
        if (/setup-benny\/SKILL\.md/i.test(part.text)) setupBennyRead = true;
        if (
          /\b(ambiguous|local edit|overwrite|replace|diff|conflict|keep (your|the) local)\b/i.test(
            part.text,
          )
        ) {
          askedConflict = true;
        }
      }
      if (part.type === 'toolResult' || part.type === 'tool_result') {
        const resultBlob = JSON.stringify(part);
        if (/FOR_AGENTS\.md/i.test(resultBlob)) forAgentsRead = true;
        if (/setup-benny\/SKILL\.md/i.test(resultBlob)) setupBennyRead = true;
      }
    }
  }
  return {
    sessionPath,
    forAgentsRead,
    setupBennyRead,
    packWrite,
    askedConflict,
    toolOrder: toolOrder.slice(0, 200),
    assistantJoined: assistantTexts.join('\n\n'),
  };
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await resetFixtureToSeed();
  if (side === 'pi') await ensurePiTrust();
  await writeFile(RULE_BACKUP, ruleBytes);

  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = setupPrompt(side);
  const before = await inspectMergeState(fixtureApp);
  const pollLog = [];
  let attempt;
  try {
    if (!(await pathExists(join(fixtureApp, forAgentsRel)))) {
      throw new Error(`FOR_AGENTS missing at ${join(fixtureApp, forAgentsRel)}`);
    }
    const liveDigest = await sha256(referenceRulePath);
    if (liveDigest !== LOCKED_FIXTURE_DIGEST) {
      throw new Error(
        `Aborting ${side}: reference rule digest ${liveDigest} != locked ${LOCKED_FIXTURE_DIGEST}`,
      );
    }
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
        const lines = await screenLines(attempt, GEOMETRY);
        const text = lines.join('\n');
        const done = await readDone(side);
        const afterSnap = await inspectMergeState(fixtureApp);
        if (
          done.exists ||
          afterSnap.destPresent.length > before.destPresent.length ||
          /STATUS=|merge-ok|automations\/benny/i.test(text)
        ) {
          pollLog.push({
            ts: new Date().toISOString(),
            doneExists: done.exists,
            doneStatus: done.status,
            destPresentCount: afterSnap.destPresent.length,
            missingRequired: afterSnap.missingRequired.length,
            destOnlyPreserved: afterSnap.destOnlyPreserved,
            localEditPreserved: afterSnap.localEditPreserved,
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
        [
          'STATUS=',
          'merge-ok',
          'FOR_AGENTS',
          'automations/benny',
          'DESTINATION_ONLY',
          LOCAL_EDIT_MARKER,
          'copied',
          'merged',
        ],
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
      const text = lines.join('\n');
      const done = await readDone(side);
      const working = /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text);
      if (done.exists && !working) {
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

    stopPoll.abort();
    await pollLoop.catch(() => {});

    const settledText = (await screenLines(attempt, GEOMETRY)).join('\n');
    const ptyText = stripAnsi(outputBytes(attempt.events()).toString('utf8'));
    const done = await readDone(side);
    const after = await inspectMergeState(fixtureApp);
    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      sessionSummary = await summarizePiSession(await findLatestPiSession());
    }

    const score = scorePackMerge({
      done,
      before,
      after,
      screenText: settledText,
      ptyText,
      sessionSummary,
    });

    const observations = {
      forAgentsRel: forAgentsRel.split(sep).join('/'),
      setupSkillRel: setupSkillRel.split(sep).join('/'),
      productRel: productRel.split(sep).join('/'),
      before,
      after,
      done,
      outcome: score.outcome,
      contractHeld: score.contractHeld,
      score: {
        productUnchanged: score.productUnchanged,
        userOwnedUnchanged: score.userOwnedUnchanged,
        requiredPresent: score.requiredPresent,
        allSourceCopied: score.allSourceCopied,
        destOnlyOk: score.destOnlyOk,
        localEditOk: score.localEditOk,
        askedAboutConflict: score.askedAboutConflict,
        mergeChrome: score.mergeChrome,
        missingRequired: score.missingRequired,
        missingSourceCopies: score.missingSourceCopies,
      },
      session: sessionSummary
        ? {
            sessionPath: sessionSummary.sessionPath,
            forAgentsRead: sessionSummary.forAgentsRead,
            setupBennyRead: sessionSummary.setupBennyRead,
            packWrite: sessionSummary.packWrite,
            askedConflict: sessionSummary.askedConflict,
            toolOrder: sessionSummary.toolOrder,
          }
        : null,
      pollSamples: pollLog.length,
      scorerNote:
        'merge_ok requires required pack files at destination, all source rel paths copied, DESTINATION_ONLY preserved, user-owned digests unchanged, and local README marker preserved (or stop-and-ask evidenced)',
    };

    const afterRule = await readFile(rulePath, 'utf8');
    const afterRuleDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), afterRule);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
    await writeFile(join(dir, 'poll-log.json'), `${JSON.stringify(pollLog, null, 2)}\n`);
    await writeFile(
      join(dir, 'merge-diff.json'),
      `${JSON.stringify({ before, after, score }, null, 2)}\n`,
    );
    if (done.exists) {
      await writeFile(join(dir, 'done-copy.txt'), `${done.line}\n`);
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
  }
}

async function selfTest() {
  const tmp = join(evidenceRoot, '.self-test-fixture');
  await rm(tmp, { recursive: true, force: true });
  const src = join(tmp, '.upstream', 'automations', 'benny');
  const dest = join(tmp, '.cursor', 'automations', 'benny');
  const user = join(tmp, '.cursor', 'benny');
  await mkdir(join(src, 'skills', 'setup-benny'), { recursive: true });
  await mkdir(join(src, 'skills', 'reproduce-and-fix-issues', 'references'), {
    recursive: true,
  });
  await mkdir(join(src, 'skills', 'triage-issue-reports', 'references'), { recursive: true });
  await mkdir(join(src, 'templates'), { recursive: true });
  await mkdir(dest, { recursive: true });
  await mkdir(user, { recursive: true });
  await mkdir(join(tmp, 'src'), { recursive: true });

  const writeTree = async (rootDir) => {
    await mkdir(join(rootDir, 'skills', 'setup-benny'), { recursive: true });
    await mkdir(join(rootDir, 'skills', 'reproduce-and-fix-issues', 'references'), {
      recursive: true,
    });
    await mkdir(join(rootDir, 'skills', 'triage-issue-reports', 'references'), {
      recursive: true,
    });
    await mkdir(join(rootDir, 'templates'), { recursive: true });
    await writeFile(join(rootDir, 'FOR_AGENTS.md'), 'agents\n');
    await writeFile(join(rootDir, 'README.md'), 'readme upstream\n');
    await writeFile(join(rootDir, 'skills', 'setup-benny', 'SKILL.md'), 'setup\n');
    await writeFile(
      join(rootDir, 'skills', 'reproduce-and-fix-issues', 'SKILL.md'),
      'repro\n',
    );
    await writeFile(
      join(rootDir, 'skills', 'reproduce-and-fix-issues', 'references', 'control-adapter.md'),
      'c\n',
    );
    await writeFile(
      join(rootDir, 'skills', 'reproduce-and-fix-issues', 'references', 'feature-map.example.md'),
      'f\n',
    );
    await writeFile(
      join(rootDir, 'skills', 'reproduce-and-fix-issues', 'references', 'verify-existing-fix.md'),
      'v\n',
    );
    await writeFile(join(rootDir, 'skills', 'triage-issue-reports', 'SKILL.md'), 'triage\n');
    await writeFile(
      join(rootDir, 'skills', 'triage-issue-reports', 'references', 'routing.example.md'),
      'r\n',
    );
    await writeFile(join(rootDir, 'templates', 'configuration.example.yaml'), 'cfg\n');
    await writeFile(join(rootDir, 'templates', 'reproduce-automation-prompt.md'), 'rp\n');
    await writeFile(join(rootDir, 'templates', 'triage-automation-prompt.md'), 'tp\n');
  };
  await writeTree(src);
  await writeFile(join(tmp, 'src', 'app.js'), 'product\n');
  await writeFile(
    join(dest, 'DESTINATION_ONLY.md'),
    `# Destination-only\n\n${DEST_ONLY_MARKER}\n`,
  );
  await writeFile(
    join(dest, 'README.md'),
    `readme upstream\n\n<!-- ${LOCAL_EDIT_MARKER}: keep -->\n`,
  );
  await writeFile(
    join(user, 'configuration.yaml'),
    `${USER_MARKERS[0]}: do-not-overwrite\n`,
  );
  await writeFile(join(user, 'feature-map.md'), `${USER_MARKERS[1]}\n`);
  await writeFile(join(user, 'routing.md'), `${USER_MARKERS[2]}\n`);

  const before = await inspectMergeState(tmp);
  // Simulate good merge
  await writeTree(dest);
  await writeFile(
    join(dest, 'DESTINATION_ONLY.md'),
    `# Destination-only\n\n${DEST_ONLY_MARKER}\n`,
  );
  await writeFile(
    join(dest, 'README.md'),
    `readme upstream\nmerged body\n\n<!-- ${LOCAL_EDIT_MARKER}: keep -->\n`,
  );
  const afterOk = await inspectMergeState(tmp);
  const pass = scorePackMerge({
    done: { exists: true, status: 'merge-ok', line: 'STATUS=merge-ok reason=ok' },
    before,
    after: afterOk,
    screenText: 'Merged into .cursor/automations/benny',
    ptyText: 'copied FOR_AGENTS.md',
    sessionSummary: { packWrite: true, askedConflict: false },
  });

  // Wipe dest-only -> mismatch
  await rm(join(dest, 'DESTINATION_ONLY.md'), { force: true });
  const afterBad = await inspectMergeState(tmp);
  const mismatch = scorePackMerge({
    done: { exists: true, status: 'merge-mismatch', line: 'STATUS=merge-mismatch reason=deleted' },
    before,
    after: afterBad,
    screenText: 'copied',
    ptyText: '',
    sessionSummary: { packWrite: true },
  });

  await rm(tmp, { recursive: true, force: true });
  const cases = [
    ['beforeMissing', before.missingRequired.length === REQUIRED_DEST_RELS.length],
    ['pass', pass.contractHeld === true && pass.outcome === 'merge_ok'],
    ['mismatch', mismatch.contractHeld === false && mismatch.outcome === 'merge_mismatch'],
    ['destOnlyOk', pass.destOnlyOk === true],
    ['localEditOk', pass.localEditOk === true],
  ];
  const failed = cases.filter(([, ok]) => !ok);
  console.log(JSON.stringify({ selfTest: failed.length === 0, cases }, null, 2));
  if (failed.length) process.exit(1);
}

if (isMain && only === '--self-test') {
  await selfTest();
  process.exit(0);
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
  if (!(await pathExists(join(fixtureApp, forAgentsRel)))) {
    console.error(`Fixture pack missing ${forAgentsRel}`);
    process.exit(1);
  }
  await mkdir(evidenceRoot, { recursive: true });

  const sides =
    only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
  const results = [];
  for (const side of sides) {
    const result = await runSide(side, preRule, preDigest);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await writeFile(
    join(evidenceRoot, 'capture-results.json'),
    `${JSON.stringify({ scenario: 'setup-benny-pack-merge', fixtureDigest: preDigest, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      scenario: 'setup-benny-pack-merge',
      fixtureDigest: preDigest,
      results,
    }),
  );
}
