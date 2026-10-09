#!/usr/bin/env node
// Family 05 figure-it-out pair: invoke /figure-it-out on a tiny multi-part note-store
// migration and observe whether a playbook (phases + falsifiable done predicate) lands
// before any product-code edit. Real PTY both sides via the recorder.
//
// Usage: node scripts/capture-figure-it-out-playbook-first.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/figure-it-out/
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
const evidenceRoot = join(root, 'evidence', 'figure-it-out');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;
const POLL_MS = 500;
const PRODUCT_REL = ['src/store.js', 'src/format.js', 'src/cli.js'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeRootFor(side) {
  return join(evidenceRoot, 'fixture-out', side);
}

function donePath(side) {
  return join(writeRootFor(side), 'done.txt');
}

function fioPrompt(side) {
  const out = donePath(side);
  // Residual after Pi strips the slash skill name must stay multi-part / migration shaped.
  return (
    `/figure-it-out this is a multi-part note-store migration I will review after stepping away. ` +
    `Persist notes from src/store.js into notes.json on disk, update src/format.js so every note line includes an ISO timestamp, ` +
    `and update src/cli.js to load from the persisted store before printing. ` +
    `Keep the public CLI behavior otherwise. ` +
    `Work only inside this fixture cwd. Do not edit ledgers, parity/, or files outside this cwd. ` +
    `When finished, write exactly one line to ${out} summarizing the falsifiable done predicate you used, then stop.`
  );
}

function isPlaybookPath(rel) {
  const lower = rel.toLowerCase();
  const base = lower.split('/').pop() ?? '';
  if (base === 'decisions.tsv' || base === 'decisions.md') return true;
  if (lower.includes('/.audit/') || lower.startsWith('.audit/')) return true;
  if (/(^|\/)playbook[^/]*\.md$/.test(lower)) return true;
  if (/(^|\/)workflow[^/]*\.md$/.test(lower)) return true;
  if (/(^|\/)phases?\.md$/.test(lower)) return true;
  if (/done.?predicate/.test(base) && base.endsWith('.md')) return true;
  return false;
}

function isProductPath(rel) {
  if (PRODUCT_REL.includes(rel)) return true;
  if (rel === 'notes.json') return true;
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
  // Product files are mutated in place by the agent; restore from the pristine copies
  // kept beside the fixture under fixture-baseline/ after first snapshot.
  const baselineDir = join(evidenceRoot, 'fixture-baseline');
  for (const rel of PRODUCT_REL) {
    const src = join(baselineDir, rel);
    const dst = join(fixtureApp, rel);
    if (await pathExists(src)) {
      await mkdir(dirname(dst), { recursive: true });
      await writeFile(dst, await readFile(src));
    }
  }
  await rm(join(fixtureApp, 'notes.json'), { force: true });
  const files = await walkFiles(fixtureApp);
  for (const rel of files) {
    if (rel === 'README.md' || PRODUCT_REL.includes(rel)) continue;
    if (isPlaybookPath(rel) || rel.endsWith('.tsv') || rel.startsWith('out/')) {
      await rm(join(fixtureApp, rel), { force: true, recursive: true });
    }
  }
  await rm(join(fixtureApp, '.audit'), { recursive: true, force: true });
  await rm(join(fixtureApp, 'out'), { recursive: true, force: true });
}

async function snapshotBaseline() {
  const baselineDir = join(evidenceRoot, 'fixture-baseline');
  for (const rel of PRODUCT_REL) {
    const dst = join(baselineDir, rel);
    await mkdir(dirname(dst), { recursive: true });
    await writeFile(dst, await readFile(join(fixtureApp, rel)));
  }
  await writeFile(join(baselineDir, 'README.md'), await readFile(join(fixtureApp, 'README.md')));
}

async function pollOnce(baseline, side) {
  const now = new Date().toISOString();
  const hits = { playbook: [], product: [], other: [] };
  const files = await walkFiles(fixtureApp);
  for (const rel of files) {
    if (rel === 'README.md') continue;
    const abs = join(fixtureApp, rel);
    if (isPlaybookPath(rel)) {
      hits.playbook.push(rel);
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
    // Agent may write playbook content under unexpected names; ignore done marker root.
  }
  // Also watch side-specific done marker and any playbook under fixture-out (not product).
  const outRoot = writeRootFor(side);
  if (await pathExists(outRoot)) {
    const outFiles = await walkFiles(outRoot);
    for (const rel of outFiles) {
      if (rel === 'done.txt') continue;
      if (isPlaybookPath(rel)) hits.playbook.push(`fixture-out/${side}/${rel}`);
    }
  }
  return { now, hits };
}

function classifyOrdering(firstPlaybookAt, firstProductAt, playbookPaths, productPaths) {
  if (firstPlaybookAt && firstProductAt) {
    return firstPlaybookAt <= firstProductAt ? 'playbook_before_product' : 'product_before_playbook';
  }
  if (firstPlaybookAt && !firstProductAt) return 'playbook_only';
  if (!firstPlaybookAt && firstProductAt) return 'product_only';
  if (playbookPaths.length || productPaths.length) return 'inconclusive';
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
    figureItOutSkill:
      /figure-it-out/i.test(text) ||
      /\[skill\]\s*figure-it-out/i.test(text) ||
      /Used figure-it-out/i.test(text),
    playbookMention: /playbook|done predicate|falsifiable|Phase [A-E0-9]|show-me-your-work|decisions\.tsv/i.test(
      text,
    ),
    productMention: /notes\.json|store\.js|format\.js|cli\.js|persist/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function playbookLooksStructured(body) {
  if (!body) return false;
  const hasPhase = /phase\s*[a-e0-9]|^\s*#{1,3}\s*phase/im.test(body) || /^\s*\d+\.\s+/m.test(body);
  const hasPredicate = /done predicate|falsifiable|definition of done|verify:/i.test(body);
  return hasPhase && hasPredicate;
}

async function inspectPlaybookFiles(paths) {
  const details = [];
  for (const rel of paths) {
    const filePath = rel.startsWith('fixture-out/') ? join(evidenceRoot, rel) : join(fixtureApp, rel);
    try {
      const body = await readFile(filePath, 'utf8');
      details.push({
        path: rel,
        structured: playbookLooksStructured(body),
        preview: body.slice(0, 400),
      });
    } catch {
      details.push({ path: rel, structured: false, preview: null });
    }
  }
  return details;
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'cmd-figure-it-out-playbook-first',
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
  const backupPath = `${referenceRulePath}.fio-playbook-first-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.fio-playbook-first-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await snapshotBaseline();
  await restoreProduct();
  const baseline = await baselineProduct();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = fioPrompt(side);
  const pollLog = [];
  let firstPlaybookAt = null;
  let firstProductAt = null;
  const playbookPaths = new Set();
  const productPaths = new Set();
  let attempt;
  try {
    await writeFile(rulePath, ruleBytes);
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(ruleDigest) : piSpec(ruleDigest));
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitEither(attempt, GEOMETRY, ['note-store', 'README', 'pi', 'store.js'], 120_000);
    }
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);

    const stopPoll = new AbortController();
    const pollLoop = (async () => {
      while (!stopPoll.signal.aborted) {
        const snap = await pollOnce(baseline, side);
        for (const p of snap.hits.playbook) {
          playbookPaths.add(p);
          if (!firstPlaybookAt) firstPlaybookAt = snap.now;
        }
        for (const p of snap.hits.product) {
          productPaths.add(p);
          if (!firstProductAt) firstProductAt = snap.now;
        }
        if (snap.hits.playbook.length || snap.hits.product.length) {
          pollLog.push({
            ts: snap.now,
            playbook: [...snap.hits.playbook],
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
        ['figure-it-out', 'playbook', 'Phase', 'done predicate', 'notes.json', 'store.js', 'falsifiable'],
        300_000,
      );
    } catch {
      // settle may still land artifacts
    }
    await dumpScreen(attempt, dir, '03-signal', GEOMETRY);

    // Prefer disk settle (done marker or playbook+product calm) then screen settle.
    const deadline = Date.now() + SETTLE_MS;
    let calm = 0;
    while (Date.now() < deadline) {
      const lines = await screenLines(attempt, GEOMETRY);
      const obs = observeScreen(lines);
      const done = await readDone(side);
      const hasPlaybook = playbookPaths.size > 0;
      const hasProduct = productPaths.size > 0;
      if ((done.exists || (hasPlaybook && hasProduct)) && !obs.working) {
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

    // Final poll
    const finalSnap = await pollOnce(baseline, side);
    for (const p of finalSnap.hits.playbook) {
      playbookPaths.add(p);
      if (!firstPlaybookAt) firstPlaybookAt = finalSnap.now;
    }
    for (const p of finalSnap.hits.product) {
      productPaths.add(p);
      if (!firstProductAt) firstProductAt = finalSnap.now;
    }

    const playbookList = [...playbookPaths];
    const productList = [...productPaths];
    const playbookDetails = await inspectPlaybookFiles(playbookList);
    const structuredPlaybook = playbookDetails.some((d) => d.structured);
    const ordering = classifyOrdering(firstPlaybookAt, firstProductAt, playbookList, productList);
    const observations = {
      screenFinal: observeScreen(await screenLines(attempt, GEOMETRY)),
      firstPlaybookAt,
      firstProductAt,
      playbookPaths: playbookList,
      productPaths: productList,
      playbookDetails,
      structuredPlaybook,
      ordering,
      playbookBeforeProduct: ordering === 'playbook_before_product',
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

    // Copy final product/playbook snapshots into attempt dir for the pair.
    const snapDir = join(attempt.dir, 'fixture-snapshot');
    await mkdir(snapDir, { recursive: true });
    for (const rel of [...PRODUCT_REL, 'notes.json', 'README.md']) {
      const abs = join(fixtureApp, rel);
      if (await pathExists(abs)) {
        await mkdir(dirname(join(snapDir, rel)), { recursive: true });
        await writeFile(join(snapDir, rel), await readFile(abs));
      }
    }
    for (const rel of playbookList) {
      if (rel.startsWith('fixture-out/')) continue;
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
    scenario: 'cmd-figure-it-out-playbook-first',
    fixtureDigest: preDigest,
    results,
  }),
);
