#!/usr/bin/env node
// Capture PSTACK-CMD-PLUGIN-SKILLS-REGISTER-001.
// Cursor: --plugin-dir locked pstack, open slash menus for skills and agents.
// Pi: loaded package, /pstack status skill count, slash probe for agents/skills.
//
// Usage: node parity/scripts/capture-plugin-skills-register.mjs [--cursor-only|--pi-only|--both]
// Evidence: parity/evidence/plugin-skills/
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitScreen } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'plugin-skills');
const lockedPlugin = join(root, 'reference', 'cursor-plugins', 'pstack');
const pluginJsonPath = join(lockedPlugin, '.cursor-plugin', 'plugin.json');
const packageJsonPath = join(root, '..', 'extensions', 'pi-pstack', 'package.json');
const fixtureCwd = join(root, 'fixtures', 'first-run');
const GEOMETRY = { rows: 36, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const LOCKED_PLUGIN_JSON_DIGEST = 'sha256:7bc736c60985805f70465e044e5adc7028663f72a73deea7fa3e95e52d70dc8e';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SKILL_NEEDLES = ['/how', '/poteto-mode', '/poteto-help', '/arena', '/interrogate'];
const AGENT_NEEDLES = ['/subagent-poteto-agent', '/subagent-comment-sicko'];

function observeRegistration(lines) {
  const text = lines.join('\n');
  const skillsSeen = SKILL_NEEDLES.filter((n) => text.includes(n));
  const agentsSeen = [
    ...AGENT_NEEDLES.filter((n) => text.includes(n)),
    ...(/poteto-agent/i.test(text) ? ['poteto-agent'] : []),
    ...(/comment-sicko|Comment Sicko/i.test(text) ? ['comment-sicko'] : []),
  ];
  const statusSkillCount = text.match(/(\d+)\s+skills(?:,|\s)/i)?.[1] ?? null;
  const packageSkillsPath =
    text.match(/pi-pstack\/skills\/[a-z0-9-]+\/SKILL\.md/i)?.[0] ??
    text.match(/extensions\/pi-pstack\/skills\//i)?.[0] ??
    null;
  const howAsTask = /→\s*how\s+\[task\]/i.test(text) || /^\s*how\s+\[task\]/im.test(text);
  return {
    skillsSeen,
    agentsSeen: [...new Set(agentsSeen)],
    skillCountFromNeedles: skillsSeen.length,
    agentCountFromNeedles: [...new Set(agentsSeen)].length,
    hasSkillsDirCue: /\/skills\/|skills\/|host\/skills/i.test(text),
    hasAgentsDirCue: /\/agents\/|subagent-|poteto-agent|comment-sicko/i.test(text),
    packageSkillsPath,
    howAsTask,
    statusSkillCount: statusSkillCount === null ? null : Number(statusSkillCount),
    mentionsPstackStatus: /pstack\s+0\.15\.15/i.test(text) || /\d+\s+skills,/i.test(text),
    slashMenuOpen: /→\s*\//.test(text) || /\/poteto-mode\s{2,}/.test(text) || /→\s*how\s+\[task\]/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'cmd-plugin-skills-register',
    fixtureRef: { path: fixturePath, digest: fixtureDigest },
    artifactPaths: [],
    launch: { argv, cwd, env },
    geometry: GEOMETRY,
  };
}

const cursorSpec = (fixtureDigest) =>
  spec({
    side: 'cursor',
    cwd: fixtureCwd,
    argv: [
      localBin('cursor-agent'),
      '--plugin-dir',
      lockedPlugin,
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
    cwd: fixtureCwd,
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
  if (current[fixtureCwd] === true) return;
  await mkdir(piAgentDir, { recursive: true });
  await writeFile(trustPath, `${JSON.stringify({ ...current, [fixtureCwd]: true }, null, 2)}\n`);
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
      (/claude-subscription|claude-sonnet/i.test(text) || /\$0\.\d+/.test(text) || /first-run/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function waitSlashSettled(attempt, timeoutMs, needle) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const text = last.join('\n');
    if (needle.test(text) && !/[\u2800-\u28FF]/.test(text)) return last;
    await sleep(250);
  }
  return last;
}

async function clearComposer(attempt) {
  attempt.input(Buffer.from('\u0015'), 'literal_user');
  await sleep(200);
  attempt.input(Buffer.from('\u0015'), 'literal_user');
  await sleep(200);
}

async function runCursor(ruleDigest) {
  const side = 'cursor';
  const dir = join(evidenceRoot, side);
  await mkdir(dir, { recursive: true });
  const observations = {};
  let attempt;
  try {
    attempt = await startAttempt(await cursorSpec(ruleDigest));
    await waitScreen(attempt, GEOMETRY, 'Tip:', 90_000);
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);
    observations.ready = observeRegistration(await screenLines(attempt, GEOMETRY));

    attempt.input(Buffer.from('/'), 'literal_user');
    await sleep(1200);
    await dumpScreen(attempt, dir, '01-slash-root', GEOMETRY);
    observations.slashRoot = observeRegistration(await screenLines(attempt, GEOMETRY));

    await clearComposer(attempt);
    attempt.input(Buffer.from('/how'), 'literal_user');
    await sleep(1200);
    const howLines = await waitSlashSettled(attempt, 20_000, /\/how/);
    await dumpScreen(attempt, dir, '02-slash-how', GEOMETRY);
    observations.slashHow = observeRegistration(howLines);

    await clearComposer(attempt);
    attempt.input(Buffer.from('/subagent'), 'literal_user');
    await sleep(1200);
    const agentLines = await waitSlashSettled(attempt, 20_000, /subagent/);
    await dumpScreen(attempt, dir, '03-slash-agents', GEOMETRY);
    observations.slashAgents = observeRegistration(agentLines);

    await clearComposer(attempt);
    attempt.input(Buffer.from('/poteto-mode'), 'literal_user');
    await sleep(1200);
    const potetoLines = await waitSlashSettled(attempt, 20_000, /\/poteto-mode/);
    await dumpScreen(attempt, dir, '04-slash-poteto', GEOMETRY);
    observations.slashPoteto = observeRegistration(potetoLines);

    const merged = {
      skillsSeen: [...new Set([
        ...observations.slashRoot.skillsSeen,
        ...observations.slashHow.skillsSeen,
        ...observations.slashPoteto.skillsSeen,
      ])],
      agentsSeen: [...new Set([
        ...observations.slashRoot.agentsSeen,
        ...observations.slashAgents.agentsSeen,
        ...observations.slashPoteto.agentsSeen,
      ])],
    };
    observations.merged = {
      ...merged,
      skillsRegistered: merged.skillsSeen.length > 0,
      agentsRegistered: merged.agentsSeen.length > 0,
      bothRegistered: merged.skillsSeen.length > 0 && merged.agentsSeen.length > 0,
    };

    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      fixtureDigest: ruleDigest,
      observations,
    };
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
  }
}

async function runPi(ruleDigest) {
  const side = 'pi';
  const dir = join(evidenceRoot, side);
  await mkdir(dir, { recursive: true });
  await ensurePiTrust();
  const observations = {};
  let attempt;
  try {
    await writeFile(piRulePath, await readFile(referenceRulePath));
    attempt = await startAttempt(await piSpec(ruleDigest));
    await waitPiChatReady(attempt, 120_000);
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);
    observations.ready = observeRegistration(await screenLines(attempt, GEOMETRY));

    // Skill-conflict panel on ready already cites the package skills/ path.
    observations.readySkillsPath = observations.ready.packageSkillsPath;

    attempt.input(Buffer.from('/pstack'), 'literal_user');
    await sleep(800);
    await dumpScreen(attempt, dir, '01a-pstack-typed', GEOMETRY);
    attempt.input(Buffer.from(' status'), 'literal_user');
    await sleep(400);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(1500);
    let statusLines = await screenLines(attempt, GEOMETRY);
    const statusDeadline = Date.now() + 45_000;
    while (Date.now() < statusDeadline) {
      statusLines = await screenLines(attempt, GEOMETRY);
      const text = statusLines.join('\n');
      if (/\d+\s+skills/i.test(text) && !/[\u2800-\u28FF]/.test(text)) break;
      await sleep(300);
    }
    await dumpScreen(attempt, dir, '01-pstack-status', GEOMETRY);
    observations.pstackStatus = observeRegistration(statusLines);

    await clearComposer(attempt);
    attempt.input(Buffer.from('/how'), 'literal_user');
    await sleep(1200);
    await dumpScreen(attempt, dir, '02-slash-how', GEOMETRY);
    observations.slashHow = observeRegistration(await screenLines(attempt, GEOMETRY));

    await clearComposer(attempt);
    attempt.input(Buffer.from('/subagents'), 'literal_user');
    await sleep(800);
    await dumpScreen(attempt, dir, '03a-subagents-typed', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    let subagentLines = await screenLines(attempt, GEOMETRY);
    const subDeadline = Date.now() + 45_000;
    while (Date.now() < subDeadline) {
      subagentLines = await screenLines(attempt, GEOMETRY);
      const text = subagentLines.join('\n');
      if ((/poteto-agent|comment-sicko|explore:|Disabled/i.test(text) || /subagent/i.test(text)) && !/[\u2800-\u28FF]/.test(text)) {
        // Prefer a listing that names persona agents when present.
        if (/poteto-agent|comment-sicko/i.test(text)) break;
        if (Date.now() > subDeadline - 5_000) break;
      }
      await sleep(300);
    }
    await dumpScreen(attempt, dir, '03-subagents-list', GEOMETRY);
    observations.subagentsList = observeRegistration(subagentLines);

    const skillsFromStatus = observations.pstackStatus.statusSkillCount !== null && observations.pstackStatus.statusSkillCount > 0;
    const skillsFromPackagePath = Boolean(observations.ready.packageSkillsPath || observations.pstackStatus.packageSkillsPath);
    const skillsFromSlash = observations.slashHow.skillsSeen.length > 0 || observations.slashHow.howAsTask;
    const agentsFromList = observations.subagentsList.agentsSeen.length > 0;

    observations.merged = {
      skillsRegistered: skillsFromStatus || skillsFromPackagePath || skillsFromSlash,
      agentsRegistered: agentsFromList,
      statusSkillCount: observations.pstackStatus.statusSkillCount,
      packageSkillsPath: observations.ready.packageSkillsPath || observations.pstackStatus.packageSkillsPath || null,
      skillsSeen: [...new Set([...observations.slashHow.skillsSeen])],
      agentsSeen: [...new Set([...observations.subagentsList.agentsSeen])],
      howAsTask: observations.slashHow.howAsTask,
      bothRegistered: (skillsFromStatus || skillsFromPackagePath || skillsFromSlash) && agentsFromList,
      bindingNote:
        'Pi binds skills via package.json pi.skills (./skills, ./host/skills) and agents via extension persona-agents from upstream/agents/, not via Cursor plugin.json skills/agents keys.',
    };

    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      fixtureDigest: ruleDigest,
      observations,
    };
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
  }
}

async function inventoryLockedPlugin() {
  const pluginJson = JSON.parse(await readFile(pluginJsonPath, 'utf8'));
  const pluginDigest = await sha256(pluginJsonPath);
  const skillDirs = await readdir(join(lockedPlugin, 'skills'));
  const agentFiles = await readdir(join(lockedPlugin, 'agents'));
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  return {
    pluginJsonPath,
    pluginDigest,
    pluginJsonDigestMatchesLock: pluginDigest === LOCKED_PLUGIN_JSON_DIGEST,
    manifestSkills: pluginJson.skills ?? null,
    manifestAgents: pluginJson.agents ?? null,
    skillDirCount: skillDirs.length,
    agentFileCount: agentFiles.length,
    agentFiles,
    piPackageSkills: packageJson.pi?.skills ?? null,
    piPackageVersion: packageJson.version ?? null,
  };
}

const preDigest = await sha256(referenceRulePath);
if (preDigest !== LOCKED_FIXTURE_DIGEST) {
  console.error(`Reference rule digest ${preDigest} does not match locked fixture ${LOCKED_FIXTURE_DIGEST}`);
  process.exit(1);
}
await mkdir(join(piAgentDir, 'pstack'), { recursive: true });
await mkdir(evidenceRoot, { recursive: true });

const inventory = await inventoryLockedPlugin();
await writeFile(join(evidenceRoot, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);

const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
const results = [];
for (const side of sides) {
  const result = side === 'cursor' ? await runCursor(preDigest) : await runPi(preDigest);
  results.push(result);
  console.log(JSON.stringify({ side: result.side, attemptId: result.attemptId, merged: result.observations.merged }));
}

console.log(
  JSON.stringify({
    scenario: 'cmd-plugin-skills-register',
    fixtureDigest: preDigest,
    inventory,
    results: results.map((r) => ({
      side: r.side,
      attemptId: r.attemptId,
      attemptDir: r.attemptDir,
      merged: r.observations.merged,
    })),
  }),
);
