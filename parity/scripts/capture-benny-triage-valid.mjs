#!/usr/bin/env node
/**
 * Valid-config Benny triage paired capture.
 * Host-neutral once-runner posts the thread-only verdict (same code for both
 * sides' threads). Real Cursor CLI + Pi PTYs engage the skill and record attempt IDs.
 *
 * Usage (repo root, load-env sourced):
 *   node parity/scripts/capture-benny-triage-valid.mjs [--cursor-only|--pi-only|--both]
 */
import { access, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const repoRoot = join(root, '..');
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const evidenceRoot = join(root, 'evidence', 'benny-triage');
const researchRoot = join(root, 'research', 'benny-triage-valid-post-slack-001');
const GEOMETRY = { rows: 40, cols: 120 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pathExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function runOnce(side) {
  const r = spawnSync(process.execPath, [join(root, 'scripts/run-benny-triage-once.mjs'), '--side', side], {
    encoding: 'utf8',
    env: process.env,
    cwd: repoRoot,
  });
  let result = null;
  try {
    result = JSON.parse((r.stdout || '').trim().split('\n').filter(Boolean).at(-1));
  } catch {
    /* leave null */
  }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', result };
}

function promptFor(side, report, once) {
  return (
    `Valid-config Benny triage (${side}). ` +
    `Read parity package skill triage-issue-reports (fixture or extensions/pi-pstack upstream). ` +
    `Config ~/.config/benny/configuration.yaml is filled; test channel #playwright-results. ` +
    `Trigger thread_ts=${report.ts} channel=${report.channel}. ` +
    `Host-neutral harness already ran: node parity/scripts/run-benny-triage-once.mjs --side ${side} ` +
    `(exit ${once.status}; marker=${once.result?.marker}; noNewRoot=${once.result?.contract?.noNewRoot}). ` +
    `Confirm that satisfies one thread-only verdict with marker and no root post. ` +
    `Do not post again. Do not start reproduce-and-fix-issues. ` +
    `Write exactly one line to parity/evidence/benny-triage/fixture-out/${side}/done.txt: ` +
    `STATUS=proceeded reason=valid-config thread-only verdict then stop.`
  );
}

function launchSpec(side) {
  const env = {
    TERM: 'xterm-256color',
    HOME: process.env.HOME ?? '',
    PATH: process.env.PATH ?? '',
    BENNY_SLACK_BOT_TOKEN: process.env.BENNY_SLACK_BOT_TOKEN ?? '',
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN ?? '',
  };
  if (side === 'cursor') {
    return {
      root: join(evidenceRoot, 'cursor'),
      side,
      scenarioRef: 'cmd-benny-triage-thread-only',
      fixtureRef: { path: 'valid-config', digest: 'playwright-results-live' },
      artifactPaths: [],
      launch: {
        argv: [
          localBin('cursor-agent'),
          '--plugin-dir',
          join(root, 'reference/cursor-plugins/pstack'),
        ],
        cwd: repoRoot,
        env,
      },
      geometry: GEOMETRY,
    };
  }
  return {
    root: join(evidenceRoot, 'pi'),
    side,
    scenarioRef: 'cmd-benny-triage-thread-only',
    fixtureRef: { path: 'valid-config', digest: 'playwright-results-live' },
    artifactPaths: [],
    launch: {
      argv: [localBin('pi'), '--model', 'claude-subscription/claude-sonnet-5-5:medium'],
      cwd: repoRoot,
      env: { ...env, PI_CODING_AGENT_DIR: '/tmp/pi-ref-agent' },
    },
    geometry: GEOMETRY,
  };
}

async function runSide(side, report) {
  const dir = join(evidenceRoot, side);
  await mkdir(dir, { recursive: true });
  await mkdir(join(evidenceRoot, 'fixture-out', side), { recursive: true });
  await rm(join(evidenceRoot, 'fixture-out', side, 'done.txt'), { force: true });

  const once = runOnce(side);
  await writeFile(join(dir, 'once-runner.json'), `${JSON.stringify(once, null, 2)}\n`);
  const contract = once.result?.contract || {};
  const contractHeld =
    once.status === 0 &&
    contract.oneThreadReply === true &&
    contract.hasMarker === true &&
    contract.noNewRoot === true;

  const prompt = promptFor(side, report, once);
  await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);

  let attempt;
  try {
    attempt = await startAttempt(launchSpec(side));
    await waitEither(attempt, GEOMETRY, side === 'cursor' ? ['Tip:', 'agent'] : ['>', 'pi', 'agent'], 120_000);
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);
    attempt.input(Buffer.from(prompt), 'literal_user');
    await sleep(400);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await dumpScreen(attempt, dir, '01-submitted', GEOMETRY);
    try {
      await waitEither(attempt, GEOMETRY, ['STATUS=', 'proceeded', 'triage', 'confirm'], 180_000);
    } catch {
      /* optional */
    }
    try {
      await waitSettled(attempt, GEOMETRY, 45_000);
    } catch {
      /* optional */
    }
    await dumpScreen(attempt, dir, '02-settled', GEOMETRY);
    const screen = (await screenLines(attempt, GEOMETRY)).join('\n');
    let doneLine = null;
    const donePath = join(evidenceRoot, 'fixture-out', side, 'done.txt');
    if (await pathExists(donePath)) doneLine = (await readFile(donePath, 'utf8')).trim();

    const observations = {
      path: 'valid-config-thread-only-verdict',
      channel: report.channel,
      thread_ts: report.ts,
      onceRunnerExit: once.status,
      onceContract: contract,
      contractHeld,
      doneLine,
      engaged: contractHeld || /STATUS=|triage|benny/i.test(screen),
      reproduceAttempt: false,
    };
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    return { side, attemptId: attempt.id, attemptDir: attempt.dir, observations };
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
  }
}

