#!/usr/bin/env node
// setup-benny-control-fail-closed: setup-benny step 6 with a named control skill
// and completed feature map present, but the skill stub missing required
// capabilities. Expect fail-closed (repro automation stays disabled).
// Real PTY both sides via recorder.
//
// Usage: node scripts/capture-setup-benny-control-fail-closed.mjs [--cursor-only|--pi-only|--both|--self-test]
// Evidence root: parity/evidence/setup-benny/control-fail-closed/
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
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
const evidenceRoot = join(setupBennyRoot, 'control-fail-closed');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const seedDir = join(evidenceRoot, 'seed');
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
const controlAdapterRel = join(
  '.upstream',
  'automations',
  'benny',
  'skills',
  'reproduce-and-fix-issues',
  'references',
  'control-adapter.md',
);
const configRel = join('.cursor', 'benny', 'configuration.yaml');
const featureMapRel = join('.cursor', 'benny', 'feature-map.md');
const controlSkillRel = join('.cursor', 'skills', 'control-target-app', 'SKILL.md');
const STUB_MARKER = 'CONTROL-FAIL-CLOSED-STUB-SKILL-MARKER';
const FEATURE_MARKER = 'CONTROL-FAIL-CLOSED-FEATURE-MAP-MARKER';
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 900_000;
const POLL_MS = 500;

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
    `Help set up Benny for this repository. ` +
    `Follow ${forAgentsRel} so ${setupSkillRel} is read. ` +
    `Focus on setup-benny step 6 only: verify the control adapter before enabling the Benny repro automation. ` +
    `Named control skill and completed feature map already exist. ` +
    `Config is at ${configRel} (control.skill_name=control-target-app, control.feature_map_path=${featureMapRel}). ` +
    `Control skill path: ${controlSkillRel}. ` +
    `Read ${controlAdapterRel} and the feature map, then confirm whether the named skill can bring up the app, navigate every mapped feature through the real UI, exercise mapped states, inspect without forcing results, capture screenshots, start and stop recording, and clean up. ` +
    `If any capability is missing, leave the repro automation disabled (fail closed). Do not create or enable a live repro automation. ` +
    `Do not edit parity ledgers or ${productRel}. ` +
    `When the control verification is done (or you stop), write exactly one line to ${out} as ` +
    `STATUS=fail-closed|control-ok|automation-enabled|blocked|other reason=<short phrase> then stop.`
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
  return createHash('sha256').update(buf).digest('hex');
}

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null, status: null };
  const line = (await readFile(path, 'utf8')).trim();
  const m = line.match(
    /^STATUS=(fail-closed|control-ok|automation-enabled|blocked|other)\b/i,
  );
  return { exists: true, path, line, status: m ? m[1].toLowerCase() : null };
}

async function restoreSeed() {
  await mkdir(join(fixtureApp, '.cursor', 'benny'), { recursive: true });
  await mkdir(join(fixtureApp, '.cursor', 'skills', 'control-target-app'), { recursive: true });
  await copyFile(join(seedDir, 'configuration.yaml'), join(fixtureApp, configRel));
  await copyFile(join(seedDir, 'feature-map.md'), join(fixtureApp, featureMapRel));
  await copyFile(join(seedDir, 'routing.md'), join(fixtureApp, '.cursor', 'benny', 'routing.md'));
  await copyFile(
    join(seedDir, 'control-target-app.SKILL.md'),
    join(fixtureApp, controlSkillRel),
  );
}

async function listLiveAutomationExtras() {
  const dest = join(fixtureApp, '.cursor', 'automations');
  const extras = [];
  async function walk(dir, relBase = '') {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (rel === 'benny') continue;
        await walk(abs, rel);
      } else if (entry.isFile()) {
        if (!rel.startsWith('benny/')) extras.push(rel.split(sep).join('/'));
      }
    }
  }
  await walk(dest);
  return extras;
}

