#!/usr/bin/env node
// setup-benny-project-skills: after pstack is enabled in project settings, a
// fresh agent rooted in the target must resolve how/why/tdd/unslop and the
// listed principle-* skills from project-scoped pstack (not session/user),
// or stop with an explanation. Real PTY both sides via recorder.
//
// Usage: node scripts/capture-setup-benny-project-skills.mjs [--cursor-only|--pi-only|--both|--self-test]
// Evidence root: parity/evidence/setup-benny/project-skills/
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
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
const evidenceRoot = join(setupBennyRoot, 'project-skills');
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
const REQUIRED_SKILLS = [
  'how',
  'why',
  'tdd',
  'unslop',
  'principle-separate-before-serializing-shared-state',
  'principle-minimize-reader-load',
  'principle-guard-the-context-window',
  'principle-sequence-verifiable-units',
  'principle-fix-root-causes',
  'principle-prove-it-works',
];
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 900_000;
const POLL_MS = 500;
const RULE_BACKUP = `${referenceRulePath}.setup-benny-project-skills-backup`;

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

function manifestPath(side) {
  return join(writeRootFor(side), 'resolve-manifest.json');
}

function setupPrompt(side) {
  const out = donePath(side);
  const manifest = manifestPath(side);
  const skillList = REQUIRED_SKILLS.join(', ');
  return (
    `Help set up Benny for this repository by completing the project-scoped skill resolve check only. ` +
    `Follow ${forAgentsRel} so ${setupSkillRel} is read. ` +
    `Project settings already enable pstack in ${settingsRel}. ` +
    `This is a fresh agent rooted in the target. Verify that these shared pstack skills resolve from project-scoped pstack: ${skillList}. ` +
    `Do not count a skill loaded from the current session (--plugin-dir) or a user-scoped install (~/.claude/skills, ~/.cursor/skills, ~/.agents/skills, or the agent-home skills tree). ` +
    `Project-scoped means a path under this repository that the project settings or project package install made available (for Cursor, project-enabled pstack; for Pi, .pi/skills or project .pi/settings.json packages). ` +
    `If project-scoped plugin/package install is unavailable or any listed skill fails to resolve from project scope, stop and explain the failure. ` +
    `Write ${manifest} as JSON: { "skills": [ { "name": "<skill>", "path": "<absolute-or-repo-relative SKILL.md path or null>", "scope": "project|user|session|package|missing|other", "notes": "<short>" } ] }. ` +
    `Do not create or update a live automation. Do not edit parity ledgers or ${productRel}. ` +
    `When the check is done (or you stop), write exactly one line to ${out} as ` +
    `STATUS=resolve-ok|stop-explain|resolve-fail|blocked|other reason=<short phrase> then stop.`
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
  const m = line.match(/^STATUS=(resolve-ok|stop-explain|resolve-fail|blocked|other)\b/i);
  return { exists: true, path, line, status: m ? m[1].toLowerCase() : null };
}

async function readManifest(side) {
  const path = manifestPath(side);
  if (!(await pathExists(path))) return { exists: false, path, value: null, error: null };
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return { exists: true, path, value, error: null };
  } catch (error) {
    return { exists: true, path, value: null, error: String(error?.message || error) };
  }
}

