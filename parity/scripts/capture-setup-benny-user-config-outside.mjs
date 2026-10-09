#!/usr/bin/env node
// setup-benny-user-config-outside: adapt config creates user-owned copies
// outside .cursor/automations/benny/; examples stay byte-identical.
// Real PTY both sides via recorder.
//
// Usage: node scripts/capture-setup-benny-user-config-outside.mjs [--cursor-only|--pi-only|--both|--self-test]
// Evidence root: parity/evidence/setup-benny/user-config-outside/
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
const evidenceRoot = join(setupBennyRoot, 'user-config-outside');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const seedExamples = join(evidenceRoot, 'seed', 'examples');
const productRel = join('src', 'app.js');
const productAbs = join(fixtureApp, productRel);
const forAgentsRel = join('.upstream', 'automations', 'benny', 'FOR_AGENTS.md');
const setupSkillRel = join(
  '.upstream',
  'automations',
  'benny',
  'skills',
  'setup-benny',
  'SKILL.md',
);
const packDestRel = join('.cursor', 'automations', 'benny');
const preferredUserDirRel = join('.cursor', 'benny');
const EXAMPLE_RELS = [
  join('.cursor', 'automations', 'benny', 'templates', 'configuration.example.yaml'),
  join(
    '.cursor',
    'automations',
    'benny',
    'skills',
    'reproduce-and-fix-issues',
    'references',
    'feature-map.example.md',
  ),
  join(
    '.cursor',
    'automations',
    'benny',
    'skills',
    'triage-issue-reports',
    'references',
    'routing.example.md',
  ),
];
const EXAMPLE_MARKERS = [
  'USER-CONFIG-OUTSIDE-EXAMPLE-CONFIG-MARKER',
  'USER-CONFIG-OUTSIDE-EXAMPLE-FEATURE-MAP-MARKER',
  'USER-CONFIG-OUTSIDE-EXAMPLE-ROUTING-MARKER',
];
const USER_BASENAMES = ['configuration.yaml', 'feature-map.md', 'routing.md'];
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 900_000;
const POLL_MS = 500;
const RULE_BACKUP = `${referenceRulePath}.setup-benny-user-config-outside-backup`;

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
    `Help set up Benny for this repository by completing the adapt-configuration step only. ` +
    `Follow ${forAgentsRel} so ${setupSkillRel} is read (section 2, adapt the configuration). ` +
    `Pack copy under ${packDestRel} is already done; treat pack merge as complete. ` +
    `Create user-owned copies of configuration, feature map, and routing map outside ${packDestRel}. ` +
    `Preferred location is ${preferredUserDirRel}/ (configuration.yaml, feature-map.md, routing.md). ` +
    `Adapt from the copied examples under the pack; use only fixture-safe public placeholders (no real secrets). ` +
    `Do not edit the copied example files. Pack refreshes may update source-managed pack files but must never touch user-owned copies. ` +
    `Do not create or update a live automation. Do not edit parity ledgers or ${productRel}. ` +
    `When the adapt step is done (or you stop), write exactly one line to ${out} as ` +
    `STATUS=adapt-ok|adapt-mismatch|no-adapt|blocked|other reason=<short phrase> then stop.`
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
  const m = line.match(/^STATUS=(adapt-ok|adapt-mismatch|no-adapt|blocked|other)\b/i);
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

function isUnderPackDest(relPosix) {
  const prefix = packDestRel.split(sep).join('/');
  return relPosix === prefix || relPosix.startsWith(`${prefix}/`);
}

async function findUserOwnedCandidates(fixtureRoot) {
  const found = [];
  for (const abs of await walkFiles(fixtureRoot)) {
    const rel = relative(fixtureRoot, abs).split(sep).join('/');
    const base = rel.split('/').pop();
    if (!USER_BASENAMES.includes(base)) continue;
    if (isUnderPackDest(rel)) continue;
    if (/\.example\./.test(base) || rel.includes('.example.')) continue;
    found.push({ rel, abs, digest: await fileDigest(abs), text: await readText(abs) });
  }
  return found.sort((a, b) => a.rel.localeCompare(b.rel));
}

