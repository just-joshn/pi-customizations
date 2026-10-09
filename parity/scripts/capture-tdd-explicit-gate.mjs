#!/usr/bin/env node
// Family 05 /tdd pair: invoke /tdd on a tiny clamp upper-bound bug and observe
// whether a focused failing test lands (and is run) before any product-code edit.
// Real PTY both sides via the recorder.
//
// Usage: node scripts/capture-tdd-explicit-gate.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/tdd/
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
const evidenceRoot = join(root, 'evidence', 'tdd');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;
const POLL_MS = 500;
const PRODUCT_REL = ['src/clamp.js'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeRootFor(side) {
  return join(evidenceRoot, 'fixture-out', side);
}

function donePath(side) {
  return join(writeRootFor(side), 'done.txt');
}

function tddPrompt(side) {
  const out = donePath(side);
  return (
    `/tdd write a focused failing regression test for the upper-bound bug in src/clamp.js ` +
    `(clamp(10, 0, 5) should return 5 but currently returns 10). ` +
    `Run the new test red first, then fix production code, then rerun green. ` +
    `Prefer node:test under test/. Work only inside this fixture cwd. ` +
    `Do not edit ledgers, parity/, or files outside this cwd. ` +
    `When finished, write exactly one line to ${out} naming the failing-before evidence ` +
    `(test path and failure signal), then stop.`
  );
}

function isTestPath(rel) {
  const lower = rel.toLowerCase();
  if (lower === 'test/.gitkeep') return false;
  if (lower.startsWith('test/') && lower.endsWith('.js')) return true;
  if (/\.test\.js$/.test(lower) || /\.spec\.js$/.test(lower)) return true;
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

async function baselineProduct() {
  const map = {};
  for (const rel of PRODUCT_REL) {
    const abs = join(fixtureApp, rel);
    map[rel] = await fileDigest(abs);
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
    if (rel === 'README.md' || rel === 'package.json' || PRODUCT_REL.includes(rel)) continue;
    if (rel === 'test/.gitkeep') continue;
    if (isTestPath(rel) || rel.endsWith('.tsv') || rel.startsWith('out/') || rel.startsWith('.audit/')) {
      await rm(join(fixtureApp, rel), { force: true, recursive: true });
    }
  }
  await rm(join(fixtureApp, '.audit'), { recursive: true, force: true });
  // Remove any stray test files left behind.
  const testDir = join(fixtureApp, 'test');
  if (await pathExists(testDir)) {
    const testFiles = await walkFiles(testDir);
    for (const rel of testFiles) {
      if (rel === '.gitkeep') continue;
      await rm(join(testDir, rel), { force: true });
    }
  }
}

async function snapshotBaseline() {
  const baselineDir = join(evidenceRoot, 'fixture-baseline');
  for (const rel of [...PRODUCT_REL, 'README.md', 'package.json']) {
    const dst = join(baselineDir, rel);
    await mkdir(dirname(dst), { recursive: true });
    await writeFile(dst, await readFile(join(fixtureApp, rel)));
  }
  await mkdir(join(baselineDir, 'test'), { recursive: true });
  await writeFile(join(baselineDir, 'test', '.gitkeep'), '');
}

async function pollOnce(baseline) {
  const now = new Date().toISOString();
  const hits = { test: [], product: [], other: [] };
  const files = await walkFiles(fixtureApp);
  for (const rel of files) {
    if (rel === 'README.md' || rel === 'package.json' || rel === 'test/.gitkeep') continue;
    const abs = join(fixtureApp, rel);
    if (isTestPath(rel)) {
      hits.test.push(rel);
      continue;
    }
    if (isProductPath(rel)) {
      if (PRODUCT_REL.includes(rel)) {
        const dig = await fileDigest(abs);
        if (dig !== baseline[rel]) hits.product.push(rel);
      } else {
        hits.product.push(rel);
      }
      continue;
    }
  }
  return { now, hits };
}

function classifyOrdering(firstTestAt, firstProductAt, testPaths, productPaths) {
  if (firstTestAt && firstProductAt) {
    return firstTestAt <= firstProductAt ? 'test_before_product' : 'product_before_test';
  }
  if (firstTestAt && !firstProductAt) return 'test_only';
  if (!firstTestAt && firstProductAt) return 'product_only';
  if (testPaths.length || productPaths.length) return 'inconclusive';
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
    tddSkill:
      /\/tdd\b/i.test(text) ||
      /\[skill\]\s*tdd/i.test(text) ||
      /\bUsed tdd\b/i.test(text) ||
      /\bTDD\b/.test(text),
    redSignal:
      /\bfail(ed|ing|ure)?\b/i.test(text) ||
      /\bAssertionError\b/i.test(text) ||
      /\bnot ok\b/i.test(text) ||
      /\bRED\b/.test(text),
    greenSignal:
      /\bpass(ed|ing)?\b/i.test(text) ||
      /\bok\b/i.test(text) ||
      /\bGREEN\b/.test(text),
    skipImpractical:
      /impractical|skip(?:ping)?\s+(?:tdd|the\s+test)|expensive|integration-heavy/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'cmd-tdd-explicit-gate',
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
  const backupPath = `${referenceRulePath}.tdd-explicit-gate-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.tdd-explicit-gate-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await snapshotBaseline();
  await restoreProduct();
  const baseline = await baselineProduct();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = tddPrompt(side);
  const pollLog = [];
  let firstTestAt = null;
  let firstProductAt = null;
  const testPaths = new Set();
  const productPaths = new Set();
  let attempt;
  try {
    await writeFile(rulePath, ruleBytes);
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(ruleDigest) : piSpec(ruleDigest));
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitEither(attempt, GEOMETRY, ['clamp', 'README', 'pi', 'clamp.js'], 120_000);
    }
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);

    const stopPoll = new AbortController();
    const pollLoop = (async () => {
      while (!stopPoll.signal.aborted) {
        const snap = await pollOnce(baseline);
        for (const p of snap.hits.test) {
          testPaths.add(p);
          if (!firstTestAt) firstTestAt = snap.now;
        }
        for (const p of snap.hits.product) {
          productPaths.add(p);
          if (!firstProductAt) firstProductAt = snap.now;
        }
        if (snap.hits.test.length || snap.hits.product.length) {
          pollLog.push({
            ts: snap.now,
            test: [...snap.hits.test],
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
        ['tdd', 'TDD', 'clamp', 'fail', 'test', 'AssertionError', 'not ok', 'regression'],
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
      const hasTest = testPaths.size > 0;
      const hasProduct = productPaths.size > 0;
      if ((done.exists || (hasTest && hasProduct) || obs.skipImpractical) && !obs.working) {
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
    for (const p of finalSnap.hits.test) {
      testPaths.add(p);
      if (!firstTestAt) firstTestAt = finalSnap.now;
    }
    for (const p of finalSnap.hits.product) {
      productPaths.add(p);
      if (!firstProductAt) firstProductAt = finalSnap.now;
    }

    const testList = [...testPaths];
    const productList = [...productPaths];
    const ordering = classifyOrdering(firstTestAt, firstProductAt, testList, productList);
    const screenFinal = observeScreen(await screenLines(attempt, GEOMETRY));
    const observations = {
      screenFinal,
      firstTestAt,
      firstProductAt,
      testPaths: testList,
      productPaths: productList,
      ordering,
      testBeforeProduct: ordering === 'test_before_product',
      redBeforeGreen:
        ordering === 'test_before_product' ||
        (screenFinal.skipImpractical && ordering === 'neither'),
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
      join(dir, 'baseline-product.json'),
      `${JSON.stringify(baseline, null, 2)}\n`,
    );

    const snapDir = join(attempt.dir, 'fixture-snapshot');
    await mkdir(snapDir, { recursive: true });
    for (const rel of [...PRODUCT_REL, 'README.md', 'package.json']) {
      const abs = join(fixtureApp, rel);
      if (await pathExists(abs)) {
        await mkdir(dirname(join(snapDir, rel)), { recursive: true });
        await writeFile(join(snapDir, rel), await readFile(abs));
      }
    }
    for (const rel of testList) {
      const abs = join(fixtureApp, rel);
      if (await pathExists(abs)) {
        const dest = join(snapDir, rel);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, await readFile(abs));
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
    scenario: 'cmd-tdd-explicit-gate',
    fixtureDigest: preDigest,
    results,
  }),
);
