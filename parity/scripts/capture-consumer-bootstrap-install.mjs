#!/usr/bin/env node
// Consumer journey pair: Cursor+Pi PTY both exercise source-tools-bootstrap.
// Capture script forces an install-key mismatch, then agents run
// bun run orch/orch.ts --help. bootstrap.ts then runs bun install
// --frozen-lockfile, rewrites the install key, and restarts. Install stdout is
// silent on success by design, so the oracle is file postconditions + help
// chrome + done marker, not a screen string for "bun install".
//
// Usage: node scripts/capture-consumer-bootstrap-install.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/consumer/
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitScreen } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'consumer');
const toolsCwd = join(
  root,
  'reference',
  'cursor-plugins',
  'pstack',
  'skills',
  'poteto-mode',
  'scripts',
);
const consumerPath =
  'parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/bootstrap.ts';
const installKeyPath = join(toolsCwd, 'node_modules', '.poteto-mode-tools-install-key');
const commanderPackagePath = join(toolsCwd, 'node_modules', 'commander', 'package.json');
const GEOMETRY = { rows: 36, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const LOCKED_CONSUMER_DIGEST = 'ccd2ed08fd9da9d0d942e5f2491cfc74bb92d8a08fa51755e0da1ac8de287361';
const FORCE_KEY = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const SETTLE_MS = 600_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeRootFor(side) {
  return join(evidenceRoot, 'fixture-out', side);
}

function donePath(side) {
  return join(writeRootFor(side), 'bootstrap-install-done.txt');
}

function promptFor(side) {
  const out = donePath(side);
  return (
    `In this cwd, run exactly: bun run orch/orch.ts --help ` +
    `Do not edit files. Do not change the store. ` +
    `A prior install-key mismatch may trigger a frozen install and process restart; that is expected. ` +
    `After the command exits 0, paste the Usage line and the Commands list, ` +
    `then write exactly one line EXIT=0 to ${out} and stop.`
  );
}

function observeHelp(lines) {
  const text = lines.join('\n');
  return {
    usageOrch: /Usage:\s*orch/i.test(text),
    commandsHeader: /Commands:/i.test(text),
    cmdInit: /\binit\b/.test(text),
    cmdUnit: /\bunit\b/.test(text),
    cmdStanding: /\bstanding\b/.test(text),
    helpFlag: /-h,\s*--help/i.test(text) || /display help for command/i.test(text),
    installMention: /bun\s+install|--frozen-lockfile/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function helpChromeOk(obs) {
  return obs.usageOrch && obs.commandsHeader && obs.cmdInit && (obs.cmdUnit || obs.cmdStanding);
}

async function currentInstallKey() {
  const packageJson = await readFile(join(toolsCwd, 'package.json'));
  const bunLock = await readFile(join(toolsCwd, 'bun.lock'));
  return createHash('sha256').update(packageJson).update('\0').update(bunLock).digest('hex');
}

async function readInstallKey() {
  try {
    return (await readFile(installKeyPath, 'utf8')).trim();
  } catch {
    return null;
  }
}

async function forceInstallKeyMismatch() {
  const expected = await currentInstallKey();
  const before = await readInstallKey();
  await mkdir(join(toolsCwd, 'node_modules'), { recursive: true });
  await writeFile(installKeyPath, `${FORCE_KEY}\n`);
  return { expected, before, forced: FORCE_KEY };
}

async function restoreInstallKey(expected) {
  await writeFile(installKeyPath, `${expected}\n`);
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'consumer:bootstrap-frozen-install',
    fixtureRef: { path: fixturePath, digest: fixtureDigest },
    artifactPaths: [join(toolsCwd, 'bootstrap.ts')],
    launch: { argv, cwd, env },
    geometry: GEOMETRY,
  };
}

const cursorSpec = (fixtureDigest) =>
  spec({
    side: 'cursor',
    cwd: toolsCwd,
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
    cwd: toolsCwd,
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

async function ensurePiTrust() {
  const trustPath = join(piAgentDir, 'trust.json');
  let current = {};
  try {
    current = JSON.parse(await readFile(trustPath, 'utf8'));
  } catch {
    current = {};
  }
  if (current[toolsCwd] === true) return;
  await mkdir(piAgentDir, { recursive: true });
  await writeFile(trustPath, `${JSON.stringify({ ...current, [toolsCwd]: true }, null, 2)}\n`);
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
    if (
      !/Trust project folder\?/i.test(text) &&
      (/claude-subscription|claude-sonnet/i.test(text) || /\$0\.\d+/.test(text))
    ) {
      return lines;
    }
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function waitHelpSettled(attempt, side, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let calm = 0;
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observeHelp(last);
    let doneOk = false;
    try {
      const line = (await readFile(donePath(side), 'utf8')).trim();
      doneOk = line === 'EXIT=0';
    } catch {
      doneOk = false;
    }
    const chrome = helpChromeOk(obs);
    if (chrome && doneOk && !obs.working) {
      calm += 1;
      if (calm >= 3) return { lines: last, observations: obs, doneOk };
    } else {
      calm = 0;
    }
    await sleep(500);
  }
  const obs = observeHelp(last);
  let doneOk = false;
  try {
    doneOk = (await readFile(donePath(side), 'utf8')).trim() === 'EXIT=0';
  } catch {
    doneOk = false;
  }
  return { lines: last, observations: obs, doneOk };
}

async function runSide(side, ruleBytes, ruleDigest) {
  await mkdir(join(evidenceRoot, side), { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await writeFile(donePath(side), '');
  if (side === 'pi') await ensurePiTrust();
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  let attempt;
  let expectedKey = null;
  try {
    const forced = await forceInstallKeyMismatch();
    expectedKey = forced.expected;
    await writeFile(rulePath, ruleBytes);
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(ruleDigest) : piSpec(ruleDigest));
    const dir = attempt.dir;
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitPiChatReady(attempt, 120_000);
    }
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);

    const prompt = promptFor(side);
    attempt.input(Buffer.from(prompt), 'literal_user');
    await sleep(600);
    await dumpScreen(attempt, dir, '01-typed', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '02-submitted', GEOMETRY);

    try {
      await waitScreen(attempt, GEOMETRY, 'Usage:', 420_000);
    } catch {
      // settle loop still judges chrome + done marker
    }
    const settled = await waitHelpSettled(attempt, side, SETTLE_MS);
    await dumpScreen(attempt, dir, '03-settled', GEOMETRY);

    const afterKey = await readInstallKey();
    const commanderPresent = existsSync(commanderPackagePath);
    const keyRewrittenToExpected = afterKey === expectedKey;
    const consumerDigest = await sha256(join(toolsCwd, 'bootstrap.ts'));
    const consumerHex = consumerDigest.replace(/^sha256:/, '');
    const identity = JSON.parse(await readFile(join(attempt.dir, 'identity.json'), 'utf8'));
    const observations = {
      afterHelp: settled.observations,
      helpChromeOk: helpChromeOk(settled.observations),
      doneMarkerOk: settled.doneOk,
      consumerPath,
      consumerSha256: consumerHex,
      consumerMatchesLocked: consumerHex === LOCKED_CONSUMER_DIGEST,
      installKeyBeforeForced: forced.before,
      installKeyForced: forced.forced,
      installKeyExpected: expectedKey,
      installKeyAfter: afterKey,
      installKeyRewrittenToExpected: keyRewrittenToExpected,
      commanderPresentAfter: commanderPresent,
      bootstrapFileOracleOk: keyRewrittenToExpected && commanderPresent,
      journeyClosed:
        helpChromeOk(settled.observations) &&
        settled.doneOk &&
        consumerHex === LOCKED_CONSUMER_DIGEST &&
        keyRewrittenToExpected &&
        commanderPresent,
    };
    await writeFile(
      join(dir, 'observations-bootstrap-install.json'),
      `${JSON.stringify(observations, null, 2)}\n`,
    );
    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      fixtureDigest: ruleDigest,
      executable: identity.executable ?? null,
      observedEnv: identity.observedEnv ?? null,
      observations,
      screenSettled: join(attempt.dir, 'screen-03-settled.txt'),
    };
  } finally {
    if (expectedKey) {
      await restoreInstallKey(expectedKey).catch(() => {});
    }
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
  }
}

const preRule = await readFile(referenceRulePath, 'utf8');
const preDigest = await sha256(referenceRulePath);
if (preDigest !== LOCKED_FIXTURE_DIGEST) {
  console.error(`Reference rule digest ${preDigest} does not match locked fixture ${LOCKED_FIXTURE_DIGEST}`);
  process.exit(1);
}
await mkdir(join(piAgentDir, 'pstack'), { recursive: true });
await mkdir(evidenceRoot, { recursive: true });

const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
const results = [];
for (const side of sides) {
  const result = await runSide(side, preRule, preDigest);
  results.push(result);
  console.log(
    JSON.stringify({
      side: result.side,
      attemptId: result.attemptId,
      journeyClosed: result.observations.journeyClosed,
      helpChromeOk: result.observations.helpChromeOk,
      doneMarkerOk: result.observations.doneMarkerOk,
      bootstrapFileOracleOk: result.observations.bootstrapFileOracleOk,
    }),
  );
}

const bySide = Object.fromEntries(results.map((r) => [r.side, r]));
if (bySide.cursor && bySide.pi) {
  const pair = {
    schema: 1,
    pairId: 'consumer-bootstrap-install-1',
    scenarioRef: 'consumer:bootstrap-frozen-install',
    matrixJourney: {
      packageId: 'source-tools-bootstrap',
      activation: 'install',
      consumerPath,
      acceptanceJourney:
        'Paired journey proving frozen bun install --frozen-lockfile and restart after install-key change',
    },
    fixtureDigest: preDigest,
    promptSharedShape:
      'Force install-key mismatch; run bun run orch/orch.ts --help; write EXIT=0 to side-specific done path',
    steps: [
      { force: 'install-key mismatch' },
      { send: 'bun run orch/orch.ts --help … EXIT=0 …' },
      { send: '\r' },
      { settle: true },
      { cancel: true },
      { restore: 'install-key' },
    ],
    cursor: {
      attemptId: bySide.cursor.attemptId,
      dir: bySide.cursor.attemptDir,
      screenSettled: bySide.cursor.screenSettled,
      executable: bySide.cursor.executable,
      observedEnv: bySide.cursor.observedEnv,
      observations: bySide.cursor.observations,
    },
    pi: {
      attemptId: bySide.pi.attemptId,
      dir: bySide.pi.attemptDir,
      screenSettled: bySide.pi.screenSettled,
      executable: bySide.pi.executable,
      observedEnv: bySide.pi.observedEnv,
      observations: bySide.pi.observations,
    },
    pairClosed:
      bySide.cursor.observations.journeyClosed === true &&
      bySide.pi.observations.journeyClosed === true,
    provenance: {
      capturedWith: `parity/scripts/capture-consumer-bootstrap-install.mjs ${only}`,
      toolsCwd,
      piAgentDir,
      lockedConsumerSha256: LOCKED_CONSUMER_DIGEST,
      installStdoutNote:
        'bootstrap.ts writes install stdout only on failure; success path is proven by install-key rewrite + commander presence + post-restart help chrome',
    },
  };
  const pairPath = join(evidenceRoot, 'pair-consumer-bootstrap-install-1.json');
  await writeFile(pairPath, `${JSON.stringify(pair, null, 2)}\n`);
  console.log(JSON.stringify({ pairPath, pairClosed: pair.pairClosed }));
}

console.log(
  JSON.stringify({
    scenario: 'consumer:bootstrap-frozen-install',
    fixtureDigest: preDigest,
    results: results.map((r) => ({
      side: r.side,
      attemptId: r.attemptId,
      attemptDir: r.attemptDir,
      journeyClosed: r.observations.journeyClosed,
    })),
  }),
);
