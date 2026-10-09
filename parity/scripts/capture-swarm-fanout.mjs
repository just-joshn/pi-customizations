#!/usr/bin/env node
// Family 06 first pair: /swarm N=2 with isolated absolute write paths and one rollup.
// Real PTY both sides via the recorder. Screens plus on-disk worker files are the oracle.
//
// Usage: node scripts/capture-swarm-fanout.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/swarm/
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'swarm');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeRootFor(side) {
  return join(evidenceRoot, 'fixture-out', side);
}

function swarmPrompt(side) {
  const out = writeRootFor(side);
  return (
    `/swarm N=2 partition. ` +
    `Worker A must write exactly the single line WORKER-A to ${join(out, 'a.txt')} and nothing else. ` +
    `Worker B must write exactly the single line WORKER-B to ${join(out, 'b.txt')} and nothing else. ` +
    `Neither worker may write the other's path. ` +
    `Parent drains both, then returns one rolled-up PASS/ISSUES/BLOCKED report listing both absolute paths. ` +
    `Do not edit ledgers or product code.`
  );
}

function observeSwarm(lines) {
  const text = lines.join('\n');
  return {
    swarmSkill:
      /Used swarm/i.test(text) ||
      /\[skill\]\s*swarm/i.test(text) ||
      /skill:\s*swarm/i.test(text) ||
      (/\/swarm\b/i.test(text) && /Fan out|Frame|Aggregate/i.test(text)),
    fanOutStarted:
      /\bFan out\b/i.test(text) ||
      /\bN\s*=\s*2\b/i.test(text) ||
      /\b2\s+workers?\b/i.test(text) ||
      /\bworkers?\b.*\b(spawn|launch|start)/i.test(text) ||
      /\bAgent\b.*\b(running|started|background)/i.test(text) ||
      /\bsubagent\b/i.test(text) ||
      /\bTask\b.*\b(running|started|background)/i.test(text),
    isolationMention:
      /WORKER-A|WORKER-B|a\.txt|b\.txt|isolated|own (writable )?path|worktree/i.test(text),
    rollupReport:
      /\bPASS\b|\bISSUES\b|\bBLOCKED\b/i.test(text) ||
      /\brolled[- ]?up\b/i.test(text) ||
      /\baggregat/i.test(text) ||
      /\bone report\b/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

async function readWorkerFiles(side) {
  const out = writeRootFor(side);
  const result = { a: null, b: null, aPath: join(out, 'a.txt'), bPath: join(out, 'b.txt') };
  try {
    result.a = (await readFile(result.aPath, 'utf8')).trim();
  } catch {
    result.a = null;
  }
  try {
    result.b = (await readFile(result.bPath, 'utf8')).trim();
  } catch {
    result.b = null;
  }
  result.isolatedOk = result.a === 'WORKER-A' && result.b === 'WORKER-B';
  result.collision =
    (result.a !== null && result.a !== 'WORKER-A') || (result.b !== null && result.b !== 'WORKER-B');
  return result;
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'swarm:n2-isolated-writes',
    fixtureRef: { path: fixturePath, digest: fixtureDigest },
    artifactPaths: [],
    launch: { argv, cwd, env },
    geometry: GEOMETRY,
  };
}

const cursorSpec = (fixtureDigest) =>
  spec({
    side: 'cursor',
    cwd: join(root, 'fixtures', 'first-run'),
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
    cwd: join(root, 'fixtures', 'first-run'),
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
  const backupPath = `${referenceRulePath}.swarm-fanout-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function waitSwarmSettled(attempt, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let calm = 0;
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observeSwarm(last);
    if (!obs.working && (obs.rollupReport || obs.swarmSkill)) {
      calm += 1;
      if (calm >= 3) return last;
    } else {
      calm = 0;
    }
    await sleep(800);
  }
  return last;
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.swarm-fanout-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(join(writeRootFor(side), 'a.txt'), { force: true });
  await rm(join(writeRootFor(side), 'b.txt'), { force: true });
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const observations = {};
  const prompt = swarmPrompt(side);
  let attempt;
  try {
    await writeFile(rulePath, ruleBytes);
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(ruleDigest) : piSpec(ruleDigest));
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitEither(attempt, GEOMETRY, ['first-run', 'pi'], 120_000);
    }
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);
    observations.ready = observeSwarm(await screenLines(attempt, GEOMETRY));

    attempt.input(Buffer.from(prompt), 'literal_user');
    await sleep(600);
    await dumpScreen(attempt, dir, '01-prompt-typed', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '02-prompt-submitted', GEOMETRY);

    try {
      await waitEither(
        attempt,
        GEOMETRY,
        [
          'swarm',
          'Swarm',
          'Fan out',
          'Frame',
          'WORKER-A',
          'WORKER-B',
          'Task',
          'Agent',
          'worker',
          'PASS',
          'ISSUES',
        ],
        300_000,
      );
    } catch {
      // keep going; final settle may still land evidence
    }
    await dumpScreen(attempt, dir, '03-fanout-signal', GEOMETRY);
    observations.mid = observeSwarm(await screenLines(attempt, GEOMETRY));
    observations.midFiles = await readWorkerFiles(side);

    const finalLines = await waitSwarmSettled(attempt, SETTLE_MS);
    try {
      await waitSettled(attempt, GEOMETRY, 60_000);
    } catch {
      // best-effort calm after rollup chrome
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '04-settled', GEOMETRY);
    observations.final = observeSwarm(finalLines.length ? finalLines : await screenLines(attempt, GEOMETRY));
    observations.files = await readWorkerFiles(side);

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
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
  }
}

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
    scenario: 'swarm:n2-isolated-writes',
    fixtureDigest: preDigest,
    results,
  }),
);