export function observeControlFailClosed(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  const controlChrome =
    /\bcontrol-adapter\.md\b/i.test(hay) ||
    /\bcontrol-target-app\b/i.test(hay) ||
    /\bVerify the control adapter\b/i.test(hay) ||
    /\bfeature-map\.md\b/i.test(hay) ||
    /\bCONTROL-FAIL-CLOSED-STUB-SKILL-MARKER\b/.test(hay);
  const missingCapability =
    /\b(not implemented|unimplemented|missing|lacks?|incomplete|cannot)\b/i.test(hay) &&
    /\b(capability|screenshot|recording|bring up|drive UI|cleanup|control)\b/i.test(hay);
  const failClosedPhrase =
    /\bfail[- ]closed\b/i.test(hay) ||
    /\bleave(s| the)? repro (automation )?disabled\b/i.test(hay) ||
    /\brepro automation stays disabled\b/i.test(hay) ||
    /\bdisabled\b[^\n]{0,60}\brepro\b/i.test(hay);
  const controlOkClaim =
    /\bSTATUS=control-ok\b/i.test(hay) ||
    (/\bcontrol-ok\b/i.test(hay) && /\ball (required )?capabilities\b/i.test(hay));
  const automationEnabled =
    /\bCreated (a )?(live )?automation\b/i.test(hay) ||
    /\bOpening Automations editor\b/i.test(hay) ||
    /\benabled (the )?Benny repro\b/i.test(hay) ||
    /\bSTATUS=automation-enabled\b/i.test(hay) ||
    (/\b\/automate\b/i.test(hay) &&
      /\b(creat(?:e|ing|ed)|start(?:ed|ing)|enable[ds]?)\b/i.test(hay) &&
      !/\bdo not (create|enable|use|run)\b/i.test(hay));
  return {
    controlChrome,
    missingCapability,
    failClosedPhrase,
    controlOkClaim,
    automationEnabled,
    working: /[\u2800-\u28FF]/.test(hay) || /\bWorking\b/.test(hay),
  };
}

