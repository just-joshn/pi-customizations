#!/usr/bin/env node
// cmd-setup-benny-not-slash: follow FOR_AGENTS.md bootstrap so setup-benny is
// read at the destination pack path. Expect not-a-slash-skill entry and no
// live automation creation. Real PTY both sides via recorder.
//
// Usage: node scripts/capture-setup-benny-not-slash.mjs [--cursor-only|--pi-only|--both|--self-test]
// Evidence root: parity/evidence/setup-benny/
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
const evidenceRoot = join(root, 'evidence', 'setup-benny');
const fixtureApp = join(evidenceRoot, 'fixture-app');
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
    `You are helping set up Benny for this repository. ` +
    `The human pointed you at ${forAgentsRel}. ` +
    `Read and follow that FOR_AGENTS.md bootstrap so ${setupSkillRel} is read at the destination path. ` +
    `Treat setup-benny as not a plugin slash skill. Do not look for or invoke a discovered Benny slash skill. Do not run /setup-benny. ` +
    `Do not create or update a live automation in this turn. Do not write secret values into plugin files, prompts, or committed configuration. ` +
    `Do not edit parity ledgers or ${productRel}. ` +
    `After you have confirmed entry via pack bootstrap to the destination setup-benny path and either asked the first required setup question or verified the pack copy is present, stop. ` +
    `When you stop for any reason, write exactly one line to ${out} as ` +
    `STATUS=not-slash|slash-invoked|automation-created|blocked|other reason=<short phrase> then stop.`
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
  const m = line.match(/^STATUS=(not-slash|slash-invoked|automation-created|blocked|other)\b/i);
  return { exists: true, path, line, status: m ? m[1].toLowerCase() : null };
}

function stripNegatedSetupSlashMentions(hay) {
  // Prompt + assistant denials still contain the token `/setup-benny`
  // (often backtick-wrapped). Strip those before scoring affirmative invoke.
  const slashTok = '[`\'"]*\\/setup-benny[`\'"]*';
  return hay
    .replace(/\bSTATUS=not-slash\|slash-invoked\|automation-created\|blocked\|other[^\n]*/gi, ' ')
    .replace(
      new RegExp(
        String.raw`\b(?:do not|don't|did not|didn't)\s+(?:look for or invoke|invoke|run)\s+(?:a\s+)?(?:discovered\s+)?(?:Benny\s+)?(?:slash\s+skill|${slashTok})\b`,
        'gi',
      ),
      ' ',
    )
    .replace(new RegExp(String.raw`\b(?:do not|don't|did not|didn't)\s+run\s+${slashTok}\b`, 'gi'), ' ')
    .replace(new RegExp(String.raw`\bI (?:did not|didn't) run\s+${slashTok}\b`, 'gi'), ' ')
    .replace(/\btreated[^\n.]{0,80}not a slash skill\b/gi, ' ')
    .replace(new RegExp(String.raw`\bI treated[^\n.]{0,160}${slashTok}\b`, 'gi'), ' ');
}

