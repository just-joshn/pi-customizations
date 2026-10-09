#!/usr/bin/env node
// Family 05 /technical-writing pair: invoke /technical-writing on a tiny greet
// README draft and observe whether layered Diátaxis-shaped docs land.
// Real PTY both sides via the recorder.
//
// Usage: node scripts/capture-technical-writing-docs.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/technical-writing/
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
const evidenceRoot = join(root, 'evidence', 'technical-writing');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;
const POLL_MS = 500;
const PRODUCT_REL = ['src/greet.js'];
const DOCS_SEED = ['README.md'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeRootFor(side) {
  return join(evidenceRoot, 'fixture-out', side);
}

function donePath(side) {
  return join(writeRootFor(side), 'done.txt');
}

function twPrompt(side) {
  const out = donePath(side);
  return (
    `/technical-writing rewrite the draft README.md into layered Diátaxis-shaped docs. ` +
    `Prefer a how-to-oriented README plus a short docs/reference.md for the greet CLI argv contract. ` +
    `Follow Diátaxis structure, Google developer style, STE instruction rules, and Global English. ` +
    `Work only inside this fixture cwd. Do not edit ledgers, parity/, or files outside this cwd. ` +
    `When finished, write exactly one line to ${out} naming the docs paths you wrote and which Diátaxis modes they use, then stop.`
  );
}

function isDocsPath(rel) {
  const lower = rel.toLowerCase();
  if (lower === 'readme.md') return true;
  if (lower.startsWith('docs/') && (lower.endsWith('.md') || lower.endsWith('.txt'))) return true;
  if (/(^|\/)(how-to|howto|tutorial|reference|explanation)[^/]*\.md$/.test(lower)) return true;
  return false;
}

function isProductPath(rel) {
  if (PRODUCT_REL.includes(rel)) return true;
  if (rel.startsWith('src/')) return true;
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

async function baselineDocs() {
  const map = {};
  for (const rel of DOCS_SEED) {
    const abs = join(fixtureApp, rel);
    map[rel] = await fileDigest(abs);
  }
  return map;
}

async function baselineProduct() {
  const map = {};
  for (const rel of PRODUCT_REL) {
    const abs = join(fixtureApp, rel);
    map[rel] = await fileDigest(abs);
  }
  return map;
}

async function restoreFixture() {
  const baselineDir = join(evidenceRoot, 'fixture-baseline');
  for (const rel of [...DOCS_SEED, ...PRODUCT_REL, 'package.json']) {
    const src = join(baselineDir, rel);
    const dst = join(fixtureApp, rel);
    if (await pathExists(src)) {
      await mkdir(dirname(dst), { recursive: true });
      await writeFile(dst, await readFile(src));
    }
  }
  await rm(join(fixtureApp, 'docs'), { recursive: true, force: true });
  const files = await walkFiles(fixtureApp);
  for (const rel of files) {
    if (DOCS_SEED.includes(rel) || PRODUCT_REL.includes(rel) || rel === 'package.json') continue;
    if (isDocsPath(rel) || rel.endsWith('.tsv') || rel.startsWith('out/') || rel.startsWith('.audit/')) {
      await rm(join(fixtureApp, rel), { force: true, recursive: true });
    }
  }
  await rm(join(fixtureApp, '.audit'), { recursive: true, force: true });
  await rm(join(fixtureApp, 'out'), { recursive: true, force: true });
}

async function snapshotBaseline() {
  const baselineDir = join(evidenceRoot, 'fixture-baseline');
  for (const rel of [...DOCS_SEED, ...PRODUCT_REL, 'package.json']) {
    const dst = join(baselineDir, rel);
    await mkdir(dirname(dst), { recursive: true });
    await writeFile(dst, await readFile(join(fixtureApp, rel)));
  }
}

async function pollOnce(docsBaseline, productBaseline) {
  const now = new Date().toISOString();
  const hits = { docs: [], product: [] };
  const files = await walkFiles(fixtureApp);
  for (const rel of files) {
    if (rel === 'package.json') continue;
    const abs = join(fixtureApp, rel);
    if (isDocsPath(rel)) {
      if (DOCS_SEED.includes(rel)) {
        const dig = await fileDigest(abs);
        if (dig !== docsBaseline[rel]) hits.docs.push(rel);
      } else {
        hits.docs.push(rel);
      }
      continue;
    }
    if (isProductPath(rel)) {
      if (PRODUCT_REL.includes(rel)) {
        const dig = await fileDigest(abs);
        if (dig !== productBaseline[rel]) hits.product.push(rel);
      } else {
        hits.product.push(rel);
      }
    }
  }
  return { now, hits };
}

function diataxisSignals(text) {
  const modes = [];
  if (/\bhow[- ]?to\b/i.test(text) || /\bhow to\b/i.test(text)) modes.push('how-to');
  if (/\breference\b/i.test(text)) modes.push('reference');
  if (/\btutorial\b/i.test(text)) modes.push('tutorial');
  if (/\bexplanation\b/i.test(text) || /\babout\b/i.test(text)) modes.push('explanation');
  if (/\bdi[aá]taxis\b/i.test(text)) modes.push('diataxis-named');
  return [...new Set(modes)];
}

async function scoreDocsBodies(docsPaths) {
  const bodies = [];
  for (const rel of docsPaths) {
    const abs = join(fixtureApp, rel);
    if (!(await pathExists(abs))) continue;
    const text = await readFile(abs, 'utf8');
    bodies.push({ path: rel, modes: diataxisSignals(text), bytes: text.length });
  }
  const modeSet = new Set(bodies.flatMap((b) => b.modes));
  const hasHowTo = modeSet.has('how-to');
  const hasReference = modeSet.has('reference') || docsPaths.some((p) => /reference/i.test(p));
  const layered = bodies.length >= 1 && (hasHowTo || hasReference) && (bodies.length >= 2 || modeSet.size >= 2);
  return { bodies, modes: [...modeSet], layered, hasHowTo, hasReference };
}

function classifyOutcome({ skill, docsPaths, layered, firstDocsAt }) {
  if (skill && layered && docsPaths.length) return 'structured_docs';
  if (skill && docsPaths.length && !layered) return 'docs_unstructured';
  if (skill && !docsPaths.length) return 'skill_only';
  if (!skill && layered) return 'structured_without_skill_signal';
  if (firstDocsAt || docsPaths.length) return 'inconclusive';
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
    technicalWritingSkill:
      /\/technical-writing\b/i.test(text) ||
      /\[skill\]\s*technical-writing/i.test(text) ||
      /\bUsed technical-writing\b/i.test(text) ||
      /\btechnical[- ]writing\b/i.test(text) ||
      /\bDi[aá]taxis\b/i.test(text),
    diataxisMention: /\bDi[aá]taxis\b/i.test(text),
    modes: diataxisSignals(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'cmd-technical-writing-docs',
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
  const backupPath = `${referenceRulePath}.tech-writing-docs-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.tech-writing-docs-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await snapshotBaseline();
  await restoreFixture();
  const docsBaseline = await baselineDocs();
  const productBaseline = await baselineProduct();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = twPrompt(side);
  const pollLog = [];
  let firstDocsAt = null;
  let firstProductAt = null;
  const docsPaths = new Set();
  const productPaths = new Set();
  let attempt;
  try {
    await writeFile(rulePath, ruleBytes);
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(ruleDigest) : piSpec(ruleDigest));
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitEither(attempt, GEOMETRY, ['greet', 'README', 'pi', 'greet.js'], 120_000);
    }
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);

    const stopPoll = new AbortController();
    const pollLoop = (async () => {
      while (!stopPoll.signal.aborted) {
        const snap = await pollOnce(docsBaseline, productBaseline);
        for (const p of snap.hits.docs) {
          docsPaths.add(p);
          if (!firstDocsAt) firstDocsAt = snap.now;
        }
        for (const p of snap.hits.product) {
          productPaths.add(p);
          if (!firstProductAt) firstProductAt = snap.now;
        }
        if (snap.hits.docs.length || snap.hits.product.length) {
          pollLog.push({
            ts: snap.now,
            docs: [...snap.hits.docs],
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
        ['technical-writing', 'Diátaxis', 'Diataxis', 'how-to', 'reference', 'README', 'docs/'],
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
      const hasDocs = docsPaths.size > 0;
      if ((done.exists || hasDocs) && !obs.working) {
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

    const finalSnap = await pollOnce(docsBaseline, productBaseline);
    for (const p of finalSnap.hits.docs) {
      docsPaths.add(p);
      if (!firstDocsAt) firstDocsAt = finalSnap.now;
    }
    for (const p of finalSnap.hits.product) {
      productPaths.add(p);
      if (!firstProductAt) firstProductAt = finalSnap.now;
    }

    const docsList = [...docsPaths];
    const productList = [...productPaths];
    const docsScore = await scoreDocsBodies(docsList);
    const screenFinal = observeScreen(await screenLines(attempt, GEOMETRY));
    const outcome = classifyOutcome({
      skill: screenFinal.technicalWritingSkill,
      docsPaths: docsList,
      layered: docsScore.layered,
      firstDocsAt,
    });
    const observations = {
      screenFinal,
      firstDocsAt,
      firstProductAt,
      docsPaths: docsList,
      productPaths: productList,
      docsScore,
      outcome,
      structuredDocs: outcome === 'structured_docs' || outcome === 'structured_without_skill_signal',
      technicalWritingSkill: screenFinal.technicalWritingSkill,
      done: await readDone(side),
      pollSamples: pollLog.length,
    };

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
    await writeFile(join(dir, 'poll-log.json'), `${JSON.stringify(pollLog, null, 2)}\n`);
    await writeFile(
      join(dir, 'baseline-docs.json'),
      `${JSON.stringify(docsBaseline, null, 2)}\n`,
    );

    const snapDir = join(attempt.dir, 'fixture-snapshot');
    await mkdir(snapDir, { recursive: true });
    for (const rel of [...DOCS_SEED, ...PRODUCT_REL, 'package.json', ...docsList]) {
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
    scenario: 'cmd-technical-writing-docs',
    fixtureDigest: preDigest,
    results,
  }),
);
