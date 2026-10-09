#!/usr/bin/env node
// Capture /show-me-your-work TSV trail on a tiny two-phase greet fixture.
// Real PTY both sides via the recorder.
//
// Usage: node scripts/capture-show-me-your-work-tsv.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/show-me-your-work/
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { outputBytes, startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'show-me-your-work');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;
const POLL_MS = 400;
const PRODUCT_REL = ['src/greet.js'];
const EXPECTED_HEADER = ['ts', 'phase', 'decision', 'why', 'evidence', 'result'];

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

function smywPrompt(side) {
  const out = donePath(side);
  return (
    `/show-me-your-work this is a multi-phase run I will review after stepping away. ` +
    `Phase 1: change src/greet.js so greet() returns "hello" instead of "hi". ` +
    `Phase 2: add farewell() to src/greet.js that returns "bye". ` +
    `Keep one canonical TSV decision log at decisions.tsv in this fixture cwd ` +
    `(columns ts, phase, decision, why, evidence, result); one row per phase decision; ` +
    `evidence cells must be file pointers, not prose. Local only; do not commit. ` +
    `Work only inside this fixture cwd. Do not edit ledgers, parity/, or files outside this cwd. ` +
    `When finished, write exactly one line to ${out} naming the TSV path and data-row count, then stop.`
  );
}

function isProductPath(rel) {
  if (PRODUCT_REL.includes(rel)) return true;
  if (rel.startsWith('src/')) return true;
  return false;
}

function isTrailPath(rel) {
  const lower = rel.toLowerCase();
  const base = lower.split('/').pop() ?? '';
  if (base === 'decisions.tsv') return true;
  if (lower.includes('/.audit/') || lower.startsWith('.audit/')) return lower.endsWith('.tsv');
  return false;
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

async function baselineProduct() {
  const map = {};
  for (const rel of PRODUCT_REL) {
    map[rel] = await fileDigest(join(fixtureApp, rel));
  }
  return map;
}

async function restoreProduct() {
  const baselineDir = join(evidenceRoot, 'fixture-baseline');
  for (const rel of PRODUCT_REL) {
    const src = join(baselineDir, rel);
    const dst = join(fixtureApp, rel);
    if (await pathExists(src)) {
      await mkdir(dirname(dst), { recursive: true });
      await writeFile(dst, await readFile(src));
    }
  }
  const files = await walkFiles(fixtureApp);
  for (const rel of files) {
    if (rel === 'README.md' || PRODUCT_REL.includes(rel)) continue;
    if (isTrailPath(rel) || rel.endsWith('.tsv') || rel.startsWith('out/') || rel.startsWith('.audit/')) {
      await rm(join(fixtureApp, rel), { force: true, recursive: true });
    }
  }
  await rm(join(fixtureApp, '.audit'), { recursive: true, force: true });
  await rm(join(fixtureApp, 'out'), { recursive: true, force: true });
  await rm(join(fixtureApp, 'decisions.tsv'), { force: true });
  await rm(join(fixtureApp, 'PLAYBOOK.md'), { force: true });
}

async function snapshotBaseline() {
  const baselineDir = join(evidenceRoot, 'fixture-baseline');
  for (const rel of [...PRODUCT_REL, 'README.md']) {
    const dst = join(baselineDir, rel);
    await mkdir(dirname(dst), { recursive: true });
    await writeFile(dst, await readFile(join(fixtureApp, rel)));
  }
}

function parseTsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { header: [], rows: [], okHeader: false, dataRowCount: 0, proseEvidence: [], missingCols: EXPECTED_HEADER };
  }
  const header = lines[0].split('\t');
  const missingCols = EXPECTED_HEADER.filter((c) => !header.includes(c));
  const okHeader = missingCols.length === 0;
  const rows = [];
  const proseEvidence = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = cols[j] ?? '';
    rows.push(row);
    const ev = row.evidence ?? '';
    const wordCount = ev.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount > 8 || (ev.includes(' ') && !/[./\\:]/.test(ev) && wordCount > 3)) {
      proseEvidence.push({ row: i, evidence: ev });
    }
  }
  return { header, rows, okHeader, dataRowCount: rows.length, proseEvidence, missingCols };
}

async function findTrailFiles() {
  const files = await walkFiles(fixtureApp);
  return files.filter((rel) => isTrailPath(rel));
}

async function readBestTrail() {
  const trails = await findTrailFiles();
  const preferred = trails.find((t) => t === 'decisions.tsv') ?? trails[0] ?? null;
  if (!preferred) return { exists: false, path: null, rel: null, text: null, parsed: null };
  const abs = join(fixtureApp, preferred);
  const text = await readFile(abs, 'utf8');
  return { exists: true, path: abs, rel: preferred, text, parsed: parseTsv(text) };
}

async function pollOnce(baseline) {
  const now = new Date().toISOString();
  const hits = { trail: [], product: [] };
  const files = await walkFiles(fixtureApp);
  for (const rel of files) {
    if (rel === 'README.md') continue;
    if (isTrailPath(rel)) {
      hits.trail.push(rel);
      continue;
    }
    if (!isProductPath(rel)) continue;
    if (PRODUCT_REL.includes(rel)) {
      const dig = await fileDigest(join(fixtureApp, rel));
      if (dig !== baseline[rel]) hits.product.push(rel);
    } else {
      hits.product.push(rel);
    }
  }
  return { now, hits };
}

