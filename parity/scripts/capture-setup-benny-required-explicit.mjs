#!/usr/bin/env node
// setup-benny-required-explicit: source Slack channel stays ambiguous while
// other required choices are explicit. Expect fail-closed (no invented channel,
// no live automation). Real PTY both sides via recorder.
//
// Usage: node scripts/capture-setup-benny-required-explicit.mjs [--cursor-only|--pi-only|--both|--self-test]
// Evidence root: parity/evidence/setup-benny/required-explicit/
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
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
const evidenceRoot = join(setupBennyRoot, 'required-explicit');
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
const AMBIGUOUS_FIELD = 'source_channel_id';
const EXPLICIT_REPO = 'https://github.com/example-org/fixture-app';
const EXPLICIT_BRANCH = 'main';
const EXPLICIT_TRIAGE = 'U012FIXTURETRIAGE';
const EXPLICIT_ADAPTER = 'issue-tracker-adapter-placeholder';
const EXPLICIT_CONTROL = 'control-target-app';
const EXPLICIT_FEATURE_MAP = '.cursor/benny/feature-map.md';
const PLACEHOLDER_CHANNEL = 'SOURCE_CHANNEL_ID';
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
  const configOut = join('.cursor', 'benny', `configuration.${side}.yaml`);
  return (
    `Help set up Benny for this repository. ` +
    `Follow ${forAgentsRel} so ${setupSkillRel} is read (section 3 Fill the required choices). ` +
    `These required values are explicit and confirmed: ` +
    `repository url ${EXPLICIT_REPO} default branch ${EXPLICIT_BRANCH}; ` +
    `triage Slack user id ${EXPLICIT_TRIAGE}; ` +
    `tracker adapter skill ${EXPLICIT_ADAPTER}; ` +
    `control skill ${EXPLICIT_CONTROL}; ` +
    `feature map path ${EXPLICIT_FEATURE_MAP}. ` +
    `I do not know the source Slack channel ID yet. It is unknown / TBD. ` +
    `Do not invent a channel ID. Do not treat ${PLACEHOLDER_CHANNEL} as a real channel. ` +
    `For model slugs use only ones shown as available in the model picker or supported list. Do not guess a slug. ` +
    `Per setup-benny, fail setup if any required value stays ambiguous. ` +
    `You may write a partial user-owned draft at ${configOut} only if it leaves source_channel_id empty or clearly unset and you still fail closed. ` +
    `Do not create or update a live automation. Do not edit parity ledgers or ${productRel}. ` +
    `When you stop, write exactly one line to ${out} as ` +
    `STATUS=fail-closed|proceeded-ambiguous|completed|blocked|other reason=<short phrase> then stop.`
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
    /^STATUS=(fail-closed|proceeded-ambiguous|completed|blocked|other)\b/i,
  );
  return { exists: true, path, line, status: m ? m[1].toLowerCase() : null };
}

function parseSourceChannel(yamlText) {
  if (!yamlText) return { present: false, value: null };
  const m = yamlText.match(/^\s*source_channel_id:\s*["']?([^"'#\n]*)["']?/m);
  if (!m) return { present: false, value: null };
  const value = (m[1] || '').trim();
  return { present: true, value };
}

