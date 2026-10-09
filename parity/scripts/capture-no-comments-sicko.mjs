#!/usr/bin/env node
// Family 05 /no-comments pair: invoke /no-comments on a tiny file with obvious
// AI comments and observe Comment Sicko spawn plus cleanup / first-output.
// Real PTY both sides via the recorder.
//
// Usage: node scripts/capture-no-comments-sicko.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/no-comments/
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
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
const evidenceRoot = join(root, 'evidence', 'no-comments');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;
const POLL_MS = 400;
const PRODUCT_REL = ['src/greet.js'];
const CATCHPHRASE = 'Yes... Ha ha ha... Yes!';

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

function noCommentsPrompt(side) {
  const out = donePath(side);
  return (
    `/no-comments clean the AI slop comments in src/greet.js. ` +
    `Scope is only that file. Work only inside this fixture cwd. ` +
    `Do not edit ledgers, parity/, or files outside this cwd. ` +
    `When finished, write exactly one line to ${out} with delete-count=` +
    `<n> sicko=<yes|no> catchphrase=<yes|no>, then stop.`
  );
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
    if (rel.endsWith('.tsv') || rel.startsWith('out/') || rel.startsWith('.audit/')) {
      await rm(join(fixtureApp, rel), { force: true, recursive: true });
    }
  }
  await rm(join(fixtureApp, '.audit'), { recursive: true, force: true });
  await rm(join(fixtureApp, 'out'), { recursive: true, force: true });
}

async function snapshotBaseline() {
  const baselineDir = join(evidenceRoot, 'fixture-baseline');
  for (const rel of [...PRODUCT_REL, 'README.md', 'package.json']) {
    const dst = join(baselineDir, rel);
    await mkdir(dirname(dst), { recursive: true });
    await writeFile(dst, await readFile(join(fixtureApp, rel)));
  }
}

async function pollProductOnce(baseline) {
  const now = new Date().toISOString();
  const hits = { product: [] };
  const files = await walkFiles(fixtureApp);
  for (const rel of files) {
    if (rel === 'README.md' || rel === 'package.json') continue;
    const abs = join(fixtureApp, rel);
    if (!isProductPath(rel)) continue;
    if (PRODUCT_REL.includes(rel)) {
      const dig = await fileDigest(abs);
      if (dig !== baseline[rel]) hits.product.push(rel);
    } else {
      hits.product.push(rel);
    }
  }
  return { now, hits };
}