function observeScreen(text) {
  return {
    showMeYourWork:
      /\/show-me-your-work\b/i.test(text) ||
      /\[skill\]\s*show-me-your-work/i.test(text) ||
      /\bshow-me-your-work\b/i.test(text) ||
      /\bUsed show-me-your-work\b/i.test(text),
    decisionsTsv: /decisions\.tsv/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function scoreTrail(parsed) {
  if (!parsed) {
    return {
      contractHeld: false,
      reason: 'no_tsv',
      hasPrescribedColumns: false,
      dataRowCount: 0,
      evidencePointersOk: false,
    };
  }
  const evidencePointersOk = parsed.proseEvidence.length === 0;
  const contractHeld = parsed.okHeader && parsed.dataRowCount >= 1 && evidencePointersOk;
  return {
    contractHeld,
    reason: contractHeld
      ? 'ok'
      : !parsed.okHeader
        ? 'bad_header'
        : parsed.dataRowCount < 1
          ? 'no_data_rows'
          : 'prose_evidence',
    hasPrescribedColumns: parsed.okHeader,
    dataRowCount: parsed.dataRowCount,
    evidencePointersOk,
    missingCols: parsed.missingCols,
    proseEvidence: parsed.proseEvidence,
  };
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
    scenarioRef: 'cmd-show-me-your-work-tsv',
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
  const backupPath = `${referenceRulePath}.smyw-tsv-backup`;
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
      (/fixture-app|Skill conflicts|greet|medium|README/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function snapshotTrailTo(side, attemptDir, trail) {
  const outRoot = writeRootFor(side);
  await mkdir(outRoot, { recursive: true });
  if (trail.exists && trail.text != null) {
    await writeFile(join(outRoot, 'decisions.tsv'), trail.text);
    if (attemptDir) {
      const snapDir = join(attemptDir, 'fixture-snapshot');
      await mkdir(snapDir, { recursive: true });
      await writeFile(join(snapDir, trail.rel || 'decisions.tsv'), trail.text);
      for (const rel of PRODUCT_REL) {
        const abs = join(fixtureApp, rel);
        if (await pathExists(abs)) {
          await mkdir(dirname(join(snapDir, rel)), { recursive: true });
          await writeFile(join(snapDir, rel), await readFile(abs));
        }
      }
      if (await pathExists(join(fixtureApp, 'README.md'))) {
        await writeFile(join(snapDir, 'README.md'), await readFile(join(fixtureApp, 'README.md')));
      }
    }
  }
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.smyw-tsv-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await snapshotBaseline();
  await restoreProduct();
  if (side === 'pi') await ensurePiTrust();
  const baseline = await baselineProduct();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = smywPrompt(side);
  const pollLog = [];
  let firstTrailAt = null;
  let firstProductAt = null;
  const trailPaths = new Set();
  const productPaths = new Set();
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
        const snap = await pollOnce(baseline);
        if (snap.hits.trail.length || snap.hits.product.length) {
          for (const t of snap.hits.trail) {
            trailPaths.add(t);
            if (!firstTrailAt) firstTrailAt = snap.now;
          }
          for (const p of snap.hits.product) {
            productPaths.add(p);
            if (!firstProductAt) firstProductAt = snap.now;
          }
          pollLog.push({
            ts: snap.now,
            trail: [...snap.hits.trail],
            product: [...snap.hits.product],
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
        ['show-me-your-work', 'decisions.tsv', 'farewell', 'hello', 'phase', 'TSV', 'decision'],
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
      const obs = observeScreen(lines.join('\n'));
      const done = await readDone(side);
      const trail = await readBestTrail();
      const scored = scoreTrail(trail.parsed);
      const enough =
        done.exists ||
        (scored.contractHeld && productPaths.size > 0) ||
        (scored.dataRowCount >= 1 && !obs.working && firstTrailAt && Date.now() - Date.parse(firstTrailAt) > 60_000);
      if (enough && !obs.working) {
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

    const finalSnap = await pollOnce(baseline);
    for (const t of finalSnap.hits.trail) {
      trailPaths.add(t);
      if (!firstTrailAt) firstTrailAt = finalSnap.now;
    }
    for (const p of finalSnap.hits.product) {
      productPaths.add(p);
      if (!firstProductAt) firstProductAt = finalSnap.now;
    }

    const trail = await readBestTrail();
    const scored = scoreTrail(trail.parsed);
    await snapshotTrailTo(side, attempt.dir, trail);

    const screenFinal = observeScreen((await screenLines(attempt, GEOMETRY)).join('\n'));
    const ptyObs = observeScreen(stripAnsi(outputBytes(attempt.events()).toString('utf8')));

    const observations = {
      screenFinal,
      pty: ptyObs,
      firstTrailAt,
      firstProductAt,
      trailPaths: [...trailPaths],
      productPaths: [...productPaths],
      trail: trail.exists
        ? {
            rel: trail.rel,
            path: trail.path,
            header: trail.parsed?.header ?? [],
            dataRowCount: trail.parsed?.dataRowCount ?? 0,
            rows: trail.parsed?.rows ?? [],
          }
        : null,
      score: scored,
      showMeYourWorkSkill: screenFinal.showMeYourWork,
      done: await readDone(side),
      pollSamples: pollLog.length,
    };

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
    await writeFile(join(dir, 'poll-log.json'), `${JSON.stringify(pollLog, null, 2)}\n`);
    if (trail.exists && trail.text != null) {
      await writeFile(join(dir, 'decisions-after.tsv'), trail.text);
    }

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
    await restoreProduct();
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
    scenario: 'cmd-show-me-your-work-tsv',
    fixtureDigest: preDigest,
    results,
  }),
);
