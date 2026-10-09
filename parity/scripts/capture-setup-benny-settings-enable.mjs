#!/usr/bin/env node
// setup-benny-settings-enable: after pack-aware Benny setup, target
// .cursor/settings.json must have plugins.pstack.enabled true while preserving
// unrelated top-level settings, other plugins, and JSONC comments.
// Real PTY both sides via recorder.
//
// Usage: node scripts/capture-setup-benny-settings-enable.mjs [--cursor-only|--pi-only|--both|--self-test]
// Evidence root: parity/evidence/setup-benny/settings-enable/
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
const evidenceRoot = join(setupBennyRoot, 'settings-enable');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const settingsBaseline = join(evidenceRoot, 'settings-baseline.jsonc');
const settingsRel = join('.cursor', 'settings.json');
const settingsAbs = join(fixtureApp, settingsRel);
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
const COMMENT_MARKER = 'fixture-marker: keep-this-comment';
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
    `Pack destination may already exist under .cursor/automations/benny. Treat copy as done if verified. ` +
    `Focus on enabling pstack in project settings per setup-benny: edit ${settingsRel} so plugins.pstack.enabled is true. ` +
    `The file already exists as JSONC. Preserve unrelated top-level settings, other plugin entries, and comments. ` +
    `If plugins.pstack already exists, change only enabled. Validate the file after editing. ` +
    `Do not create or update a live automation. Do not edit parity ledgers or ${productRel}. ` +
    `When the settings edit is done (or you stop), write exactly one line to ${out} as ` +
    `STATUS=settings-ok|settings-mismatch|no-settings-write|blocked|other reason=<short phrase> then stop.`
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
    /^STATUS=(settings-ok|settings-mismatch|no-settings-write|blocked|other)\b/i,
  );
  return { exists: true, path, line, status: m ? m[1].toLowerCase() : null };
}