export async function inspectAdaptState(fixtureRoot = fixtureApp) {
  const exampleDigests = {};
  const exampleTexts = {};
  const exampleMarkersPresent = {};
  for (let i = 0; i < EXAMPLE_RELS.length; i += 1) {
    const rel = EXAMPLE_RELS[i].split(sep).join('/');
    const abs = join(fixtureRoot, EXAMPLE_RELS[i]);
    exampleDigests[rel] = await fileDigest(abs);
    exampleTexts[rel] = await readText(abs);
    exampleMarkersPresent[rel] = Boolean(exampleTexts[rel]?.includes(EXAMPLE_MARKERS[i]));
  }

  const userOwned = await findUserOwnedCandidates(fixtureRoot);
  const byBase = Object.fromEntries(USER_BASENAMES.map((b) => [b, []]));
  for (const item of userOwned) {
    const base = item.rel.split('/').pop();
    byBase[base].push(item);
  }

  const preferred = {};
  for (const base of USER_BASENAMES) {
    const rel = join(preferredUserDirRel, base).split(sep).join('/');
    const abs = join(fixtureRoot, preferredUserDirRel, base);
    preferred[base] = {
      rel,
      exists: await pathExists(abs),
      digest: await fileDigest(abs),
      text: await readText(abs),
    };
  }

  const insidePackUserNamed = [];
  for (const abs of await walkFiles(join(fixtureRoot, packDestRel))) {
    const rel = relative(fixtureRoot, abs).split(sep).join('/');
    const base = rel.split('/').pop();
    if (USER_BASENAMES.includes(base) && !rel.includes('.example.')) {
      insidePackUserNamed.push(rel);
    }
  }

  return {
    exampleDigests,
    exampleMarkersPresent,
    userOwned,
    byBase,
    preferred,
    insidePackUserNamed,
    productDigest: await fileDigest(join(fixtureRoot, productRel)),
  };
}

