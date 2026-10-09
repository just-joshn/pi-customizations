#!/usr/bin/env node
// cmd-blast-radius-run-proof: invoke /blast-radius on a held-out candidate
// CHANGE.diff. Expect certainty step 4 (run script/test against real code) or
// an explicit cheaper stop with a certainty level, not writeup-only.
// Real PTY both sides via the recorder.
//
// Usage: node scripts/capture-blast-radius-run-proof.mjs [--cursor-only|--pi-only|--both|--self-test]
// Evidence root: parity/evidence/blast-radius/
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
const evidenceRoot = join(root, 'evidence', 'blast-radius');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const baselineRoot = join(evidenceRoot, 'fixture-baseline');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_200_000;
const POLL_MS = 500;
const PRODUCT_RELS = ['src/ttl.js', 'src/sessionStore.js', 'CHANGE.diff', 'package.json', 'README.md'];

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

function blastPrompt(side) {
  const out = donePath(side);
  return (
    `/blast-radius review the candidate change in CHANGE.diff for this fixture. ` +
    `Find the one fact the change is safe because of, or prove it is unsafe. ` +
    `For each critical safety fact, push certainty as far down the list as is cheap ` +
    `(1 said-so, 2 pointed at line, 3 walked bad case, 4 ran a script or test against real code, 5 reproduced in running app). ` +
    `Step 4 is the usual target. Do not hand back only a narrative writeup with no certainty level. ` +
    `If you stop cheaper than step 4, name the cheaper stop explicitly. ` +
    `Work only inside this fixture cwd. Do not edit ledgers or parity ledgers. ` +
    `When finished, write exactly one line to ${out} as ` +
    `PROOF=step5|step4|step3|step2|step1|cheaper-stop|writeup-only certainty=<n-or-label> fact=<short phrase> then stop.`
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
  return out.sort();
}

async function fileDigest(path) {
  if (!(await pathExists(path))) return null;
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

async function snapshotBaseline() {
  for (const rel of PRODUCT_RELS) {
    const src = join(fixtureApp, rel);
    const dst = join(baselineRoot, rel);
    await mkdir(dirname(dst), { recursive: true });
    await writeFile(dst, await readFile(src));
  }
}

async function restoreProduct() {
  for (const rel of PRODUCT_RELS) {
    const src = join(baselineRoot, rel);
    const dst = join(fixtureApp, rel);
    if (await pathExists(src)) {
      await mkdir(dirname(dst), { recursive: true });
      await writeFile(dst, await readFile(src));
    }
  }
  const files = await walkFiles(fixtureApp);
  for (const rel of files) {
    if (PRODUCT_RELS.includes(rel)) continue;
    if (rel.startsWith('proofs/') || rel.startsWith('scripts/') || rel.startsWith('test/') || /\.test\.js$/.test(rel)) {
      await rm(join(fixtureApp, rel), { force: true, recursive: true });
    }
  }
  for (const dir of ['proofs', 'scripts', 'test', '.audit']) {
    await rm(join(fixtureApp, dir), { recursive: true, force: true });
  }
}

async function listProofArtifacts() {
  const files = await walkFiles(fixtureApp);
  return files.filter(
    (rel) =>
      rel.startsWith('proofs/') ||
      rel.startsWith('scripts/') ||
      (rel.startsWith('test/') && rel.endsWith('.js')) ||
      /\.test\.js$/.test(rel),
  );
}

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null, proof: null, certainty: null, fact: null };
  const line = (await readFile(path, 'utf8')).trim().split('\n')[0] ?? '';
  const m = line.match(
    /^PROOF=(step5|step4|step3|step2|step1|cheaper-stop|writeup-only)\b(?:\s+certainty=(\S+))?(?:\s+fact=(.+))?$/i,
  );
  return {
    exists: true,
    path,
    line,
    proof: m ? m[1].toLowerCase() : null,
    certainty: m?.[2] ?? null,
    fact: m?.[3]?.trim() ?? null,
  };
}