export function observeSetupBennyNotSlash(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  hay = stripNegatedSetupSlashMentions(hay);
  const forAgentsChrome =
    /FOR_AGENTS\.md/i.test(hay) ||
    /\.upstream\/automations\/benny\/FOR_AGENTS/i.test(hay);
  const setupBennyPathChrome =
    /setup-benny\/SKILL\.md/i.test(hay) ||
    /\.upstream\/automations\/benny\/skills\/setup-benny/i.test(hay);
  const notSlashClaim =
    /\bnot (a |an )?(plugin )?slash skill\b/i.test(hay) ||
    /\bnot (registered as )?slash skills?\b/i.test(hay) ||
    /\bdisable-model-invocation\b/i.test(hay) ||
    /\bpack content, not a slash skill\b/i.test(hay) ||
    /\bdo not (look for|invoke|run) .*slash\b/i.test(hay);
  // Affirmative slash invocation only (after negation strip).
  const slashInvoked =
    /\bInvok(?:ed|ing)\s+\/setup-benny\b/i.test(hay) ||
    /\bUsed (?:skill\s+)?\/?setup-benny\b/i.test(hay) ||
    /\bRunning\s+\/setup-benny\b/i.test(hay) ||
    /(?:^|[\s"'`])\/setup-benny\b/i.test(hay) ||
    /\bslash.?menu\b.*\bsetup-benny\b/i.test(hay) ||
    /\bsetup-benny\b.*\bslash.?menu\b/i.test(hay);
  // `/automate` appears in FOR_AGENTS prose as future step; require create chrome.
  const automationCreated =
    /\bCreated (a )?(live )?automation\b/i.test(hay) ||
    /\bOpening Automations editor\b/i.test(hay) ||
    (/\b\/automate\b/i.test(hay) &&
      /\b(creat(?:e|ing|ed)|start(?:ed|ing)|open(?:ed|ing))\b/i.test(hay) &&
      !/\bdo not (create|use|run)\b/i.test(hay) &&
      !/\buntil (the user|i) explicitly ask/i.test(hay));
  const secretWrite =
    /\b(slack[_-]?bot[_-]?token|xoxb-|xoxp-)\b/i.test(hay) &&
    /\b(wrote|writing|saved|committed)\b/i.test(hay);
  return {
    forAgentsChrome,
    setupBennyPathChrome,
    notSlashClaim,
    slashInvoked,
    automationCreated,
    secretWrite,
    working: /[\u2800-\u28FF]/.test(hay) || /\bWorking\b/.test(hay),
  };
}

export function scoreSetupBennyNotSlash({
  done,
  productBeforeDigest,
  productAfterDigest,
  screenText,
  ptyText,
  sessionSummary,
  prompt,
}) {
  const screen = observeSetupBennyNotSlash(screenText, { ignorePromptSlice: prompt });
  const pty = observeSetupBennyNotSlash(ptyText, { ignorePromptSlice: prompt });
  const productUnchanged =
    Boolean(productBeforeDigest) &&
    Boolean(productAfterDigest) &&
    productBeforeDigest === productAfterDigest;
  const statusNotSlash = done?.status === 'not-slash';
  const statusSlash = done?.status === 'slash-invoked';
  const statusAutomation = done?.status === 'automation-created';
  const statusBlocked = done?.status === 'blocked';
  const sessionForAgents = Boolean(sessionSummary?.forAgentsRead);
  const sessionSetup = Boolean(sessionSummary?.setupBennyRead);
  const sessionSlash = Boolean(sessionSummary?.slashInvoked);
  const sessionAutomation = Boolean(sessionSummary?.automationCreated);
  const sessionSecret = Boolean(sessionSummary?.secretWrite);
  const forbidden =
    !productUnchanged ||
    screen.slashInvoked ||
    pty.slashInvoked ||
    sessionSlash ||
    statusSlash ||
    screen.automationCreated ||
    pty.automationCreated ||
    sessionAutomation ||
    statusAutomation ||
    screen.secretWrite ||
    pty.secretWrite ||
    sessionSecret;
  const pathEntry =
    sessionForAgents ||
    sessionSetup ||
    screen.forAgentsChrome ||
    screen.setupBennyPathChrome ||
    pty.forAgentsChrome ||
    pty.setupBennyPathChrome;
  const notSlashSignal =
    statusNotSlash ||
    screen.notSlashClaim ||
    pty.notSlashClaim ||
    Boolean(sessionSummary?.notSlashClaim) ||
    (pathEntry && !forbidden);
  const engaged = Boolean(pathEntry || done?.exists || sessionSetup || sessionForAgents);
  let outcome = 'inconclusive';
  if (forbidden || statusSlash || statusAutomation) {
    outcome = statusAutomation || screen.automationCreated || pty.automationCreated || sessionAutomation
      ? 'automation_created'
      : 'slash_invoked';
  } else if (engaged && notSlashSignal && productUnchanged) {
    outcome = 'not_slash';
  } else if (statusBlocked && engaged && !forbidden) {
    outcome = 'not_slash';
  }
  const contractHeld = outcome === 'not_slash';
  return {
    engaged,
    pathEntry,
    notSlashSignal,
    forbidden,
    productUnchanged,
    statusNotSlash,
    statusSlash,
    statusAutomation,
    statusBlocked,
    sessionForAgents,
    sessionSetup,
    sessionSlash,
    sessionAutomation,
    screen,
    pty,
    outcome,
    contractHeld,
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'cmd-setup-benny-not-slash',
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
  const backupPath = `${referenceRulePath}.setup-benny-not-slash-backup`;
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
      (/fixture-app|Benny|benny|medium|Skill conflicts|README|setup/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'setup-benny-fixture-app';
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
  let slashInvoked = false;
  let automationCreated = false;
  let secretWrite = false;
  let notSlashClaim = false;
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
    // User prompt contains forbidden `/setup-benny` tokens by design. Score tools + assistant only.
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
        const toolObs = observeSetupBennyNotSlash(`${name} ${argBlob}`);
        if (toolObs.slashInvoked) slashInvoked = true;
        if (toolObs.automationCreated) automationCreated = true;
        if (/xoxb-|xoxp-|slack_bot_token/i.test(argBlob) && /write|edit|apply/i.test(name)) {
          secretWrite = true;
        }
        toolOrder.push(label);
      }
      if (part.type === 'text' && typeof part.text === 'string') {
        assistantTexts.push(part.text);
        const textObs = observeSetupBennyNotSlash(part.text);
        if (textObs.notSlashClaim) notSlashClaim = true;
        if (textObs.slashInvoked) slashInvoked = true;
        if (textObs.automationCreated) automationCreated = true;
        if (/FOR_AGENTS\.md/i.test(part.text)) forAgentsRead = true;
        if (/setup-benny\/SKILL\.md/i.test(part.text)) setupBennyRead = true;
      }
      if (part.type === 'toolResult' || part.type === 'tool_result') {
        const resultBlob = JSON.stringify(part);
        if (/FOR_AGENTS\.md/i.test(resultBlob)) forAgentsRead = true;
        if (/setup-benny\/SKILL\.md/i.test(resultBlob)) setupBennyRead = true;
      }
    }
  }
  return {
    sessionPath,
    forAgentsRead,
    setupBennyRead,
    slashInvoked,
    automationCreated,
    secretWrite,
    notSlashClaim,
    toolOrder: toolOrder.slice(0, 160),
    assistantJoined: assistantTexts.join('\n\n'),
  };
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.setup-benny-not-slash-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  if (side === 'pi') await ensurePiTrust();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = setupPrompt(side);
  const productBeforeDigest = await fileDigest(productAbs);
  const pollLog = [];
  let attempt;
  try {
    if (!(await pathExists(join(fixtureApp, forAgentsRel)))) {
      throw new Error(`FOR_AGENTS missing at ${join(fixtureApp, forAgentsRel)}`);
    }
    if (!(await pathExists(join(fixtureApp, setupSkillRel)))) {
      throw new Error(`setup-benny skill missing at ${join(fixtureApp, setupSkillRel)}`);
    }
    // Re-check locked digest immediately before touching the shared rule (Grok-cap race).
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
        const obs = observeSetupBennyNotSlash(lines.join('\n'), { ignorePromptSlice: prompt });
        const done = await readDone(side);
        if (obs.forAgentsChrome || obs.setupBennyPathChrome || obs.notSlashClaim || done.exists) {
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
          'FOR_AGENTS',
          'setup-benny',
          'not a slash',
          'not slash',
          'slash skill',
          'destination',
          'Which repository',
          'which repository',
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
      const obs = observeSetupBennyNotSlash(text, { ignorePromptSlice: prompt });
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
    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      sessionSummary = await summarizePiSession(await findLatestPiSession());
    }

    const score = scoreSetupBennyNotSlash({
      done,
      productBeforeDigest,
      productAfterDigest,
      screenText: settledText,
      ptyText,
      sessionSummary,
      prompt,
    });

    const observations = {
      forAgentsRel,
      setupSkillRel,
      productRel,
      productBeforeDigest,
      productAfterDigest,
      productUnchanged: score.productUnchanged,
      done,
      outcome: score.outcome,
      contractHeld: score.contractHeld,
      engaged: score.engaged,
      pathEntry: score.pathEntry,
      notSlashSignal: score.notSlashSignal,
      forbidden: score.forbidden,
      screen: score.screen,
      pty: score.pty,
      session: sessionSummary
        ? {
            sessionPath: sessionSummary.sessionPath,
            forAgentsRead: sessionSummary.forAgentsRead,
            setupBennyRead: sessionSummary.setupBennyRead,
            slashInvoked: sessionSummary.slashInvoked,
            automationCreated: sessionSummary.automationCreated,
            secretWrite: sessionSummary.secretWrite,
            notSlashClaim: sessionSummary.notSlashClaim,
            toolOrder: sessionSummary.toolOrder,
          }
        : null,
      pollSamples: pollLog.length,
      scorerNote:
        'not_slash requires path engagement (FOR_AGENTS and/or setup-benny SKILL.md) + not-slash signal + unchanged src/app.js + no slash invoke + no automation create',
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
  }
}

async function selfTest() {
  const pass = scoreSetupBennyNotSlash({
    done: { exists: true, status: 'not-slash', line: 'STATUS=not-slash reason=path bootstrap' },
    productBeforeDigest: 'aaa',
    productAfterDigest: 'aaa',
    screenText: 'Read FOR_AGENTS.md then setup-benny/SKILL.md. Not a slash skill.',
    ptyText: 'setup-benny/SKILL.md',
    sessionSummary: {
      forAgentsRead: true,
      setupBennyRead: true,
      slashInvoked: false,
      automationCreated: false,
      notSlashClaim: true,
    },
    prompt: 'point at FOR_AGENTS',
  });
  const slashFail = scoreSetupBennyNotSlash({
    done: { exists: true, status: 'slash-invoked', line: 'STATUS=slash-invoked reason=invoked' },
    productBeforeDigest: 'aaa',
    productAfterDigest: 'aaa',
    screenText: 'Invoking /setup-benny now',
    ptyText: 'Running /setup-benny',
    sessionSummary: null,
    prompt: 'point at FOR_AGENTS',
  });
  const autoFail = scoreSetupBennyNotSlash({
    done: {
      exists: true,
      status: 'automation-created',
      line: 'STATUS=automation-created reason=created',
    },
    productBeforeDigest: 'aaa',
    productAfterDigest: 'aaa',
    screenText: 'Created a live automation via /automate',
    ptyText: 'Opening Automations editor',
    sessionSummary: null,
    prompt: 'point at FOR_AGENTS',
  });
  const denialOk = scoreSetupBennyNotSlash({
    done: {
      exists: true,
      status: 'not-slash',
      line: 'STATUS=not-slash reason=asked first setup question which repository',
    },
    productBeforeDigest: 'aaa',
    productAfterDigest: 'aaa',
    screenText:
      'I treated setup-benny as pack content, not a slash skill. I did not run /setup-benny or create any automation. Read FOR_AGENTS.md.',
    ptyText: 'Do not run /setup-benny. STATUS=not-slash|slash-invoked|automation-created|blocked|other',
    sessionSummary: {
      forAgentsRead: true,
      setupBennyRead: false,
      slashInvoked: false,
      automationCreated: false,
      notSlashClaim: true,
    },
    prompt: 'Do not run /setup-benny. Treat setup-benny as not a plugin slash skill.',
  });
  const cases = [
    ['pass', pass.contractHeld === true && pass.outcome === 'not_slash'],
    ['slash', slashFail.contractHeld === false && slashFail.outcome === 'slash_invoked'],
    ['automation', autoFail.contractHeld === false && autoFail.outcome === 'automation_created'],
    ['denial', denialOk.contractHeld === true && denialOk.outcome === 'not_slash'],
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
    console.error(`Reference rule digest ${preDigest} does not match the locked fixture ${LOCKED_FIXTURE_DIGEST}`);
    process.exit(1);
  }
  if (!(await pathExists(join(fixtureApp, forAgentsRel)))) {
    console.error(`Fixture pack missing ${forAgentsRel}`);
    process.exit(1);
  }
  if (!(await pathExists(join(fixtureApp, setupSkillRel)))) {
    console.error(`Fixture pack missing ${setupSkillRel}`);
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
    `${JSON.stringify({ scenario: 'cmd-setup-benny-not-slash', fixtureDigest: preDigest, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      scenario: 'cmd-setup-benny-not-slash',
      fixtureDigest: preDigest,
      results,
    }),
  );
}