export function scoreAdapt({ done, before, after, screenText, ptyText, sessionSummary }) {
  const hay = stripAnsi(`${screenText || ''}\n${ptyText || ''}`);
  const productUnchanged =
    Boolean(before?.productDigest) && before.productDigest === after?.productDigest;

  const examplesUntouched = EXAMPLE_RELS.every((relPath) => {
    const rel = relPath.split(sep).join('/');
    return (
      Boolean(before?.exampleDigests?.[rel]) &&
      before.exampleDigests[rel] === after?.exampleDigests?.[rel]
    );
  });

  const eachBaseOutside = USER_BASENAMES.every(
    (base) => (after?.byBase?.[base]?.length ?? 0) >= 1,
  );
  const preferredAllPresent = USER_BASENAMES.every((base) =>
    Boolean(after?.preferred?.[base]?.exists),
  );
  const noUserNamedInsidePack = (after?.insidePackUserNamed?.length ?? 0) === 0;
  const outsidePlacementOk = eachBaseOutside && noUserNamedInsidePack;

  const adaptChrome =
    /\.cursor\/benny/i.test(hay) ||
    /user-owned|adapt|configuration\.yaml|feature-map|routing\.md/i.test(hay) ||
    Boolean(sessionSummary?.userWrite);

  let outcome = 'inconclusive';
  if (!productUnchanged || !examplesUntouched || !noUserNamedInsidePack) {
    outcome = 'adapt_mismatch';
  } else if (outsidePlacementOk && examplesUntouched && productUnchanged) {
    outcome = 'adapt_ok';
  } else if (done?.status === 'no-adapt' || (!eachBaseOutside && done?.exists)) {
    outcome = 'no_adapt';
  } else if (done?.status === 'adapt-ok' && outsidePlacementOk && examplesUntouched) {
    outcome = 'adapt_ok';
  } else if (done?.status === 'adapt-mismatch') {
    outcome = 'adapt_mismatch';
  }

  return {
    productUnchanged,
    examplesUntouched,
    eachBaseOutside,
    preferredAllPresent,
    noUserNamedInsidePack,
    outsidePlacementOk,
    adaptChrome,
    outcome,
    contractHeld: outcome === 'adapt_ok',
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'setup-benny-user-config-outside',
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

async function resetFixtureExamplesAndUserOwned() {
  await rm(join(fixtureApp, preferredUserDirRel), { recursive: true, force: true });
  // Wipe any stray user-owned candidates outside pack (except seed / evidence)
  for (const abs of await walkFiles(fixtureApp)) {
    const rel = relative(fixtureApp, abs).split(sep).join('/');
    const base = rel.split('/').pop();
    if (!USER_BASENAMES.includes(base)) continue;
    if (isUnderPackDest(rel)) continue;
    await rm(abs, { force: true });
  }
  await cp(
    join(seedExamples, 'configuration.example.yaml'),
    join(fixtureApp, EXAMPLE_RELS[0]),
  );
  await cp(
    join(seedExamples, 'feature-map.example.md'),
    join(fixtureApp, EXAMPLE_RELS[1]),
  );
  await cp(join(seedExamples, 'routing.example.md'), join(fixtureApp, EXAMPLE_RELS[2]));
  // Keep upstream examples aligned with dest seed
  await cp(
    join(seedExamples, 'configuration.example.yaml'),
    join(
      fixtureApp,
      '.upstream',
      'automations',
      'benny',
      'templates',
      'configuration.example.yaml',
    ),
  );
  await cp(
    join(seedExamples, 'feature-map.example.md'),
    join(
      fixtureApp,
      '.upstream',
      'automations',
      'benny',
      'skills',
      'reproduce-and-fix-issues',
      'references',
      'feature-map.example.md',
    ),
  );
  await cp(
    join(seedExamples, 'routing.example.md'),
    join(
      fixtureApp,
      '.upstream',
      'automations',
      'benny',
      'skills',
      'triage-issue-reports',
      'references',
      'routing.example.md',
    ),
  );
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
      (/fixture-app|Benny|benny|medium|Skill conflicts|README|setup|adapt/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'user-config-outside-fixture-app';
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
  let userWrite = false;
  let exampleEdit = false;
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
          /\.cursor\/benny|user-owned|configuration\.yaml|feature-map\.md|routing\.md/i.test(
            argBlob,
          ) &&
          /write|edit|apply|create|bash|cp|copy|mkdir/i.test(`${name} ${argBlob}`)
        ) {
          userWrite = true;
          label = `${name}(user-owned)`;
        }
        if (/\.example\./i.test(argBlob) && /write|edit|apply/i.test(`${name} ${argBlob}`)) {
          exampleEdit = true;
          label = `${name}(example-edit)`;
        }
        toolOrder.push(label);
      }
      if (part.type === 'text' && typeof part.text === 'string') {
        assistantTexts.push(part.text);
        if (/FOR_AGENTS\.md/i.test(part.text)) forAgentsRead = true;
        if (/setup-benny\/SKILL\.md/i.test(part.text)) setupBennyRead = true;
      }
    }
  }
  return {
    sessionPath,
    forAgentsRead,
    setupBennyRead,
    userWrite,
    exampleEdit,
    toolOrder: toolOrder.slice(0, 200),
    assistantJoined: assistantTexts.join('\n\n'),
  };
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await resetFixtureExamplesAndUserOwned();
  if (side === 'pi') await ensurePiTrust();
  await writeFile(RULE_BACKUP, ruleBytes);

  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = setupPrompt(side);
  const before = await inspectAdaptState(fixtureApp);
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
        const afterSnap = await inspectAdaptState(fixtureApp);
        if (
          done.exists ||
          afterSnap.userOwned.length > 0 ||
          /STATUS=|adapt-ok|\.cursor\/benny/i.test(text)
        ) {
          pollLog.push({
            ts: new Date().toISOString(),
            doneExists: done.exists,
            doneStatus: done.status,
            userOwnedCount: afterSnap.userOwned.length,
            preferredPresent: USER_BASENAMES.map((b) => afterSnap.preferred[b].exists),
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
          'adapt-ok',
          'FOR_AGENTS',
          '.cursor/benny',
          'configuration.yaml',
          'feature-map',
          'routing.md',
          'user-owned',
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
    const after = await inspectAdaptState(fixtureApp);
    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      sessionSummary = await summarizePiSession(await findLatestPiSession());
    }

    const score = scoreAdapt({
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
        examplesUntouched: score.examplesUntouched,
        eachBaseOutside: score.eachBaseOutside,
        preferredAllPresent: score.preferredAllPresent,
        noUserNamedInsidePack: score.noUserNamedInsidePack,
        outsidePlacementOk: score.outsidePlacementOk,
        adaptChrome: score.adaptChrome,
      },
      session: sessionSummary
        ? {
            sessionPath: sessionSummary.sessionPath,
            forAgentsRead: sessionSummary.forAgentsRead,
            setupBennyRead: sessionSummary.setupBennyRead,
            userWrite: sessionSummary.userWrite,
            exampleEdit: sessionSummary.exampleEdit,
            toolOrder: sessionSummary.toolOrder,
          }
        : null,
      pollSamples: pollLog.length,
      scorerNote:
        'adapt_ok requires each of configuration.yaml, feature-map.md, routing.md outside .cursor/automations/benny/, no same-named non-example files inside the pack, example digests unchanged, and product unchanged',
    };

    const afterRule = await readFile(rulePath, 'utf8');
    const afterRuleDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), afterRule);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
    await writeFile(join(dir, 'poll-log.json'), `${JSON.stringify(pollLog, null, 2)}\n`);
    await writeFile(
      join(dir, 'adapt-diff.json'),
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
  const pack = join(tmp, '.cursor', 'automations', 'benny');
  await mkdir(join(pack, 'templates'), { recursive: true });
  await mkdir(join(pack, 'skills', 'reproduce-and-fix-issues', 'references'), {
    recursive: true,
  });
  await mkdir(join(pack, 'skills', 'triage-issue-reports', 'references'), { recursive: true });
  await mkdir(join(tmp, 'src'), { recursive: true });
  await writeFile(
    join(pack, 'templates', 'configuration.example.yaml'),
    `# ${EXAMPLE_MARKERS[0]}\ncfg\n`,
  );
  await writeFile(
    join(pack, 'skills', 'reproduce-and-fix-issues', 'references', 'feature-map.example.md'),
    `<!-- ${EXAMPLE_MARKERS[1]} -->\nmap\n`,
  );
  await writeFile(
    join(pack, 'skills', 'triage-issue-reports', 'references', 'routing.example.md'),
    `<!-- ${EXAMPLE_MARKERS[2]} -->\nroute\n`,
  );
  await writeFile(join(tmp, 'src', 'app.js'), 'product\n');

  const before = await inspectAdaptState(tmp);
  const user = join(tmp, '.cursor', 'benny');
  await mkdir(user, { recursive: true });
  await writeFile(join(user, 'configuration.yaml'), 'schema: 1\nslack:\n  source_channel_id: C-FIXTURE\n');
  await writeFile(join(user, 'feature-map.md'), '# Feature map\n- login\n');
  await writeFile(join(user, 'routing.md'), '# Routing\n- default: triage\n');
  const afterOk = await inspectAdaptState(tmp);
  const pass = scoreAdapt({
    done: { exists: true, status: 'adapt-ok', line: 'STATUS=adapt-ok reason=ok' },
    before,
    after: afterOk,
    screenText: 'Created .cursor/benny/configuration.yaml',
    ptyText: 'user-owned outside pack',
    sessionSummary: { userWrite: true },
  });

  // Edit example -> mismatch
  await writeFile(
    join(pack, 'templates', 'configuration.example.yaml'),
    `# ${EXAMPLE_MARKERS[0]}\ncfg EDITED\n`,
  );
  const afterBad = await inspectAdaptState(tmp);
  const mismatch = scoreAdapt({
    done: {
      exists: true,
      status: 'adapt-mismatch',
      line: 'STATUS=adapt-mismatch reason=edited-example',
    },
    before,
    after: afterBad,
    screenText: 'edited example',
    ptyText: '',
    sessionSummary: { userWrite: true },
  });

  await rm(tmp, { recursive: true, force: true });
  const cases = [
    ['beforeEmpty', before.userOwned.length === 0],
    ['pass', pass.contractHeld === true && pass.outcome === 'adapt_ok'],
    ['mismatch', mismatch.contractHeld === false && mismatch.outcome === 'adapt_mismatch'],
    ['examplesUntouchedPass', pass.examplesUntouched === true],
    ['examplesTouchedFail', mismatch.examplesUntouched === false],
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
    `${JSON.stringify({ scenario: 'setup-benny-user-config-outside', fixtureDigest: preDigest, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      scenario: 'setup-benny-user-config-outside',
      fixtureDigest: preDigest,
      results,
    }),
  );
}
