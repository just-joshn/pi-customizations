#!/usr/bin/env node
// Family 05 /poteto-mode pair: invoke /poteto-mode on a tiny off-by-one and observe
// whether a todolist whose first items are matched-playbook steps appears before any
// product-code edit. Real PTY both sides via the recorder.
//
// Usage: node scripts/capture-poteto-playbook-todo.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/poteto-playbook/
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
const evidenceRoot = join(root, 'evidence', 'poteto-playbook');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;
const POLL_MS = 400;
const PRODUCT_REL = ['src/inc.js'];

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

function potetoPrompt(side) {
  const out = donePath(side);
  return (
    `/poteto-mode fix the off-by-one in src/inc.js so that inc(3) returns 4 ` +
    `(it currently returns 3). Work only inside this fixture cwd. ` +
    `Do not edit ledgers, parity/, or files outside this cwd. ` +
    `When finished, write exactly one line to ${out} naming the playbook you matched, then stop.`
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
  await rm(join(fixtureApp, 'PLAYBOOK.md'), { force: true });
  await rm(join(fixtureApp, 'decisions.tsv'), { force: true });
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

function playbookStepSignals(text) {
  const signals = [];
  const checks = [
    ['bug_fix', /Reproduce it yourself|Binary-search the cause|Plan the fix|Verify on the same surface|Opening a PR/i],
    ['feature', /throughput checkpoint|Blocking first steps|Independent workstreams|architect/i],
    ['figure_it_out', /Phase [A-E]\b|falsifiable done predicate|show-me-your-work/i],
    ['refactoring', /Pin the behavior contract|characterization test|Subtract before you add/i],
    ['prototype', /Scope the decision|throwaway|scratch dir/i],
    ['tdd', /\bRED\b|\bGREEN\b|failing regression|red before green/i],
  ];
  for (const [name, re] of checks) {
    if (re.test(text)) signals.push(name);
  }
  return signals;
}

function observeTodoText(text) {
  const todoTool =
    /\bTodoWrite\b/i.test(text) ||
    /\bTaskCreate\b/i.test(text) ||
    /\btodolist\b/i.test(text) ||
    /\bTODO list\b/i.test(text);
  const checklist =
    /(?:^|\n)\s*(?:[-*○◐●]|\[\s?[xX ]?\])\s+.+/m.test(text) &&
    /Phase |Reproduce|playbook|skip:/i.test(text);
  const playbooks = playbookStepSignals(text);
  return {
    todoTool,
    checklist,
    playbookSignals: playbooks,
    playbookStepsVisible: playbooks.length > 0,
    todoVisible: todoTool || checklist || playbooks.length > 0,
    potetoMode:
      /\/poteto-mode\b/i.test(text) ||
      /\[skill\]\s*poteto-mode/i.test(text) ||
      /\bUsed poteto-mode\b/i.test(text) ||
      /\bpoteto-mode\b/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function classifyOrdering(firstTodoAt, firstProductAt, todoSeen, productPaths) {
  if (firstTodoAt && firstProductAt) {
    return firstTodoAt <= firstProductAt ? 'todo_before_product' : 'product_before_todo';
  }
  if (firstTodoAt && !firstProductAt) return 'todo_only';
  if (!firstTodoAt && firstProductAt) return 'product_only';
  if (todoSeen || productPaths.length) return 'inconclusive';
  return 'neither';
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
    scenarioRef: 'cmd-poteto-playbook-todo',
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
  const backupPath = `${referenceRulePath}.poteto-playbook-todo-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'poteto-playbook-fixture-app';
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
  let firstTodoWriteAt = null;
  let firstProductWriteAt = null;
  let firstTodoContents = [];
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
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type === 'toolCall' || part.type === 'tool_use') {
        const name = part.name || part.toolName || '';
        const args = part.arguments || part.input || {};
        toolOrder.push(name);
        if (name === 'TodoWrite' && !firstTodoWriteAt) {
          firstTodoWriteAt = ts;
          const todos = args.todos || [];
          firstTodoContents = todos.map((t) => t.content || t).slice(0, 12);
        }
        if (['write', 'edit', 'bash'].includes(name)) {
          const blob = JSON.stringify(args);
          if (/src\/inc\.js|inc\.js/.test(blob) && !firstProductWriteAt) {
            firstProductWriteAt = ts;
          }
        }
      }
    }
  }
  return {
    sessionPath,
    firstTodoWriteAt,
    firstProductWriteAt,
    firstTodoContents,
    toolOrder: toolOrder.slice(0, 40),
    playbookStepsInFirstTodos: playbookStepSignals(firstTodoContents.join('\n')).length > 0,
  };
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.poteto-playbook-todo-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await snapshotBaseline();
  await restoreProduct();
  const baseline = await baselineProduct();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = potetoPrompt(side);
  const pollLog = [];
  let firstTodoAt = null;
  let firstProductAt = null;
  let firstPlaybookTodoAt = null;
  const productPaths = new Set();
  const playbookSignalsSeen = new Set();
  let todoSeen = false;
  let attempt;
  try {
    await writeFile(rulePath, ruleBytes);
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(ruleDigest) : piSpec(ruleDigest));
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitEither(attempt, GEOMETRY, ['inc', 'README', 'pi', 'inc.js'], 120_000);
    }
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);

    const stopPoll = new AbortController();
    const pollLoop = (async () => {
      while (!stopPoll.signal.aborted) {
        const now = new Date().toISOString();
        const lines = await screenLines(attempt, GEOMETRY);
        const screenObs = observeTodoText(lines.join('\n'));
        if (screenObs.todoVisible) {
          todoSeen = true;
          if (!firstTodoAt) firstTodoAt = now;
        }
        if (screenObs.playbookStepsVisible) {
          for (const s of screenObs.playbookSignals) playbookSignalsSeen.add(s);
          if (!firstPlaybookTodoAt) firstPlaybookTodoAt = now;
          if (!firstTodoAt) firstTodoAt = now;
        }
        const snap = await pollProductOnce(baseline);
        for (const p of snap.hits.product) {
          productPaths.add(p);
          if (!firstProductAt) firstProductAt = snap.now;
        }
        if (screenObs.todoVisible || screenObs.playbookStepsVisible || snap.hits.product.length) {
          pollLog.push({
            ts: now,
            todoVisible: screenObs.todoVisible,
            playbookSignals: screenObs.playbookSignals,
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
        ['poteto-mode', 'TodoWrite', 'Phase', 'Reproduce', 'Bug fix', 'inc.js', 'playbook'],
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
      const obs = observeTodoText(lines.join('\n'));
      const done = await readDone(side);
      const hasProduct = productPaths.size > 0;
      const enough =
        done.exists ||
        (todoSeen && hasProduct) ||
        (firstPlaybookTodoAt && hasProduct) ||
        (firstPlaybookTodoAt && !obs.working && Date.now() - Date.parse(firstPlaybookTodoAt) > 180_000);
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
    const ptyObs = observeTodoText(ptyText);
    if (ptyObs.todoVisible && !firstTodoAt) firstTodoAt = firstProductAt ? new Date(Date.parse(firstProductAt) - 1000).toISOString() : new Date().toISOString();
    if (ptyObs.playbookStepsVisible) {
      for (const s of ptyObs.playbookSignals) playbookSignalsSeen.add(s);
      if (!firstPlaybookTodoAt) firstPlaybookTodoAt = firstTodoAt;
    }

    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      const sessionPath = await findLatestPiSession();
      sessionSummary = await summarizePiSession(sessionPath);
      if (sessionSummary?.firstTodoWriteAt && (!firstTodoAt || sessionSummary.firstTodoWriteAt < firstTodoAt)) {
        firstTodoAt = sessionSummary.firstTodoWriteAt;
      }
      if (sessionSummary?.playbookStepsInFirstTodos && !firstPlaybookTodoAt) {
        firstPlaybookTodoAt = sessionSummary.firstTodoWriteAt;
      }
      if (sessionSummary?.firstProductWriteAt && !firstProductAt) {
        firstProductAt = sessionSummary.firstProductWriteAt;
      }
    }

    const productList = [...productPaths];
    const ordering = classifyOrdering(firstTodoAt, firstProductAt, todoSeen || ptyObs.todoVisible, productList);
    const screenFinal = observeTodoText((await screenLines(attempt, GEOMETRY)).join('\n'));
    const playbookTodosBeforeProduct =
      Boolean(firstPlaybookTodoAt) &&
      (!firstProductAt || firstPlaybookTodoAt <= firstProductAt) &&
      (ordering === 'todo_before_product' || ordering === 'todo_only');

    const observations = {
      screenFinal,
      pty: {
        todoVisible: ptyObs.todoVisible,
        playbookSignals: ptyObs.playbookSignals,
        potetoMode: ptyObs.potetoMode,
      },
      firstTodoAt,
      firstPlaybookTodoAt,
      firstProductAt,
      productPaths: productList,
      playbookSignalsSeen: [...playbookSignalsSeen],
      ordering,
      todoBeforeProduct: ordering === 'todo_before_product',
      playbookTodosBeforeProduct,
      done: await readDone(side),
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
    scenario: 'cmd-poteto-playbook-todo',
    fixtureDigest: preDigest,
    results,
  }),
);
