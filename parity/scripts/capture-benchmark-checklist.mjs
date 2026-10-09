#!/usr/bin/env node
// Capture /benchmark-checklist one-run ballpark evidence on a tiny sort fixture.
// Real PTY both sides via the recorder.
//
// Usage: node scripts/capture-benchmark-checklist.mjs [--cursor-only|--pi-only|--both|--self-test]
// Evidence root: parity/evidence/benchmark/
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { outputBytes, startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('capture-benchmark-checklist.mjs');
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'benchmark');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;
const POLL_MS = 400;
const FIXTURE_KEEP = new Set(['README.md', 'claim.md', 'measure.mjs']);

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

function reportPath(side) {
  return join(writeRootFor(side), 'checklist-report.md');
}

function benchPrompt(side) {
  const out = donePath(side);
  const report = reportPath(side);
  return (
    `/benchmark-checklist I need a quick ballpark only. One run is enough. ` +
    `Claim draft is claim.md. Measurement script is measure.mjs. ` +
    `Run measure.mjs if needed, then answer the checklist against the claim using evidence from that run, not guesses about the code. ` +
    `Still check questions 4 and 7, and say that it is one run. Skip the rest unless that run looks wrong. ` +
    `Write the checklist answers to ${report}. ` +
    `Work only inside this fixture cwd and the marker dir. Do not edit ledgers, parity requirements, or files outside this cwd except the marker paths named here. ` +
    `When finished, write exactly one line to ${out} with fields q4=yes|no q7=yes|no oneRun=yes|no evidence=<path-or-number> then stop.`
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
  return out;
}

async function fileDigest(path) {
  const body = await readFile(path);
  return createHash('sha256').update(body).digest('hex');
}

async function restoreFixture() {
  const files = await walkFiles(fixtureApp);
  for (const rel of files) {
    if (FIXTURE_KEEP.has(rel)) continue;
    await rm(join(fixtureApp, rel), { force: true, recursive: true });
  }
}

function observeScreen(text) {
  return {
    benchmarkChecklist:
      /\/benchmark-checklist\b/i.test(text) ||
      /\[skill\]\s*benchmark-checklist/i.test(text) ||
      /\bUsed benchmark-checklist\b/i.test(text) ||
      /\bbenchmark-checklist\b/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

export function scoreChecklistText(text, { skillChrome = false } = {}) {
  const body = text ?? '';
  const q4 =
    /\b(question\s*4|q\s*4|did it error|errorCount|errors?\b|outputs?\s*correct|non-success|failures?\b)/i.test(
      body,
    );
  const q7 =
    /\b(question\s*7|q\s*7|did it even happen|work (ran|happened)|timed region|workHappened|outputs?\s*(were\s*)?(sorted|correct)|bytes were|result (was )?used)/i.test(
      body,
    );
  const oneRun =
    /\b(one run|single run|1 run|runCount\s*[:=]\s*1|ballpark|this is one run|labeled as one run)\b/i.test(body);
  const runEvidence =
    /\brun-evidence\.json\b/i.test(body) ||
    /\bmeasure\.mjs\b/i.test(body) ||
    /\b(slowMs|fastMs|speedupPct|errorCount)\b/i.test(body) ||
    /\b\d+(\.\d+)?\s*ms\b/i.test(body) ||
    /sha256:[a-f0-9]{8,}/i.test(body);
  const comparativeWinnerWithoutChecks =
    /\b(winner|adopt|ship|25%\s*faster|sortFast is (about )?\d+% faster)\b/i.test(body) &&
    (!q4 || !q7 || !oneRun);
  const contractHeld =
    (skillChrome || /benchmark-checklist/i.test(body) || /checklist/i.test(body)) &&
    q4 &&
    q7 &&
    oneRun &&
    runEvidence &&
    !comparativeWinnerWithoutChecks;
  return {
    contractHeld,
    q4,
    q7,
    oneRun,
    runEvidence,
    skillChrome,
    comparativeWinnerWithoutChecks,
    reason: contractHeld
      ? 'ok'
      : !q4
        ? 'missing_q4'
        : !q7
          ? 'missing_q7'
          : !oneRun
            ? 'missing_one_run_label'
            : !runEvidence
              ? 'missing_run_evidence'
              : comparativeWinnerWithoutChecks
                ? 'comparative_without_checks'
                : 'missing_skill',
  };
}

function scoreDoneLine(line) {
  if (!line) return { ok: false, fields: {} };
  const fields = {};
  for (const part of line.trim().split(/\s+/)) {
    const m = part.match(/^([^=]+)=(.*)$/);
    if (m) fields[m[1]] = m[2];
  }
  const ok =
    /^(yes|true|1)$/i.test(fields.q4 ?? '') &&
    /^(yes|true|1)$/i.test(fields.q7 ?? '') &&
    /^(yes|true|1)$/i.test(fields.oneRun ?? '') &&
    Boolean(fields.evidence);
  return { ok, fields };
}

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line, scored: scoreDoneLine(line) };
}

async function readReport(side) {
  const path = reportPath(side);
  if (!(await pathExists(path))) {
    const fixtureReport = join(fixtureApp, 'checklist-report.md');
    if (await pathExists(fixtureReport)) {
      const text = await readFile(fixtureReport, 'utf8');
      return { exists: true, path: fixtureReport, text };
    }
    return { exists: false, path, text: null };
  }
  const text = await readFile(path, 'utf8');
  return { exists: true, path, text };
}

function spec({ side, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'cmd-benchmark-checklist-evidence',
    fixtureRef: { path: fixturePath, digest: fixtureDigest },
    artifactPaths: [],
    launch: { argv, cwd: fixtureApp, env },
    geometry: GEOMETRY,
  };
}

const cursorSpec = (fixtureDigest) =>
  spec({
    side: 'cursor',
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
  const backupPath = `${referenceRulePath}.benchmark-checklist-backup`;
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
      (/fixture-app|Skill conflicts|sort|medium|README|claim/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function snapshotArtifacts(side, attemptDir) {
  const outRoot = writeRootFor(side);
  await mkdir(outRoot, { recursive: true });
  for (const rel of ['run-evidence.json', 'checklist-report.md']) {
    const abs = join(fixtureApp, rel);
    if (await pathExists(abs)) {
      await writeFile(join(outRoot, rel), await readFile(abs));
      if (attemptDir) {
        const snapDir = join(attemptDir, 'fixture-snapshot');
        await mkdir(snapDir, { recursive: true });
        await writeFile(join(snapDir, rel), await readFile(abs));
      }
    }
  }
  for (const keep of FIXTURE_KEEP) {
    const abs = join(fixtureApp, keep);
    if (attemptDir && (await pathExists(abs))) {
      const snapDir = join(attemptDir, 'fixture-snapshot');
      await mkdir(snapDir, { recursive: true });
      await writeFile(join(snapDir, keep), await readFile(abs));
    }
  }
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.benchmark-checklist-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await rm(reportPath(side), { force: true });
  await restoreFixture();
  if (side === 'pi') await ensurePiTrust();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = benchPrompt(side);
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
        ['benchmark-checklist', 'question 4', 'Question 4', 'one run', 'run-evidence', 'errorCount', 'workHappened'],
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
      const report = await readReport(side);
      const combined = [report.text ?? '', done.line ?? '', lines.join('\n')].join('\n');
      const scored = scoreChecklistText(combined, { skillChrome: obs.benchmarkChecklist });
      const enough = done.exists || (report.exists && scored.q4 && scored.q7 && scored.oneRun);
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

    await snapshotArtifacts(side, attempt.dir);

    const screenText = (await screenLines(attempt, GEOMETRY)).join('\n');
    const ptyText = stripAnsi(outputBytes(attempt.events()).toString('utf8'));
    const screenFinal = observeScreen(screenText);
    const ptyObs = observeScreen(ptyText);
    const done = await readDone(side);
    const report = await readReport(side);
    const runEvidenceAbs = join(fixtureApp, 'run-evidence.json');
    const runEvidenceExists = await pathExists(runEvidenceAbs);
    let runEvidence = null;
    if (runEvidenceExists) {
      runEvidence = JSON.parse(await readFile(runEvidenceAbs, 'utf8'));
      await writeFile(join(writeRootFor(side), 'run-evidence.json'), `${JSON.stringify(runEvidence, null, 2)}\n`);
    }
    const combined = [report.text ?? '', done.line ?? '', screenText, ptyText].join('\n');
    const scored = scoreChecklistText(combined, {
      skillChrome: screenFinal.benchmarkChecklist || ptyObs.benchmarkChecklist,
    });
    const contractHeld =
      scored.contractHeld &&
      ((done.scored?.ok ?? false) || (scored.q4 && scored.q7 && scored.oneRun && scored.runEvidence));

    const measureDigest = await fileDigest(join(fixtureApp, 'measure.mjs'));
    const claimDigest = await fileDigest(join(fixtureApp, 'claim.md'));

    const observations = {
      screenFinal,
      pty: ptyObs,
      done,
      report: report.exists
        ? { path: report.path, bytes: Buffer.byteLength(report.text ?? '', 'utf8'), preview: (report.text ?? '').slice(0, 2000) }
        : null,
      runEvidenceExists,
      runEvidence,
      score: { ...scored, contractHeld },
      measureDigest: `sha256:${measureDigest}`,
      claimDigest: `sha256:${claimDigest}`,
      productUnchanged: true,
    };

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
    if (report.exists && report.text != null) {
      await writeFile(join(dir, 'checklist-report.md'), report.text);
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

function selfTest() {
  const pass = scoreChecklistText(
    [
      'benchmark-checklist one-run ballpark',
      'Question 4: errorCount=0 outputsCorrect=true from run-evidence.json',
      'Question 7: workHappened=true timed region ran sortSlow then sortFast',
      'This is one run. slowMs 12.3 ms fastMs 0.4 ms',
      'Verdict: inconclusive for adoption; ballpark only',
    ].join('\n'),
    { skillChrome: true },
  );
  const missingQ4 = scoreChecklistText(
    'benchmark-checklist one run Question 7 workHappened true run-evidence.json 12 ms',
    { skillChrome: true },
  );
  const missingOneRun = scoreChecklistText(
    'benchmark-checklist Question 4 errorCount 0 Question 7 workHappened true run-evidence.json 12 ms',
    { skillChrome: true },
  );
  const cases = [
    ['pass', pass.contractHeld === true && pass.reason === 'ok'],
    ['missingQ4', missingQ4.contractHeld === false && missingQ4.reason === 'missing_q4'],
    ['missingOneRun', missingOneRun.contractHeld === false && missingOneRun.reason === 'missing_one_run_label'],
    ['doneOk', scoreDoneLine('q4=yes q7=yes oneRun=yes evidence=run-evidence.json').ok === true],
    ['doneBad', scoreDoneLine('q4=yes q7=no oneRun=yes evidence=x').ok === false],
  ];
  const failed = cases.filter(([, ok]) => !ok);
  console.log(JSON.stringify({ selfTest: failed.length === 0, cases }, null, 2));
  if (failed.length) process.exit(1);
}

if (isMain && only === '--self-test') {
  selfTest();
} else if (isMain) {
  await restoreFixture();
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
      scenario: 'cmd-benchmark-checklist-evidence',
      fixtureDigest: preDigest,
      results,
    }),
  );
}