export function observeRunProofText(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  const ranCode =
    /\bnode\s+(?:--test\s+)?[\w./-]+\.m?js\b/i.test(hay) ||
    /\bnpm\s+test\b/i.test(hay) ||
    /\bnode --input-type=module\b/i.test(hay) ||
    /\bnode -e\b/i.test(hay) ||
    /\bAssertionError\b/i.test(hay) ||
    /\bexit code\b/i.test(hay) ||
    /\bran (the )?(script|test|proof)\b/i.test(hay) ||
    /\bproof(s)?\/[\w./-]+\.m?js\b/i.test(hay);
  const certaintyNamed =
    /\bstep\s*[1-5]\b/i.test(hay) ||
    /\bcertainty\b/i.test(hay) ||
    /\b(proven|unproven|cheaper stop)\b/i.test(hay);
  const writeupOnlySmell =
    /\bblast radius\b/i.test(hay) &&
    !ranCode &&
    !/\bPROOF=step[45]\b/i.test(hay) &&
    !/\bPROOF=cheaper-stop\b/i.test(hay);
  const skillChrome =
    /\/blast-radius\b/i.test(hay) ||
    /\[skill\]\s*blast-radius/i.test(hay) ||
    /\bUsed blast-radius\b/i.test(hay) ||
    /\bblast-radius\b/i.test(hay);
  return {
    ranCode,
    certaintyNamed,
    writeupOnlySmell,
    skillChrome,
    working: /[\u2800-\u28FF]/.test(hay) || /\bWorking\b/.test(hay),
  };
}

export function scoreBlastRadiusRunProof({
  done,
  proofArtifacts,
  screenText,
  ptyText,
  sessionSummary,
  prompt,
}) {
  const screen = observeRunProofText(screenText, { ignorePromptSlice: prompt });
  const pty = observeRunProofText(ptyText, { ignorePromptSlice: prompt });
  const artifacts = Array.isArray(proofArtifacts) ? proofArtifacts : [];
  const hasArtifacts = artifacts.length > 0;
  const sessionRan = Boolean(sessionSummary?.ranCodeTools);
  const proofLevel = done?.proof ?? null;
  const step4Plus = proofLevel === 'step4' || proofLevel === 'step5';
  const cheaperStop = proofLevel === 'cheaper-stop';
  const writeupOnly = proofLevel === 'writeup-only' || proofLevel === 'step1';
  const runEvidence = hasArtifacts || screen.ranCode || pty.ranCode || sessionRan;
  const certaintyStated = Boolean(done?.certainty) || screen.certaintyNamed || pty.certaintyNamed;
  const engaged =
    Boolean(sessionSummary?.skillRead) ||
    screen.skillChrome ||
    pty.skillChrome ||
    Boolean(done?.exists) ||
    hasArtifacts;

  let outcome = 'inconclusive';
  if (engaged && step4Plus && (runEvidence || certaintyStated)) outcome = 'run_proof';
  else if (engaged && cheaperStop && certaintyStated) outcome = 'cheaper_stop';
  else if (engaged && runEvidence && certaintyStated && !writeupOnly) outcome = 'run_proof';
  else if (engaged && (writeupOnly || (certaintyStated === false && !runEvidence))) outcome = 'writeup_only';
  else if (engaged && proofLevel && ['step2', 'step3'].includes(proofLevel)) outcome = 'writeup_only';

  const contractHeld = outcome === 'run_proof' || outcome === 'cheaper_stop';
  return {
    engaged,
    proofLevel,
    runEvidence,
    certaintyStated,
    hasArtifacts,
    sessionRan,
    screen,
    pty,
    outcome,
    contractHeld,
    artifacts,
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'cmd-blast-radius-run-proof',
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
  const backupPath = `${referenceRulePath}.blast-radius-run-proof-backup`;
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
      (/fixture-app|ttl|CHANGE|medium|Skill conflicts|README|Session TTL/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'blast-radius-fixture-app';
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
  let skillRead = false;
  let ranCodeTools = false;
  const assistantTexts = [];
  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const blob = JSON.stringify(o);
    if (/blast-radius\/SKILL\.md|skills\/blast-radius|prompts\/blast-radius/i.test(blob)) skillRead = true;
    const msg = o.message || o;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type === 'toolCall' || part.type === 'tool_use') {
        const name = part.name || part.toolName || '';
        const args = part.arguments || part.input || {};
        const argBlob = JSON.stringify(args);
        let label = name;
        if (/blast-radius/i.test(argBlob)) {
          skillRead = true;
          label = `${name}(blast-radius)`;
        }
        if (
          /\bnode\b/i.test(`${name} ${argBlob}`) ||
          /\bnpm\s+test\b/i.test(argBlob) ||
          /proofs\//i.test(argBlob) ||
          /\.test\.js/i.test(argBlob)
        ) {
          ranCodeTools = true;
          label = `${name}(run-code)`;
        }
        toolOrder.push(label);
      }
      if (part.type === 'text' && typeof part.text === 'string') {
        assistantTexts.push(part.text);
      }
    }
  }
  return {
    sessionPath,
    skillRead,
    ranCodeTools,
    toolOrder: toolOrder.slice(0, 160),
    assistantJoined: assistantTexts.join('\n\n'),
  };
}