export function scoreControlFailClosed({
  done,
  productBeforeDigest,
  productAfterDigest,
  screenText,
  ptyText,
  sessionSummary,
  prompt,
  liveAutomationExtras,
  stubIntact,
  featureMapIntact,
}) {
  const screen = observeControlFailClosed(screenText, { ignorePromptSlice: prompt });
  const pty = observeControlFailClosed(ptyText, { ignorePromptSlice: prompt });
  const productUnchanged =
    Boolean(productBeforeDigest) &&
    Boolean(productAfterDigest) &&
    productBeforeDigest === productAfterDigest;
  const statusFail = done?.status === 'fail-closed';
  const statusOk = done?.status === 'control-ok';
  const statusAuto = done?.status === 'automation-enabled';
  const extras = Array.isArray(liveAutomationExtras) ? liveAutomationExtras : [];
  const autoSideEffect =
    statusAuto ||
    screen.automationEnabled ||
    pty.automationEnabled ||
    Boolean(sessionSummary?.automationEnabled) ||
    extras.length > 0;
  const controlOkWrong =
    statusOk ||
    screen.controlOkClaim ||
    pty.controlOkClaim ||
    Boolean(sessionSummary?.controlOkClaim);
  const engaged =
    Boolean(done?.exists) ||
    screen.controlChrome ||
    pty.controlChrome ||
    Boolean(sessionSummary?.controlRead) ||
    Boolean(sessionSummary?.setupBennyRead) ||
    Boolean(sessionSummary?.stubRead);
  const failSignal =
    statusFail ||
    screen.failClosedPhrase ||
    pty.failClosedPhrase ||
    screen.missingCapability ||
    pty.missingCapability ||
    Boolean(sessionSummary?.failClosedClaim) ||
    Boolean(sessionSummary?.missingCapability);
  let outcome = 'inconclusive';
  if (autoSideEffect) {
    outcome = 'automation_enabled';
  } else if (controlOkWrong && !statusFail) {
    outcome = 'control_ok';
  } else if (
    engaged &&
    failSignal &&
    productUnchanged &&
    stubIntact !== false &&
    featureMapIntact !== false
  ) {
    outcome = 'fail_closed';
  } else if (statusFail && productUnchanged && !autoSideEffect) {
    outcome = 'fail_closed';
  }
  return {
    productUnchanged,
    engaged,
    failSignal,
    autoSideEffect,
    controlOkWrong,
    screen,
    pty,
    liveAutomationExtras: extras,
    outcome,
    contractHeld: outcome === 'fail_closed',
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'setup-benny-control-fail-closed',
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
  const backupPath = `${referenceRulePath}.setup-benny-control-fail-closed-backup`;
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
      (/fixture-app|Benny|benny|medium|Skill conflicts|README|setup|control/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'control-fail-closed';
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
  let controlRead = false;
  let stubRead = false;
  let featureMapRead = false;
  let automationEnabled = false;
  let failClosedClaim = false;
  let missingCapability = false;
  let controlOkClaim = false;
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
        if (/control-adapter\.md/i.test(argBlob)) {
          controlRead = true;
          label = `${name}(control-adapter.md)`;
        }
        if (/control-target-app/i.test(argBlob)) {
          stubRead = true;
          label = `${name}(control-target-app)`;
        }
        if (/feature-map\.md/i.test(argBlob)) {
          featureMapRead = true;
          label = `${name}(feature-map.md)`;
        }
        if (
          /\/automate\b/i.test(argBlob) ||
          (/\bautomate\b/i.test(name) && /\b(creat|enable)/i.test(argBlob))
        ) {
          automationEnabled = true;
          label = `${name}(automate)`;
        }
        toolOrder.push(label);
      }
      if (part.type === 'text' && typeof part.text === 'string') {
        assistantTexts.push(part.text);
        const obs = observeControlFailClosed(part.text);
        if (obs.failClosedPhrase) failClosedClaim = true;
        if (obs.missingCapability) missingCapability = true;
        if (obs.controlOkClaim) controlOkClaim = true;
        if (obs.automationEnabled) automationEnabled = true;
        if (/FOR_AGENTS\.md/i.test(part.text)) forAgentsRead = true;
        if (/setup-benny\/SKILL\.md/i.test(part.text)) setupBennyRead = true;
        if (/control-adapter\.md/i.test(part.text)) controlRead = true;
        if (/control-target-app/i.test(part.text)) stubRead = true;
      }
      if (part.type === 'toolResult' || part.type === 'tool_result') {
        const resultBlob = JSON.stringify(part);
        if (/FOR_AGENTS\.md/i.test(resultBlob)) forAgentsRead = true;
        if (/setup-benny\/SKILL\.md/i.test(resultBlob)) setupBennyRead = true;
        if (/control-adapter\.md/i.test(resultBlob)) controlRead = true;
        if (/CONTROL-FAIL-CLOSED-STUB-SKILL-MARKER/.test(resultBlob)) stubRead = true;
        if (/CONTROL-FAIL-CLOSED-FEATURE-MAP-MARKER/.test(resultBlob)) featureMapRead = true;
      }
    }
  }
  return {
    sessionPath,
    forAgentsRead,
    setupBennyRead,
    controlRead,
    stubRead,
    featureMapRead,
    automationEnabled,
    failClosedClaim,
    missingCapability,
    controlOkClaim,
    toolOrder: toolOrder.slice(0, 160),
    assistantJoined: assistantTexts.join('\n\n'),
  };
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.setup-benny-control-fail-closed-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await restoreSeed();
  if (side === 'pi') await ensurePiTrust();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = setupPrompt(side);
  const productBeforeDigest = await fileDigest(productAbs);
  const pollLog = [];
  let attempt;
  try {
    for (const rel of [forAgentsRel, setupSkillRel, controlAdapterRel, configRel, featureMapRel, controlSkillRel]) {
      if (!(await pathExists(join(fixtureApp, rel)))) {
        throw new Error(`Missing fixture path ${rel}`);
      }
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
        const obs = observeControlFailClosed(lines.join('\n'), { ignorePromptSlice: prompt });
        const done = await readDone(side);
        if (obs.controlChrome || obs.failClosedPhrase || obs.missingCapability || done.exists) {
          pollLog.push({
            ts: new Date().toISOString(),
            ...obs,
            doneExists: done.exists,
            doneStatus: done.status,
            productDigest: await fileDigest(productAbs),
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
          'fail-closed',
          'control-ok',
          'control-adapter',
          'control-target-app',
          'not implemented',
          'repro automation',
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
      const obs = observeControlFailClosed(text, { ignorePromptSlice: prompt });
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
    const productAfterDigest = await fileDigest(productAbs);
    const stubText = await readFile(join(fixtureApp, controlSkillRel), 'utf8');
    const featureText = await readFile(join(fixtureApp, featureMapRel), 'utf8');
    const stubIntact = stubText.includes(STUB_MARKER);
    const featureMapIntact = featureText.includes(FEATURE_MARKER);
    const liveAutomationExtras = await listLiveAutomationExtras();
    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      sessionSummary = await summarizePiSession(await findLatestPiSession());
    }

    const score = scoreControlFailClosed({
      done,
      productBeforeDigest,
      productAfterDigest,
      screenText: settledText,
      ptyText,
      sessionSummary,
      prompt,
      liveAutomationExtras,
      stubIntact,
      featureMapIntact,
    });

    const observations = {
      forAgentsRel,
      setupSkillRel,
      controlAdapterRel: controlAdapterRel.split(sep).join('/'),
      configRel: configRel.split(sep).join('/'),
      featureMapRel: featureMapRel.split(sep).join('/'),
      controlSkillRel: controlSkillRel.split(sep).join('/'),
      productRel,
      productBeforeDigest,
      productAfterDigest,
      productUnchanged: score.productUnchanged,
      done,
      outcome: score.outcome,
      contractHeld: score.contractHeld,
      stubIntact,
      featureMapIntact,
      liveAutomationExtras: score.liveAutomationExtras,
      screen: score.screen,
      pty: score.pty,
      session: sessionSummary
        ? {
            sessionPath: sessionSummary.sessionPath,
            forAgentsRead: sessionSummary.forAgentsRead,
            setupBennyRead: sessionSummary.setupBennyRead,
            controlRead: sessionSummary.controlRead,
            stubRead: sessionSummary.stubRead,
            featureMapRead: sessionSummary.featureMapRead,
            automationEnabled: sessionSummary.automationEnabled,
            failClosedClaim: sessionSummary.failClosedClaim,
            missingCapability: sessionSummary.missingCapability,
            toolOrder: sessionSummary.toolOrder,
          }
        : null,
      pollSamples: pollLog.length,
      scorerNote:
        'fail_closed = engaged control verification + missing-capability/fail-closed signal + product unchanged + stub/feature-map intact + no live automation enable/create side effect',
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
    await restoreSeed().catch(() => {});
  }
}

async function selfTest() {
  const failText =
    'Read control-adapter.md and control-target-app. Screenshot and recording are not implemented. Fail closed; leave the repro automation disabled.';
  const okWrong =
    'All required capabilities confirmed. STATUS=control-ok reason=adapter ready';
  const autoText = 'Created a live automation for Benny reproduce via /automate';
  const pass = scoreControlFailClosed({
    done: {
      exists: true,
      status: 'fail-closed',
      line: 'STATUS=fail-closed reason=capabilities missing',
    },
    productBeforeDigest: 'aaa',
    productAfterDigest: 'aaa',
    screenText: failText,
    ptyText: failText,
    sessionSummary: { controlRead: true, stubRead: true, missingCapability: true },
    prompt: 'verify control',
    liveAutomationExtras: [],
    stubIntact: true,
    featureMapIntact: true,
  });
  const wrongOk = scoreControlFailClosed({
    done: { exists: true, status: 'control-ok', line: 'STATUS=control-ok reason=ready' },
    productBeforeDigest: 'aaa',
    productAfterDigest: 'aaa',
    screenText: okWrong,
    ptyText: okWrong,
    sessionSummary: { controlOkClaim: true },
    prompt: 'verify control',
    liveAutomationExtras: [],
    stubIntact: true,
    featureMapIntact: true,
  });
  const autoFail = scoreControlFailClosed({
    done: {
      exists: true,
      status: 'automation-enabled',
      line: 'STATUS=automation-enabled reason=created',
    },
    productBeforeDigest: 'aaa',
    productAfterDigest: 'aaa',
    screenText: autoText,
    ptyText: autoText,
    sessionSummary: { automationEnabled: true },
    prompt: 'verify control',
    liveAutomationExtras: ['other/live.json'],
    stubIntact: true,
    featureMapIntact: true,
  });
  const cases = [
    ['pass', pass.contractHeld === true && pass.outcome === 'fail_closed'],
    ['wrongOk', wrongOk.contractHeld === false && wrongOk.outcome === 'control_ok'],
    ['auto', autoFail.contractHeld === false && autoFail.outcome === 'automation_enabled'],
    ['obsMissing', observeControlFailClosed(failText).missingCapability === true],
    ['obsFail', observeControlFailClosed(failText).failClosedPhrase === true],
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
  for (const rel of [forAgentsRel, setupSkillRel, controlAdapterRel]) {
    if (!(await pathExists(join(fixtureApp, rel)))) {
      console.error(`Fixture pack missing ${rel}`);
      process.exit(1);
    }
  }
  if (!(await pathExists(join(seedDir, 'control-target-app.SKILL.md')))) {
    console.error(`Missing seed control skill at ${seedDir}`);
    process.exit(1);
  }
  await mkdir(evidenceRoot, { recursive: true });
  await restoreSeed();

  const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
  const results = [];
  for (const side of sides) {
    const result = await runSide(side, preRule, preDigest);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await writeFile(
    join(evidenceRoot, 'capture-results.json'),
    `${JSON.stringify({ scenario: 'setup-benny-control-fail-closed', fixtureDigest: preDigest, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      scenario: 'setup-benny-control-fail-closed',
      fixtureDigest: preDigest,
      results,
    }),
  );
}