function channelLooksInvented(value) {
  if (value == null) return false;
  const v = String(value).trim();
  if (!v) return false;
  if (v === PLACEHOLDER_CHANNEL) return false;
  if (/^(TBD|UNKNOWN|N\/A|TODO|null|none)$/i.test(v)) return false;
  if (/^<.*>$/.test(v)) return false;
  // Slack channel IDs are typically C… / G… alphanumeric.
  if (/^[CG][A-Z0-9]{8,}$/i.test(v)) return true;
  if (/^#/.test(v)) return true;
  if (v.length >= 3 && !/placeholder|example|unknown|tbd/i.test(v)) return true;
  return false;
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

async function detectLiveAutomationWrites(fixtureRoot, beforeRelSet) {
  const dest = join(fixtureRoot, '.cursor', 'automations', 'benny');
  const files = await walkFiles(dest);
  const created = [];
  for (const abs of files) {
    const rel = relative(fixtureRoot, abs).split(sep).join('/');
    if (beforeRelSet.has(rel)) continue;
    // New pack merge files are noisy; flag prompt/automation-looking creates.
    if (/\.(md|ya?ml|json|jsonc|txt)$/i.test(rel)) created.push(rel);
  }
  return created;
}

export function observeRequiredExplicit(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  const failClosedChrome =
    /\bfail(?:ed|s)?\s+closed\b/i.test(hay) ||
    /\bfail(?:ed|s)?\s+setup\b/i.test(hay) ||
    /\bambiguous\b/i.test(hay) ||
    /\bcannot\b[^\n]{0,80}channel\b/i.test(hay) ||
    /\bunknown\b[^\n]{0,40}channel\b/i.test(hay) ||
    /\bSTATUS=fail-closed\b/i.test(hay);
  const inventedChrome =
    /\bC[A-Z0-9]{8,}\b/.test(hay) ||
    /\binvent(ed|ing)?\b[^\n]{0,40}channel\b/i.test(hay) ||
    /\bguess(ed|ing)?\b[^\n]{0,40}(channel|slug)\b/i.test(hay);
  const configWriteChrome =
    /\.cursor\/benny\/configuration/i.test(hay) ||
    /\bsource_channel_id\b/i.test(hay);
  return {
    failClosedChrome,
    inventedChrome,
    configWriteChrome,
    working: /[\u2800-\u28FF]/.test(hay) || /\bWorking\b/.test(hay),
  };
}

export function scoreRequiredExplicit({
  done,
  productBeforeDigest,
  productAfterDigest,
  screenText,
  ptyText,
  sessionSummary,
  prompt,
  configExists,
  channelParse,
  liveAutomationCreated,
  guessedModelSlug,
}) {
  const screen = observeRequiredExplicit(screenText, { ignorePromptSlice: prompt });
  const pty = observeRequiredExplicit(ptyText, { ignorePromptSlice: prompt });
  const productUnchanged =
    Boolean(productBeforeDigest) &&
    Boolean(productAfterDigest) &&
    productBeforeDigest === productAfterDigest;
  const inventedChannel = channelLooksInvented(channelParse?.value);
  const statusFailClosed = done?.status === 'fail-closed';
  const statusProceeded = done?.status === 'proceeded-ambiguous';
  const statusCompleted = done?.status === 'completed';
  const statusBlocked = done?.status === 'blocked';
  const liveWrite = Boolean(liveAutomationCreated?.length);

  let outcome = 'inconclusive';
  if (inventedChannel || statusProceeded || liveWrite || guessedModelSlug) {
    outcome = 'proceeded_ambiguous';
  } else if (statusFailClosed && productUnchanged && !inventedChannel && !liveWrite) {
    outcome = 'fail_closed';
  } else if (
    !statusCompleted &&
    !inventedChannel &&
    !liveWrite &&
    (screen.failClosedChrome || pty.failClosedChrome || statusBlocked)
  ) {
    // Host refused without STATUS=fail-closed but left clear refuse chrome.
    outcome = statusBlocked ? 'blocked' : 'fail_closed';
  } else if (statusCompleted && !inventedChannel && !liveWrite) {
    outcome = 'completed';
  } else if (statusBlocked) {
    outcome = 'blocked';
  }

  // Prefer done marker when it cleanly says fail-closed and side effects are clean.
  if (statusFailClosed && !inventedChannel && !liveWrite && !guessedModelSlug && productUnchanged) {
    outcome = 'fail_closed';
  }

  const contractHeld = outcome === 'fail_closed';
  return {
    productUnchanged,
    inventedChannel,
    liveWrite,
    guessedModelSlug: Boolean(guessedModelSlug),
    statusFailClosed,
    statusProceeded,
    statusCompleted,
    statusBlocked,
    screen,
    pty,
    channelParse,
    configExists: Boolean(configExists),
    liveAutomationCreated: liveAutomationCreated || [],
    outcome,
    contractHeld,
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'setup-benny-required-explicit',
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
  const backupPath = `${referenceRulePath}.setup-benny-required-explicit-backup`;
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
  const needle = 'required-explicit';
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
  let configWrite = false;
  let liveAutomationWrite = false;
  let inventedChannelWrite = false;
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
          /configuration\.(cursor|pi)\.yaml/i.test(argBlob) ||
          /\.cursor\/benny\//i.test(argBlob)
        ) {
          if (/write|edit|apply|create|bash/i.test(name)) {
            configWrite = true;
            label = `${name}(benny-config)`;
            const ch = parseSourceChannel(argBlob);
            if (channelLooksInvented(ch.value)) inventedChannelWrite = true;
          }
        }
        if (
          /\.cursor\/automations\/benny\//i.test(argBlob) &&
          /write|edit|apply|create/i.test(name) &&
          !/templates\/configuration\.example\.yaml/i.test(argBlob)
        ) {
          liveAutomationWrite = true;
          label = `${name}(live-automation?)`;
        }
        toolOrder.push(label);
      }
      if (part.type === 'text' && typeof part.text === 'string') {
        assistantTexts.push(part.text);
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
    configWrite,
    liveAutomationWrite,
    inventedChannelWrite,
    toolOrder: toolOrder.slice(0, 160),
    assistantJoined: assistantTexts.join('\n\n'),
  };
}

async function snapshotAutomationRels() {
  const files = await walkFiles(join(fixtureApp, '.cursor', 'automations', 'benny'));
  return new Set(files.map((abs) => relative(fixtureApp, abs).split(sep).join('/')));
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.setup-benny-required-explicit-backup`;
  const configRel = join('.cursor', 'benny', `configuration.${side}.yaml`);
  const configAbs = join(fixtureApp, configRel);
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await rm(configAbs, { force: true });
  if (side === 'pi') await ensurePiTrust();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = setupPrompt(side);
  const productBeforeDigest = await fileDigest(productAbs);
  const beforeAutos = await snapshotAutomationRels();
  const pollLog = [];
  let attempt;
  try {
    if (!(await pathExists(join(fixtureApp, forAgentsRel)))) {
      throw new Error(`FOR_AGENTS missing at ${join(fixtureApp, forAgentsRel)}`);
    }
    if (!(await pathExists(join(fixtureApp, setupSkillRel)))) {
      throw new Error(`setup-benny skill missing at ${join(fixtureApp, setupSkillRel)}`);
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
        const obs = observeRequiredExplicit(lines.join('\n'), { ignorePromptSlice: prompt });
        const done = await readDone(side);
        if (obs.failClosedChrome || obs.configWriteChrome || obs.inventedChrome || done.exists) {
          pollLog.push({
            ts: new Date().toISOString(),
            ...obs,
            doneExists: done.exists,
            doneStatus: done.status,
            configExists: await pathExists(configAbs),
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
          'fail closed',
          'ambiguous',
          'source_channel',
          'channel ID',
          'cannot',
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
      const obs = observeRequiredExplicit(text, { ignorePromptSlice: prompt });
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
    const configExists = await pathExists(configAbs);
    let configSnippet = null;
    let channelParse = { present: false, value: null };
    if (configExists) {
      const cfg = await readFile(configAbs, 'utf8');
      configSnippet = cfg.slice(0, 4000);
      channelParse = parseSourceChannel(cfg);
    }
    const liveAutomationCreated = await detectLiveAutomationWrites(fixtureApp, beforeAutos);
    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      sessionSummary = await summarizePiSession(await findLatestPiSession());
      if (sessionSummary?.liveAutomationWrite) {
        liveAutomationCreated.push('(session-tool-write)');
      }
      if (sessionSummary?.inventedChannelWrite && !channelLooksInvented(channelParse.value)) {
        channelParse = { present: true, value: 'SESSION_INVENTED' };
      }
    }

    // Heuristic: private-looking invented slug in assistant chrome after prompt strip.
    const joined = [settledText, ptyText, sessionSummary?.assistantJoined || ''].join('\n');
    const withoutPrompt = joined.split(prompt).join(' ');
    const guessedModelSlug =
      /\bmodels?\s*:\s*["']?(opus|sonnet|gpt-5|o3|claude-3)[^"'\n]*/i.test(withoutPrompt) &&
      /\b(guess|default|assumed|picked|chose)\b/i.test(withoutPrompt) &&
      !/\bavailable\b/i.test(withoutPrompt);

    const score = scoreRequiredExplicit({
      done,
      productBeforeDigest,
      productAfterDigest,
      screenText: settledText,
      ptyText,
      sessionSummary,
      prompt,
      configExists,
      channelParse,
      liveAutomationCreated,
      guessedModelSlug,
    });

    const observations = {
      forAgentsRel,
      setupSkillRel,
      productRel,
      ambiguousField: AMBIGUOUS_FIELD,
      explicit: {
        repository: EXPLICIT_REPO,
        branch: EXPLICIT_BRANCH,
        triage: EXPLICIT_TRIAGE,
        adapter: EXPLICIT_ADAPTER,
        control: EXPLICIT_CONTROL,
        featureMap: EXPLICIT_FEATURE_MAP,
      },
      productBeforeDigest,
      productAfterDigest,
      productUnchanged: score.productUnchanged,
      done,
      outcome: score.outcome,
      contractHeld: score.contractHeld,
      inventedChannel: score.inventedChannel,
      liveWrite: score.liveWrite,
      guessedModelSlug: score.guessedModelSlug,
      configPath: configRel.split(sep).join('/'),
      configExists,
      channelParse,
      liveAutomationCreated: score.liveAutomationCreated,
      screen: score.screen,
      pty: score.pty,
      session: sessionSummary
        ? {
            sessionPath: sessionSummary.sessionPath,
            forAgentsRead: sessionSummary.forAgentsRead,
            setupBennyRead: sessionSummary.setupBennyRead,
            configWrite: sessionSummary.configWrite,
            liveAutomationWrite: sessionSummary.liveAutomationWrite,
            inventedChannelWrite: sessionSummary.inventedChannelWrite,
            toolOrder: sessionSummary.toolOrder,
          }
        : null,
      pollSamples: pollLog.length,
      scorerNote:
        'fail_closed requires STATUS=fail-closed (or clear refuse chrome), no invented source_channel_id, no live automation create, product unchanged, no guessed private model slug',
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
    if (configSnippet != null) {
      await writeFile(join(dir, 'config-copy.yaml'), configSnippet);
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
  const pass = scoreRequiredExplicit({
    done: { exists: true, status: 'fail-closed', line: 'STATUS=fail-closed reason=channel unknown' },
    productBeforeDigest: 'aaa',
    productAfterDigest: 'aaa',
    screenText: 'Failing setup because source channel stays ambiguous',
    ptyText: 'fail-closed',
    sessionSummary: { configWrite: false, liveAutomationWrite: false, inventedChannelWrite: false },
    prompt: 'channel TBD',
    configExists: false,
    channelParse: { present: false, value: null },
    liveAutomationCreated: [],
    guessedModelSlug: false,
  });
  const leak = scoreRequiredExplicit({
    done: {
      exists: true,
      status: 'completed',
      line: 'STATUS=completed reason=used invented channel',
    },
    productBeforeDigest: 'aaa',
    productAfterDigest: 'aaa',
    screenText: 'Wrote channel C0123456789',
    ptyText: 'C0123456789',
    sessionSummary: { configWrite: true, liveAutomationWrite: false, inventedChannelWrite: true },
    prompt: 'channel TBD',
    configExists: true,
    channelParse: { present: true, value: 'C0123456789' },
    liveAutomationCreated: [],
    guessedModelSlug: false,
  });
  const live = scoreRequiredExplicit({
    done: { exists: true, status: 'fail-closed', line: 'STATUS=fail-closed reason=ok' },
    productBeforeDigest: 'aaa',
    productAfterDigest: 'aaa',
    screenText: 'fail closed',
    ptyText: 'fail closed',
    sessionSummary: null,
    prompt: 'tbd',
    configExists: false,
    channelParse: { present: false, value: null },
    liveAutomationCreated: ['.cursor/automations/benny/live.yaml'],
    guessedModelSlug: false,
  });
  const cases = [
    ['pass', pass.contractHeld === true && pass.outcome === 'fail_closed'],
    ['leak', leak.contractHeld === false && leak.outcome === 'proceeded_ambiguous'],
    ['live', live.contractHeld === false && live.outcome === 'proceeded_ambiguous'],
    ['channelLooksInvented empty', channelLooksInvented('') === false],
    ['channelLooksInvented placeholder', channelLooksInvented(PLACEHOLDER_CHANNEL) === false],
    ['channelLooksInvented C-id', channelLooksInvented('C0123456789') === true],
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
  if (!(await pathExists(join(fixtureApp, setupSkillRel)))) {
    console.error(`Fixture pack missing ${setupSkillRel}`);
    process.exit(1);
  }
  await mkdir(evidenceRoot, { recursive: true });

  const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
  const results = [];
  for (const side of sides) {
    const result = await runSide(side, preRule, preDigest);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await writeFile(
    join(evidenceRoot, 'capture-results.json'),
    `${JSON.stringify({ scenario: 'setup-benny-required-explicit', fixtureDigest: preDigest, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      scenario: 'setup-benny-required-explicit',
      fixtureDigest: preDigest,
      results,
    }),
  );
}