async function copyFixtureSnapshot(destDir, extraRels = []) {
  await mkdir(destDir, { recursive: true });
  for (const rel of [...PRODUCT_RELS, ...extraRels]) {
    const abs = join(fixtureApp, rel);
    if (!(await pathExists(abs))) continue;
    const dest = join(destDir, rel);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, await readFile(abs));
  }
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.blast-radius-run-proof-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await snapshotBaseline();
  await restoreProduct();
  if (side === 'pi') await ensurePiTrust();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = blastPrompt(side);
  const pollLog = [];
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
        const lines = await screenLines(attempt, GEOMETRY);
        const obs = observeRunProofText(lines.join('\n'), { ignorePromptSlice: prompt });
        const done = await readDone(side);
        const artifacts = await listProofArtifacts();
        if (obs.ranCode || obs.skillChrome || done.exists || artifacts.length) {
          pollLog.push({
            ts: new Date().toISOString(),
            ...obs,
            doneExists: done.exists,
            proof: done.proof,
            artifacts,
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
          'blast-radius',
          'blast radius',
          'PROOF=',
          'certainty',
          'ttl',
          'isExpired',
          'CHANGE.diff',
          'step 4',
          'step4',
          'node ',
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
      const obs = observeRunProofText(text, { ignorePromptSlice: prompt });
      if (done.exists && !obs.working) {
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
    const proofArtifacts = await listProofArtifacts();
    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      sessionSummary = await summarizePiSession(await findLatestPiSession());
    }

    const score = scoreBlastRadiusRunProof({
      done,
      proofArtifacts,
      screenText: settledText,
      ptyText,
      sessionSummary,
      prompt,
    });

    const observations = {
      done,
      proofArtifacts,
      outcome: score.outcome,
      contractHeld: score.contractHeld,
      engaged: score.engaged,
      runEvidence: score.runEvidence,
      certaintyStated: score.certaintyStated,
      screen: score.screen,
      pty: score.pty,
      session: sessionSummary
        ? {
            sessionPath: sessionSummary.sessionPath,
            skillRead: sessionSummary.skillRead,
            ranCodeTools: sessionSummary.ranCodeTools,
            toolOrder: sessionSummary.toolOrder,
          }
        : null,
      pollSamples: pollLog.length,
      scorerNote:
        'run_proof requires engagement plus step4/step5 (or observed code run) with certainty; cheaper_stop requires named cheaper stop + certainty; writeup_only is a contract miss',
    };

    const afterRule = await readFile(rulePath, 'utf8');
    const afterRuleDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), afterRule);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
    await writeFile(join(dir, 'poll-log.json'), `${JSON.stringify(pollLog, null, 2)}\n`);
    if (done.exists) {
      await writeFile(join(dir, 'done-copy.txt'), `${done.line}\n`);
    }
    await copyFixtureSnapshot(join(dir, 'fixture-after'), proofArtifacts);
    await copyFixtureSnapshot(join(attempt.dir, 'fixture-snapshot'), proofArtifacts);

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
    await restoreProduct();
  }
}