/** Classify a resolved skill path for the fixture. Exported for self-test. */
export function classifySkillPath(skillPath, { fixtureRoot = fixtureApp, pluginDirPaths = [] } = {}) {
  if (!skillPath || typeof skillPath !== 'string') return 'missing';
  const abs = resolve(skillPath);
  const fixture = resolve(fixtureRoot);
  const home = resolve(homedir());
  const norm = abs.split(sep).join('/');
  const fixtureNorm = fixture.split(sep).join('/');
  for (const pluginDir of pluginDirPaths) {
    const p = resolve(pluginDir).split(sep).join('/');
    if (norm === p || norm.startsWith(`${p}/`)) return 'session';
  }
  if (norm === fixtureNorm || norm.startsWith(`${fixtureNorm}/`)) {
    const rel = relative(fixture, abs).split(sep).join('/');
    if (rel.startsWith('.pi/skills/') || rel.startsWith('.cursor/skills/')) return 'project';
    if (rel.includes('/skills/') && (rel.startsWith('.pi/') || rel.startsWith('.cursor/'))) {
      return 'project';
    }
    return 'project';
  }
  if (norm.includes('/extensions/pi-pstack/skills/') || norm.includes('/cursor-plugins/pstack/skills/')) {
    return 'package';
  }
  if (norm.includes('/plugins/cache/') && norm.includes('/pstack/') && norm.includes('/skills/')) {
    return 'package';
  }
  if (
    norm.includes('/.claude/skills/') ||
    norm.includes('/.cursor/skills/') ||
    norm.includes('/.agents/skills/') ||
    norm.includes('/.pi/agent/skills/')
  ) {
    return 'user';
  }
  if (norm.startsWith(`${home.split(sep).join('/')}/`)) {
    return 'user';
  }
  return 'other';
}

export function analyzeManifest(manifestValue, opts = {}) {
  const rows = Array.isArray(manifestValue?.skills) ? manifestValue.skills : [];
  const byName = new Map();
  for (const row of rows) {
    if (row && typeof row.name === 'string') byName.set(row.name, row);
  }
  const skills = REQUIRED_SKILLS.map((name) => {
    const row = byName.get(name) || null;
    const claimedPath = row?.path ?? null;
    const claimedScope = typeof row?.scope === 'string' ? row.scope.toLowerCase() : null;
    const independentScope = classifySkillPath(claimedPath, opts);
    return {
      name,
      claimedPath,
      claimedScope,
      independentScope,
      projectScoped: independentScope === 'project',
      present: Boolean(claimedPath) && independentScope !== 'missing',
    };
  });
  const allPresent = skills.every((s) => s.present);
  const allProject = skills.every((s) => s.projectScoped);
  const anyUserOrSession = skills.some(
    (s) => s.independentScope === 'user' || s.independentScope === 'session',
  );
  const missing = skills.filter((s) => !s.present || s.independentScope === 'missing').map((s) => s.name);
  return { skills, allPresent, allProject, anyUserOrSession, missing };
}

export function observeResolve(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  return {
    resolveChrome:
      /\bproject-scoped\b/i.test(hay) ||
      /\bstop-explain\b/i.test(hay) ||
      /\bresolve-ok\b/i.test(hay) ||
      /\.pi\/skills\b/i.test(hay) ||
      /\buser-scoped\b/i.test(hay) ||
      /\bSTATUS=stop-explain\b/i.test(hay),
    stopExplainClaim:
      /\bSTATUS=stop-explain\b/i.test(hay) ||
      /\bstop(?:ping)?\b[^\n]{0,80}\bexplain/i.test(hay) ||
      /\bproject-scoped\b[^\n]{0,80}\bunavailable\b/i.test(hay),
    resolveOkClaim: /\bSTATUS=resolve-ok\b/i.test(hay) || /\bresolve-ok\b/i.test(hay),
    working: /[\u2800-\u28FF]/.test(hay) || /\bWorking\b/.test(hay),
  };
}