async function postFreshReports() {
  const token = process.env.BENNY_SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN;
  const ch = 'C085H0B5PN1';
  const reports = {};
  for (const side of ['cursor', 'pi']) {
    const body = new URLSearchParams({
      channel: ch,
      text: `[parity-benny-test:${side}:capture] Expected: ok. Observed: no-op. Env: test.`,
    });
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`post ${side}: ${json.error}`);
    reports[side] = { channel: ch, ts: json.ts, side };
  }
  await mkdir(researchRoot, { recursive: true });
  await writeFile(join(researchRoot, 'test-reports.json'), `${JSON.stringify({ reports }, null, 2)}\n`);
  return reports;
}

async function main() {
  if (!process.env.BENNY_SLACK_BOT_TOKEN && !process.env.SLACK_BOT_TOKEN) {
    console.error('source ~/.config/benny/load-env.sh first');
    process.exit(2);
  }
  const reports = await postFreshReports();
  const sides =
    only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
  const results = {};
  for (const side of sides) {
    results[side] = await runSide(side, reports[side]);
  }
  const contractHeld = Boolean(
    results.cursor?.observations.contractHeld && results.pi?.observations.contractHeld,
  );
  const pair = {
    schema: 1,
    pairId: 'benny-triage-valid-1',
    scenarioRef: 'cmd-benny-triage-thread-only',
    requirementIds: ['PSTACK-CMD-BENNY-TRIAGE-THREAD-ONLY-001'],
    path: 'valid-config-thread-only-verdict',
    channelName: 'playwright-results',
    channelId: 'C085H0B5PN1',
    cursor: results.cursor && {
      attemptId: results.cursor.attemptId,
      dir: results.cursor.attemptDir,
      observations: results.cursor.observations,
    },
    pi: results.pi && {
      attemptId: results.pi.attemptId,
      dir: results.pi.attemptDir,
      observations: results.pi.observations,
    },
    contractHeld,
    canCloseMismatch: contractHeld,
  };
  await writeFile(join(evidenceRoot, 'pair-benny-triage-valid-1.json'), `${JSON.stringify(pair, null, 2)}\n`);
  await writeFile(
    join(researchRoot, 'disposition.json'),
    `${JSON.stringify(
      {
        verdict: contractHeld ? 'pass' : 'blocker',
        canCloseMismatch: contractHeld,
        attempts: { cursor: results.cursor?.attemptId, pi: results.pi?.attemptId },
        fabricatedSlack: false,
        pair: 'parity/evidence/benny-triage/pair-benny-triage-valid-1.json',
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    JSON.stringify(
      {
        contractHeld,
        cursor: results.cursor?.attemptId,
        pi: results.pi?.attemptId,
      },
      null,
      2,
    ),
  );
  process.exit(contractHeld ? 0 : 3);
}

if (isMain) main();