/** Strip line and block comments for validation without requiring a JSONC dep. */
export function stripJsonc(text) {
  let out = '';
  let i = 0;
  let inString = false;
  let escape = false;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

export function parseSettingsJsonc(text) {
  const stripped = stripJsonc(text);
  const value = JSON.parse(stripped);
  return { value, stripped, raw: text };
}

export function analyzeSettings(beforeText, afterText) {
  const before = parseSettingsJsonc(beforeText);
  const after = parseSettingsJsonc(afterText);
  const beforePlugins = before.value.plugins && typeof before.value.plugins === 'object'
    ? before.value.plugins
    : {};
  const afterPlugins = after.value.plugins && typeof after.value.plugins === 'object'
    ? after.value.plugins
    : {};
  const pstack = afterPlugins.pstack;
  const enabledTrue =
    Boolean(pstack) && typeof pstack === 'object' && pstack.enabled === true;
  const unrelatedTopLevel = Object.keys(before.value)
    .filter((k) => k !== 'plugins')
    .every((k) => JSON.stringify(before.value[k]) === JSON.stringify(after.value[k]));
  const otherPluginsIntact = Object.keys(beforePlugins)
    .filter((k) => k !== 'pstack')
    .every((k) => JSON.stringify(beforePlugins[k]) === JSON.stringify(afterPlugins[k]));
  const onlyEnabledChanged =
    beforePlugins.pstack &&
    typeof beforePlugins.pstack === 'object' &&
    afterPlugins.pstack &&
    typeof afterPlugins.pstack === 'object'
      ? Object.keys({ ...beforePlugins.pstack, ...afterPlugins.pstack }).every((k) => {
          if (k === 'enabled') return afterPlugins.pstack.enabled === true;
          return JSON.stringify(beforePlugins.pstack[k]) === JSON.stringify(afterPlugins.pstack[k]);
        })
      : enabledTrue;
  const commentPreserved = beforeText.includes(COMMENT_MARKER)
    ? afterText.includes(COMMENT_MARKER)
    : true;
  let valid = false;
  try {
    parseSettingsJsonc(afterText);
    valid = true;
  } catch {
    valid = false;
  }
  return {
    enabledTrue,
    unrelatedTopLevel,
    otherPluginsIntact,
    onlyEnabledChanged,
    commentPreserved,
    valid,
    beforeDigest: createHash('sha256').update(beforeText).digest('hex'),
    afterDigest: createHash('sha256').update(afterText).digest('hex'),
    afterSnippet: afterText.slice(0, 2000),
  };
}

export function observeSettings(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  return {
    settingsChrome:
      /\.cursor\/settings\.json/i.test(hay) ||
      /\bplugins\.pstack\b/i.test(hay) ||
      /\b"enabled"\s*:\s*true\b/i.test(hay) ||
      /\benabled\b[^\n]{0,40}true/i.test(hay),
    settingsOkClaim: /\bsettings-ok\b/i.test(hay) || /\bSTATUS=settings-ok\b/i.test(hay),
    working: /[\u2800-\u28FF]/.test(hay) || /\bWorking\b/.test(hay),
  };
}

export function scoreSettings({
  done,
  productBeforeDigest,
  productAfterDigest,
  screenText,
  ptyText,
  sessionSummary,
  prompt,
  settingsAnalysis,
  settingsExists,
}) {
  const screen = observeSettings(screenText, { ignorePromptSlice: prompt });
  const pty = observeSettings(ptyText, { ignorePromptSlice: prompt });
  const productUnchanged =
    Boolean(productBeforeDigest) &&
    Boolean(productAfterDigest) &&
    productBeforeDigest === productAfterDigest;
  const analysisOk =
    Boolean(settingsAnalysis?.enabledTrue) &&
    Boolean(settingsAnalysis?.unrelatedTopLevel) &&
    Boolean(settingsAnalysis?.otherPluginsIntact) &&
    Boolean(settingsAnalysis?.onlyEnabledChanged) &&
    Boolean(settingsAnalysis?.commentPreserved) &&
    Boolean(settingsAnalysis?.valid);
  const wroteSettings = Boolean(settingsExists) && Boolean(settingsAnalysis);
  let outcome = 'inconclusive';
  if (wroteSettings && analysisOk && productUnchanged) {
    outcome = 'settings_ok';
  } else if (wroteSettings && settingsAnalysis && !analysisOk) {
    outcome = 'settings_mismatch';
  } else if (done?.status === 'no-settings-write' || (!wroteSettings && done?.exists)) {
    outcome = 'no_settings_write';
  } else if (done?.status === 'settings-ok' && analysisOk) {
    outcome = 'settings_ok';
  }
  return {
    productUnchanged,
    wroteSettings,
    analysisOk,
    screen,
    pty,
    settingsAnalysis,
    outcome,
    contractHeld: outcome === 'settings_ok',
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'setup-benny-settings-enable',
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
  const backupPath = `${referenceRulePath}.setup-benny-settings-enable-backup`;
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
      (/fixture-app|Benny|benny|medium|Skill conflicts|README|setup|settings/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'settings-enable';
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
  let settingsWrite = false;
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
        if (/\.cursor\/settings\.json/i.test(argBlob) && /write|edit|apply|create|bash/i.test(name)) {
          settingsWrite = true;
          label = `${name}(settings.json)`;
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
    settingsWrite,
    toolOrder: toolOrder.slice(0, 160),
    assistantJoined: assistantTexts.join('\n\n'),
  };
}

async function restoreSettingsBaseline() {
  if (!(await pathExists(settingsBaseline))) {
    throw new Error(`Missing settings baseline at ${settingsBaseline}`);
  }
  await mkdir(join(fixtureApp, '.cursor'), { recursive: true });
  await copyFile(settingsBaseline, settingsAbs);
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.setup-benny-settings-enable-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await restoreSettingsBaseline();
  if (side === 'pi') await ensurePiTrust();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = setupPrompt(side);
  const productBeforeDigest = await fileDigest(productAbs);
  const beforeSettingsText = await readFile(settingsAbs, 'utf8');
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
        const obs = observeSettings(lines.join('\n'), { ignorePromptSlice: prompt });
        const done = await readDone(side);
        if (obs.settingsChrome || obs.settingsOkClaim || done.exists) {
          pollLog.push({
            ts: new Date().toISOString(),
            ...obs,
            doneExists: done.exists,
            doneStatus: done.status,
            settingsExists: await pathExists(settingsAbs),
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
          'settings.json',
          'plugins.pstack',
          '"enabled": true',
          'settings-ok',
          'settings-mismatch',
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
      const obs = observeSettings(text, { ignorePromptSlice: prompt });
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
    const settingsExists = await pathExists(settingsAbs);
    let settingsAnalysis = null;
    let afterSettingsText = null;
    if (settingsExists) {
      afterSettingsText = await readFile(settingsAbs, 'utf8');
      try {
        settingsAnalysis = analyzeSettings(beforeSettingsText, afterSettingsText);
      } catch (error) {
        settingsAnalysis = {
          enabledTrue: false,
          unrelatedTopLevel: false,
          otherPluginsIntact: false,
          onlyEnabledChanged: false,
          commentPreserved: afterSettingsText.includes(COMMENT_MARKER),
          valid: false,
          parseError: String(error?.message || error),
          beforeDigest: createHash('sha256').update(beforeSettingsText).digest('hex'),
          afterDigest: createHash('sha256').update(afterSettingsText).digest('hex'),
          afterSnippet: afterSettingsText.slice(0, 2000),
        };
      }
    }
    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      sessionSummary = await summarizePiSession(await findLatestPiSession());
    }

    const score = scoreSettings({
      done,
      productBeforeDigest,
      productAfterDigest,
      screenText: settledText,
      ptyText,
      sessionSummary,
      prompt,
      settingsAnalysis,
      settingsExists,
    });

    const observations = {
      forAgentsRel,
      setupSkillRel,
      productRel,
      settingsRel: settingsRel.split(sep).join('/'),
      commentMarker: COMMENT_MARKER,
      productBeforeDigest,
      productAfterDigest,
      productUnchanged: score.productUnchanged,
      done,
      outcome: score.outcome,
      contractHeld: score.contractHeld,
      wroteSettings: score.wroteSettings,
      analysisOk: score.analysisOk,
      settingsAnalysis,
      screen: score.screen,
      pty: score.pty,
      session: sessionSummary
        ? {
            sessionPath: sessionSummary.sessionPath,
            forAgentsRead: sessionSummary.forAgentsRead,
            setupBennyRead: sessionSummary.setupBennyRead,
            settingsWrite: sessionSummary.settingsWrite,
            toolOrder: sessionSummary.toolOrder,
          }
        : null,
      pollSamples: pollLog.length,
      scorerNote:
        'settings_ok requires plugins.pstack.enabled true, unrelated top-level + other plugins preserved, only enabled changed when pstack existed, JSONC comment marker preserved, file validates, product unchanged',
    };

    const afterRule = await readFile(rulePath, 'utf8');
    const afterRuleDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), afterRule);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
    await writeFile(join(dir, 'poll-log.json'), `${JSON.stringify(pollLog, null, 2)}\n`);
    await writeFile(join(dir, 'settings-before.jsonc'), beforeSettingsText);
    if (afterSettingsText != null) {
      await writeFile(join(dir, 'settings-after.jsonc'), afterSettingsText);
    }
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
    await restoreSettingsBaseline().catch(() => {});
  }
}

async function selfTest() {
  const before = `{
	// ${COMMENT_MARKER}
	"editor.fontSize": 14,
	"plugins": {
		"other-plugin": { "enabled": true, "version": "1.0.0" },
		"pstack": { "enabled": false }
	}
}
`;
  const okAfter = `{
	// ${COMMENT_MARKER}
	"editor.fontSize": 14,
	"plugins": {
		"other-plugin": { "enabled": true, "version": "1.0.0" },
		"pstack": { "enabled": true }
	}
}
`;
  const badAfter = `{
	"editor.fontSize": 99,
	"plugins": {
		"pstack": { "enabled": true }
	}
}
`;
  const okAnalysis = analyzeSettings(before, okAfter);
  const badAnalysis = analyzeSettings(before, badAfter);
  const pass = scoreSettings({
    done: { exists: true, status: 'settings-ok', line: 'STATUS=settings-ok reason=enabled' },
    productBeforeDigest: 'aaa',
    productAfterDigest: 'aaa',
    screenText: 'Updated .cursor/settings.json plugins.pstack.enabled true',
    ptyText: 'settings-ok',
    sessionSummary: { settingsWrite: true },
    prompt: 'enable settings',
    settingsAnalysis: okAnalysis,
    settingsExists: true,
  });
  const mismatch = scoreSettings({
    done: {
      exists: true,
      status: 'settings-mismatch',
      line: 'STATUS=settings-mismatch reason=clobbered',
    },
    productBeforeDigest: 'aaa',
    productAfterDigest: 'aaa',
    screenText: 'rewrote settings',
    ptyText: 'settings',
    sessionSummary: { settingsWrite: true },
    prompt: 'enable settings',
    settingsAnalysis: badAnalysis,
    settingsExists: true,
  });
  const cases = [
    ['okEnabled', okAnalysis.enabledTrue === true],
    ['okPreserve', okAnalysis.unrelatedTopLevel && okAnalysis.otherPluginsIntact],
    ['okComment', okAnalysis.commentPreserved === true],
    ['okOnlyEnabled', okAnalysis.onlyEnabledChanged === true],
    ['badClobber', badAnalysis.unrelatedTopLevel === false && badAnalysis.otherPluginsIntact === false],
    ['pass', pass.contractHeld === true && pass.outcome === 'settings_ok'],
    ['mismatch', mismatch.contractHeld === false && mismatch.outcome === 'settings_mismatch'],
    ['stripJsonc', parseSettingsJsonc(before).value.plugins.pstack.enabled === false],
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
  if (!(await pathExists(settingsBaseline))) {
    console.error(`Missing settings baseline ${settingsBaseline}`);
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
    `${JSON.stringify({ scenario: 'setup-benny-settings-enable', fixtureDigest: preDigest, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      scenario: 'setup-benny-settings-enable',
      fixtureDigest: preDigest,
      results,
    }),
  );
}