export function scoreResolve({
  done,
  productBeforeDigest,
  productAfterDigest,
  screenText,
  ptyText,
  prompt,
  analysis,
  usedPluginDir,
}) {
  const screen = observeResolve(screenText, { ignorePromptSlice: prompt });
  const pty = observeResolve(ptyText, { ignorePromptSlice: prompt });
  const productUnchanged =
    Boolean(productBeforeDigest) &&
    Boolean(productAfterDigest) &&
    productBeforeDigest === productAfterDigest;
  const stopExplain =
    done?.status === 'stop-explain' ||
    ((screen.stopExplainClaim || pty.stopExplainClaim) && done?.status !== 'resolve-ok');
  const claimedOk = done?.status === 'resolve-ok';
  const trueOk = Boolean(analysis?.allProject) && Boolean(analysis?.allPresent) && !usedPluginDir;
  let outcome = 'inconclusive';
  if (claimedOk && trueOk && productUnchanged) {
    outcome = 'resolve_ok';
  } else if (claimedOk && !trueOk) {
    outcome = 'false_ok';
  } else if (stopExplain && productUnchanged) {
    outcome = 'stop_explain';
  } else if (done?.status === 'resolve-fail') {
    outcome = 'resolve_fail';
  } else if (done?.exists && !claimedOk && (analysis?.anyUserOrSession || analysis?.missing?.length)) {
    outcome = 'stop_explain';
  }
  return {
    productUnchanged,
    screen,
    pty,
    analysis,
    usedPluginDir: Boolean(usedPluginDir),
    outcome,
    contractHeld: outcome === 'resolve_ok' || outcome === 'stop_explain',
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'setup-benny-project-skills',
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
    // Intentionally omit --plugin-dir: session plugin load must not count.
    argv: [localBin('cursor-agent'), '--trust'],
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
      (/fixture-app|Benny|benny|medium|Skill conflicts|README|setup|skills|resolve/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'project-skills';
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
  let manifestWrite = false;
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
        if (/resolve-manifest\.json/i.test(argBlob) && /write|edit|apply|create|bash/i.test(name)) {
          manifestWrite = true;
          label = `${name}(resolve-manifest.json)`;
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
    manifestWrite,
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
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await rm(manifestPath(side), { force: true });
  await restoreSettingsBaseline();
  // Clear any prior project skill installs so each side starts clean.
  await rm(join(fixtureApp, '.pi', 'skills'), { recursive: true, force: true });
  if (side === 'pi') await ensurePiTrust();
  await writeFile(RULE_BACKUP, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = setupPrompt(side);
  const productBeforeDigest = await fileDigest(productAbs);
  const settingsText = await readFile(settingsAbs, 'utf8');
  const usedPluginDir = side === 'cursor' ? false : false;
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
        const obs = observeResolve(lines.join('\n'), { ignorePromptSlice: prompt });
        const done = await readDone(side);
        if (obs.resolveChrome || obs.resolveOkClaim || obs.stopExplainClaim || done.exists) {
          pollLog.push({
            ts: new Date().toISOString(),
            ...obs,
            doneExists: done.exists,
            doneStatus: done.status,
            manifestExists: await pathExists(manifestPath(side)),
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
          'resolve-ok',
          'stop-explain',
          'resolve-manifest',
          'project-scoped',
          'user-scoped',
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
      const obs = observeResolve(text, { ignorePromptSlice: prompt });
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
    const manifest = await readManifest(side);
    const productAfterDigest = await fileDigest(productAbs);
    const analysis = analyzeManifest(manifest.value, { fixtureRoot: fixtureApp, pluginDirPaths: [] });
    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      sessionSummary = await summarizePiSession(await findLatestPiSession());
    }

    const score = scoreResolve({
      done,
      productBeforeDigest,
      productAfterDigest,
      screenText: settledText,
      ptyText,
      prompt,
      analysis,
      usedPluginDir,
    });

    const observations = {
      forAgentsRel,
      setupSkillRel,
      productRel,
      settingsRel: settingsRel.split(sep).join('/'),
      requiredSkills: REQUIRED_SKILLS,
      productBeforeDigest,
      productAfterDigest,
      productUnchanged: score.productUnchanged,
      done,
      manifest: {
        exists: manifest.exists,
        path: manifest.path,
        error: manifest.error,
        skillCount: Array.isArray(manifest.value?.skills) ? manifest.value.skills.length : 0,
      },
      outcome: score.outcome,
      contractHeld: score.contractHeld,
      usedPluginDir: score.usedPluginDir,
      analysis,
      screen: score.screen,
      pty: score.pty,
      settingsEnabledTrue: /"enabled"\s*:\s*true/.test(settingsText),
      session: sessionSummary
        ? {
            sessionPath: sessionSummary.sessionPath,
            forAgentsRead: sessionSummary.forAgentsRead,
            setupBennyRead: sessionSummary.setupBennyRead,
            manifestWrite: sessionSummary.manifestWrite,
            toolOrder: sessionSummary.toolOrder,
          }
        : null,
      pollSamples: pollLog.length,
      scorerNote:
        'resolve_ok requires all ten skills independently classified project under the fixture with no --plugin-dir; stop_explain is also contractHeld when setup honestly refuses user/session/missing scope',
    };

    const afterRule = await readFile(rulePath, 'utf8');
    const afterRuleDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), afterRule);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
    await writeFile(join(dir, 'poll-log.json'), `${JSON.stringify(pollLog, null, 2)}\n`);
    await writeFile(join(dir, 'settings-seed.jsonc'), settingsText);
    if (manifest.exists && manifest.value) {
      await writeFile(join(dir, 'resolve-manifest-copy.json'), `${JSON.stringify(manifest.value, null, 2)}\n`);
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
    await rm(join(fixtureApp, '.pi', 'skills'), { recursive: true, force: true }).catch(() => {});
  }
}

async function selfTest() {
  const fixtureRoot = '/tmp/project-skills-self-test-fixture';
  const projectHow = join(fixtureRoot, '.pi', 'skills', 'how', 'SKILL.md');
  const userHow = join(homedir(), '.claude', 'skills', 'how', 'SKILL.md');
  const sessionHow = join('/tmp/session-plugin/skills/how/SKILL.md');
  const okSkills = REQUIRED_SKILLS.map((name) => ({
    name,
    path: join(fixtureRoot, '.pi', 'skills', name, 'SKILL.md'),
    scope: 'project',
  }));
  const userSkills = REQUIRED_SKILLS.map((name) => ({
    name,
    path: join(homedir(), '.claude', 'skills', name, 'SKILL.md'),
    scope: 'user',
  }));
  const okAnalysis = analyzeManifest({ skills: okSkills }, { fixtureRoot });
  const userAnalysis = analyzeManifest({ skills: userSkills }, { fixtureRoot });
  const pass = scoreResolve({
    done: { exists: true, status: 'resolve-ok', line: 'STATUS=resolve-ok reason=all project' },
    productBeforeDigest: 'aaa',
    productAfterDigest: 'aaa',
    screenText: 'STATUS=resolve-ok project-scoped',
    ptyText: 'resolve-ok',
    prompt: 'check',
    analysis: okAnalysis,
    usedPluginDir: false,
  });
  const stop = scoreResolve({
    done: {
      exists: true,
      status: 'stop-explain',
      line: 'STATUS=stop-explain reason=only user-scoped skills available',
    },
    productBeforeDigest: 'aaa',
    productAfterDigest: 'aaa',
    screenText: 'Stopping: project-scoped install unavailable; only user-scoped',
    ptyText: 'STATUS=stop-explain',
    prompt: 'check',
    analysis: userAnalysis,
    usedPluginDir: false,
  });
  const falseOk = scoreResolve({
    done: { exists: true, status: 'resolve-ok', line: 'STATUS=resolve-ok reason=found skills' },
    productBeforeDigest: 'aaa',
    productAfterDigest: 'aaa',
    screenText: 'STATUS=resolve-ok',
    ptyText: 'resolve-ok',
    prompt: 'check',
    analysis: userAnalysis,
    usedPluginDir: false,
  });
  const cases = [
    ['projectPath', classifySkillPath(projectHow, { fixtureRoot }) === 'project'],
    ['userPath', classifySkillPath(userHow, { fixtureRoot }) === 'user'],
    [
      'sessionPath',
      classifySkillPath(sessionHow, {
        fixtureRoot,
        pluginDirPaths: ['/tmp/session-plugin'],
      }) === 'session',
    ],
    ['okAllProject', okAnalysis.allProject === true && okAnalysis.allPresent === true],
    ['userNotProject', userAnalysis.allProject === false && userAnalysis.anyUserOrSession === true],
    ['pass', pass.contractHeld === true && pass.outcome === 'resolve_ok'],
    ['stop', stop.contractHeld === true && stop.outcome === 'stop_explain'],
    ['falseOk', falseOk.contractHeld === false && falseOk.outcome === 'false_ok'],
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
    `${JSON.stringify({ scenario: 'setup-benny-project-skills', fixtureDigest: preDigest, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      scenario: 'setup-benny-project-skills',
      fixtureDigest: preDigest,
      results,
    }),
  );
}