async function selfTest() {
  const pass = scoreBlastRadiusRunProof({
    done: {
      exists: true,
      proof: 'step4',
      certainty: '4',
      fact: 'ttl0 immortal callers drop',
      line: 'PROOF=step4 certainty=4 fact=ttl0 immortal callers drop',
    },
    proofArtifacts: ['proofs/ttl0.js'],
    screenText: 'Ran node proofs/ttl0.js exit code 1. Certainty step 4.',
    ptyText: 'node proofs/ttl0.js',
    sessionSummary: { skillRead: true, ranCodeTools: true },
    prompt: '/blast-radius review',
  });
  const cheaper = scoreBlastRadiusRunProof({
    done: {
      exists: true,
      proof: 'cheaper-stop',
      certainty: '3',
      fact: 'walked bad case at isExpired',
      line: 'PROOF=cheaper-stop certainty=3 fact=walked bad case at isExpired',
    },
    proofArtifacts: [],
    screenText: 'Cheaper stop at step 3. Certainty named.',
    ptyText: 'certainty step 3',
    sessionSummary: { skillRead: true, ranCodeTools: false },
    prompt: '/blast-radius review',
  });
  const writeup = scoreBlastRadiusRunProof({
    done: {
      exists: true,
      proof: 'writeup-only',
      certainty: null,
      fact: 'seems fine',
      line: 'PROOF=writeup-only fact=seems fine',
    },
    proofArtifacts: [],
    screenText: 'Blast radius looks limited. No runs.',
    ptyText: 'narrative only',
    sessionSummary: { skillRead: true, ranCodeTools: false },
    prompt: '/blast-radius review',
  });
  const cases = [
    ['pass', pass.contractHeld === true && pass.outcome === 'run_proof'],
    ['cheaper', cheaper.contractHeld === true && cheaper.outcome === 'cheaper_stop'],
    ['writeup', writeup.contractHeld === false && writeup.outcome === 'writeup_only'],
  ];
  const failed = cases.filter(([, ok]) => !ok);
  console.log(JSON.stringify({ selfTest: failed.length === 0, cases }, null, 2));
  if (failed.length) process.exit(1);
}

if (only === '--self-test') {
  await selfTest();
  process.exit(0);
}

await snapshotBaseline();
const preRule = await readFile(referenceRulePath, 'utf8');
const preDigest = await sha256(referenceRulePath);
if (preDigest !== LOCKED_FIXTURE_DIGEST) {
  console.error(`Reference rule digest ${preDigest} does not match the locked fixture ${LOCKED_FIXTURE_DIGEST}`);
  process.exit(1);
}
if (!(await pathExists(join(fixtureApp, 'CHANGE.diff')))) {
  console.error('Fixture CHANGE.diff missing');
  process.exit(1);
}

const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
const results = [];
for (const side of sides) {
  const result = await runSide(side, preRule, preDigest);
  results.push(result);
  console.log(JSON.stringify(result));
}
await writeFile(
  join(evidenceRoot, 'capture-results.json'),
  `${JSON.stringify({ scenario: 'cmd-blast-radius-run-proof', fixtureDigest: preDigest, results }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    scenario: 'cmd-blast-radius-run-proof',
    fixtureDigest: preDigest,
    results,
  }),
);