function countLineComments(source) {
  return source.split('\n').filter((line) => /^\s*\/\//.test(line)).length;
}

function observeSignals(text) {
  const noCommentsSkill =
    /\/no-comments\b/i.test(text) ||
    /\[skill\]\s*no-comments/i.test(text) ||
    /\bUsed no-comments\b/i.test(text) ||
    /\bno-comments\b/i.test(text);
  const commentSicko =
    /Comment Sicko/i.test(text) ||
    /comment-sicko/i.test(text) ||
    /subagent_type["']?\s*[:=]\s*["']?Comment Sicko/i.test(text);
  const taskSpawn =
    /\bTask\b/.test(text) &&
    (/Comment Sicko/i.test(text) || /subagent/i.test(text) || /Running subagent/i.test(text));
  const catchphrase = text.includes(CATCHPHRASE) || /Yes\.\.\.\s*Ha ha ha\.\.\.\s*Yes!/i.test(text);
  const working = /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text);
  return {
    noCommentsSkill,
    commentSicko,
    taskSpawn,
    catchphrase,
    sickoPath: commentSicko || taskSpawn,
    working,
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
    scenarioRef: 'cmd-no-comments-sicko',
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
  const backupPath = `${referenceRulePath}.no-comments-sicko-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'no-comments-fixture-app';
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
  let sickoTask = false;
  let catchphraseSeen = false;
  let firstProductWriteAt = null;
  let skillInjected = false;
  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = o.timestamp || o.message?.timestamp || null;
    const msg = o.message || o;
    const content = msg.content;
    const blob = JSON.stringify(o);
    if (blob.includes('no-comments') && /skill/i.test(blob)) skillInjected = true;
    if (blob.includes(CATCHPHRASE)) catchphraseSeen = true;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type === 'toolCall' || part.type === 'tool_use') {
        const name = part.name || part.toolName || '';
        const args = part.arguments || part.input || {};
        toolOrder.push(name);
        const argBlob = JSON.stringify(args);
        if (
          (name === 'Task' || name === 'Agent' || /task/i.test(name)) &&
          /Comment Sicko|comment-sicko/i.test(argBlob)
        ) {
          sickoTask = true;
        }
        if (['write', 'edit', 'bash'].includes(name)) {
          if (/src\/greet\.js|greet\.js/.test(argBlob) && !firstProductWriteAt) {
            firstProductWriteAt = ts;
          }
        }
      }
    }
  }
  return {
    sessionPath,
    sickoTask,
    catchphraseSeen,
    firstProductWriteAt,
    skillInjected,
    toolOrder: toolOrder.slice(0, 50),
  };
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.no-comments-sicko-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await snapshotBaseline();
  await restoreProduct();
  const baseline = await baselineProduct();
  const baselineSource = await readFile(join(fixtureApp, PRODUCT_REL[0]), 'utf8');
  const baselineCommentCount = countLineComments(baselineSource);
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = noCommentsPrompt(side);
  const pollLog = [];
  let firstSickoAt = null;
  let firstCatchphraseAt = null;
  let firstProductAt = null;
  let firstSkillAt = null;
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
        const now = new Date().toISOString();
        const lines = await screenLines(attempt, GEOMETRY);
        const screenObs = observeSignals(lines.join('\n'));
        if (screenObs.noCommentsSkill && !firstSkillAt) firstSkillAt = now;
        if (screenObs.sickoPath && !firstSickoAt) firstSickoAt = now;
        if (screenObs.catchphrase && !firstCatchphraseAt) firstCatchphraseAt = now;
        const snap = await pollProductOnce(baseline);
        for (const p of snap.hits.product) {
          productPaths.add(p);
          if (!firstProductAt) firstProductAt = snap.now;
        }
        if (screenObs.sickoPath || screenObs.catchphrase || snap.hits.product.length) {
          pollLog.push({
            ts: now,
            sickoPath: screenObs.sickoPath,
            catchphrase: screenObs.catchphrase,
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
        ['no-comments', 'Comment Sicko', 'Ha ha ha', 'greet.js', 'Running subagent', 'Task'],
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
      const done = await readDone(side);
      const hasProduct = productPaths.size > 0;
      const enough =
        done.exists ||
        (firstSickoAt && hasProduct) ||
        (hasProduct && !obs.working && firstProductAt && Date.now() - Date.parse(firstProductAt) > 120_000) ||
        (firstSickoAt && !obs.working && Date.now() - Date.parse(firstSickoAt) > 240_000);
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

    const finalSnap = await pollProductOnce(baseline);
    for (const p of finalSnap.hits.product) {
      productPaths.add(p);
      if (!firstProductAt) firstProductAt = finalSnap.now;
    }

    const ptyText = stripAnsi(outputBytes(attempt.events()).toString('utf8'));
    const ptyObs = observeSignals(ptyText);
    if (ptyObs.noCommentsSkill && !firstSkillAt) firstSkillAt = new Date().toISOString();
    if (ptyObs.sickoPath && !firstSickoAt) firstSickoAt = firstProductAt || new Date().toISOString();
    if (ptyObs.catchphrase && !firstCatchphraseAt) firstCatchphraseAt = firstSickoAt || new Date().toISOString();

    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      const sessionPath = await findLatestPiSession();
      sessionSummary = await summarizePiSession(sessionPath);
      if (sessionSummary?.sickoTask && !firstSickoAt) {
        firstSickoAt = sessionSummary.firstProductWriteAt || new Date().toISOString();
      }
      if (sessionSummary?.catchphraseSeen && !firstCatchphraseAt) {
        firstCatchphraseAt = firstSickoAt || new Date().toISOString();
      }
      if (sessionSummary?.firstProductWriteAt && !firstProductAt) {
        firstProductAt = sessionSummary.firstProductWriteAt;
      }
    }

    const afterSource = await readFile(join(fixtureApp, PRODUCT_REL[0]), 'utf8');
    const afterCommentCount = countLineComments(afterSource);
    const commentsRemoved = afterCommentCount < baselineCommentCount;
    const productList = [...productPaths];
    const screenFinal = observeSignals((await screenLines(attempt, GEOMETRY)).join('\n'));
    const done = await readDone(side);

    const sickoSpawned = Boolean(
      firstSickoAt || ptyObs.sickoPath || screenFinal.sickoPath || sessionSummary?.sickoTask,
    );
    const catchphraseObserved = Boolean(
      firstCatchphraseAt || ptyObs.catchphrase || screenFinal.catchphrase || sessionSummary?.catchphraseSeen,
    );
    const skillActivated = Boolean(
      firstSkillAt || ptyObs.noCommentsSkill || screenFinal.noCommentsSkill || sessionSummary?.skillInjected,
    );

    const observations = {
      screenFinal,
      pty: {
        noCommentsSkill: ptyObs.noCommentsSkill,
        sickoPath: ptyObs.sickoPath,
        catchphrase: ptyObs.catchphrase,
        commentSicko: ptyObs.commentSicko,
        taskSpawn: ptyObs.taskSpawn,
      },
      firstSkillAt,
      firstSickoAt,
      firstCatchphraseAt,
      firstProductAt,
      productPaths: productList,
      baselineCommentCount,
      afterCommentCount,
      commentsRemoved,
      skillActivated,
      sickoSpawned,
      catchphraseObserved,
      cleanupHeld: commentsRemoved && productList.includes(PRODUCT_REL[0]),
      done,
      pollSamples: pollLog.length,
      session: sessionSummary,
    };

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
    await writeFile(join(dir, 'poll-log.json'), `${JSON.stringify(pollLog, null, 2)}\n`);
    await writeFile(join(dir, 'baseline-product.json'), `${JSON.stringify(baseline, null, 2)}\n`);
    await writeFile(join(dir, 'greet-after.js'), afterSource);

    const snapDir = join(attempt.dir, 'fixture-snapshot');
    await mkdir(snapDir, { recursive: true });
    for (const rel of [...PRODUCT_REL, 'README.md', 'package.json']) {
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
    scenario: 'cmd-no-comments-sicko',
    fixtureDigest: preDigest,
    results,
  }),
);
