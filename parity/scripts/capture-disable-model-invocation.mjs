#!/usr/bin/env node
// cmd-disable-model-invocation: ordinary architectural chat turn with no /how
// and no skill handoff. Prove how is not host-auto-attached when
// disable-model-invocation is true. Real PTY both sides via the recorder.
//
// Usage: node scripts/capture-disable-model-invocation.mjs [--cursor-only|--pi-only|--both|--self-test]
// Evidence root: parity/evidence/disable-model/
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { outputBytes, startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'disable-model');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const howSkillCursor = join(root, 'reference', 'cursor-plugins', 'pstack', 'skills', 'how', 'SKILL.md');
const howSkillPi = join(root, '..', 'extensions', 'pi-pstack', 'skills', 'how', 'SKILL.md');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 900_000;

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

function answerPath(side) {
  return join(writeRootFor(side), 'answer.md');
}

function organicPrompt(side) {
  const answer = answerPath(side);
  const done = donePath(side);
  return (
    `In this fixture, walk through how store.js and api.js connect at runtime, ` +
    `and say which file should own soft-delete if we add it. ` +
    `This is an ordinary chat turn with no slash-skill invocation and no skill handoff. ` +
    `Do not edit src/, ledgers, or parity/ outside this cwd except the named out paths. ` +
    `Write a short overview to ${answer}. ` +
    `Then write exactly one line to ${done} as answered=yes|no and stop.`
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

export function parseHowFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { ok: false, disableModelInvocation: null, name: null };
  const body = match[1];
  const name = (body.match(/^name:\s*(.+)$/m) || [])[1]?.trim() ?? null;
  const disableRaw = (body.match(/^disable-model-invocation:\s*(.+)$/m) || [])[1]?.trim() ?? null;
  const disableModelInvocation = disableRaw === 'true' ? true : disableRaw === 'false' ? false : null;
  return {
    ok: name === 'how' && disableModelInvocation === true,
    name,
    disableModelInvocation,
  };
}

export function observeHostHowAttachment(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) {
    hay = hay.split(ignorePromptSlice).join(' ');
  }
  const usedHow = /\bUsed how\b/i.test(hay);
  const skillBracketHow = /\[skill\]\s*how\b/i.test(hay);
  const skillXmlHow = /<skill\s+name=["']how["']/i.test(hay);
  const slashHowCommand = /(^|[\s>])\/how\b/i.test(hay);
  const howExplainerChrome = /\bhow explainer\b/i.test(hay);
  return {
    usedHow,
    skillBracketHow,
    skillXmlHow,
    slashHowCommand,
    howExplainerChrome,
    hostAttached: Boolean(usedHow || skillBracketHow || skillXmlHow || howExplainerChrome),
  };
}

export function scoreDisableModel({
  prompt,
  screenText,
  ptyText,
  sessionSummary,
  frontmatter,
  doneLine,
  answerExists,
}) {
  const promptHasSlashHow = /^\s*\/how\b/i.test(prompt || '');
  const screen = observeHostHowAttachment(screenText, { ignorePromptSlice: prompt });
  const pty = observeHostHowAttachment(ptyText, { ignorePromptSlice: prompt });
  const sessionHostAttached = Boolean(sessionSummary?.skillInjectHow);
  const howInAvailableSkills = Boolean(sessionSummary?.howInAvailableSkills);
  const voluntaryHowRead = Boolean(sessionSummary?.howSkillFileRead);
  const hostAttached = Boolean(screen.hostAttached || pty.hostAttached || sessionHostAttached);
  const answered = /^answered=yes\b/i.test((doneLine || '').trim()) && Boolean(answerExists);
  const frontmatterOk = Boolean(frontmatter?.ok);
  const contractHeld =
    frontmatterOk &&
    !promptHasSlashHow &&
    !hostAttached &&
    !howInAvailableSkills &&
    answered;
  return {
    promptHasSlashHow,
    frontmatterOk,
    hostAttached,
    howInAvailableSkills,
    voluntaryHowRead,
    answered,
    contractHeld,
    screen,
    pty,
    sessionHostAttached,
  };
}

async function readHowFrontmatterFiles() {
  const cursorText = await readFile(howSkillCursor, 'utf8');
  const piText = await readFile(howSkillPi, 'utf8');
  return {
    cursor: { path: howSkillCursor, ...parseHowFrontmatter(cursorText) },
    pi: { path: howSkillPi, ...parseHowFrontmatter(piText) },
  };
}

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line };
}

async function readAnswer(side) {
  const path = answerPath(side);
  if (!(await pathExists(path))) return { exists: false, path, text: null };
  const text = await readFile(path, 'utf8');
  return { exists: true, path, text };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'cmd-disable-model-invocation',
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
  const backupPath = `${referenceRulePath}.disable-model-backup`;
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
      (/fixture-app|disable-model|store\.js|medium|Skill conflicts/i.test(text) || /README/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'disable-model-fixture-app';
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
        const ms = st.mtimeMs;
        if (!best || ms > best.ms) best = { path: abs, ms };
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
  let skillInjectHow = false;
  let howInAvailableSkills = false;
  let howSkillFileRead = false;
  const assistantTexts = [];
  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const blob = JSON.stringify(o);
    if (/<skill\s+name=["']how["']/i.test(blob)) skillInjectHow = true;
    const skillsSection = blob.match(/<available_skills>([\s\S]*?)<\/available_skills>/i);
    if (skillsSection && /<name>\s*how\s*<\/name>/i.test(skillsSection[1])) {
      howInAvailableSkills = true;
    }
    const msg = o.message || o;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type === 'toolCall' || part.type === 'tool_use') {
        const name = part.name || part.toolName || '';
        const args = part.arguments || part.input || {};
        const argBlob = JSON.stringify(args);
        let label = name;
        if (/skills\/how\/SKILL\.md/i.test(argBlob) || /\/how\/SKILL\.md/i.test(argBlob)) {
          howSkillFileRead = true;
          label = `${name}(how/SKILL.md)`;
        }
        toolOrder.push(label);
      }
      if (part.type === 'text' && typeof part.text === 'string' && (msg.role === 'assistant' || o.type === 'message')) {
        assistantTexts.push(part.text);
      }
    }
  }
  return {
    sessionPath,
    skillInjectHow,
    howInAvailableSkills,
    howSkillFileRead,
    toolOrder: toolOrder.slice(0, 120),
    assistantJoined: assistantTexts.join('\n\n'),
  };
}

function observeWorking(text) {
  return /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text);
}

async function runSide(side, ruleBytes, ruleDigest, frontmatter) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.disable-model-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await rm(answerPath(side), { force: true });
  if (side === 'pi') await ensurePiTrust();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = organicPrompt(side);
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
        ['answered=', 'store.js', 'api.js', 'soft-delete', 'soft delete', 'layer'],
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
      const answer = await readAnswer(side);
      const enough = done.exists && answer.exists;
      if (enough && !observeWorking(text)) {
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

    const settledText = (await screenLines(attempt, GEOMETRY)).join('\n');
    const ptyText = stripAnsi(outputBytes(attempt.events()).toString('utf8'));
    const done = await readDone(side);
    const answer = await readAnswer(side);
    let sessionSummary = null;
    if (side === 'pi') {
      await sleep(500);
      sessionSummary = await summarizePiSession(await findLatestPiSession());
    }

    const sideFrontmatter = side === 'cursor' ? frontmatter.cursor : frontmatter.pi;
    const score = scoreDisableModel({
      prompt,
      screenText: settledText,
      ptyText,
      sessionSummary,
      frontmatter: sideFrontmatter,
      doneLine: done.line,
      answerExists: answer.exists,
    });

    const observations = {
      frontmatter: sideFrontmatter,
      howHostAttached: score.hostAttached,
      howInAvailableSkills: score.howInAvailableSkills,
      voluntaryHowRead: score.voluntaryHowRead,
      promptHasSlashHow: score.promptHasSlashHow,
      answered: score.answered,
      contractHeld: score.contractHeld,
      done,
      answerExists: answer.exists,
      answerPreview: answer.text ? answer.text.slice(0, 400) : null,
      screen: score.screen,
      pty: score.pty,
      session: sessionSummary
        ? {
            sessionPath: sessionSummary.sessionPath,
            skillInjectHow: sessionSummary.skillInjectHow,
            howInAvailableSkills: sessionSummary.howInAvailableSkills,
            howSkillFileRead: sessionSummary.howSkillFileRead,
            toolOrder: sessionSummary.toolOrder,
          }
        : null,
      scorerNote:
        'hostAttached from Used how / [skill] how / <skill name="how"> / how explainer; voluntary read of how/SKILL.md is noted and not a fail',
    };

    if (answer.exists) {
      await writeFile(join(dir, 'answer-copy.md'), answer.text);
    }
    const afterRule = await readFile(rulePath, 'utf8');
    const afterRuleDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), afterRule);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);

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
  const frontmatterOk = parseHowFrontmatter(
    '---\nname: how\ndisable-model-invocation: true\n---\n# How\n',
  );
  const frontmatterBad = parseHowFrontmatter('---\nname: how\n---\n# How\n');
  const passCase = scoreDisableModel({
    prompt: 'walk through how store.js connects',
    screenText: 'store owns persistence\nanswered=yes',
    ptyText: 'soft-delete should live in store.js',
    sessionSummary: { skillInjectHow: false, howInAvailableSkills: false, howSkillFileRead: false },
    frontmatter: frontmatterOk,
    doneLine: 'answered=yes',
    answerExists: true,
  });
  const failAttach = scoreDisableModel({
    prompt: 'walk through how store.js connects',
    screenText: 'Used how\nstore owns persistence',
    ptyText: 'Used how',
    sessionSummary: null,
    frontmatter: frontmatterOk,
    doneLine: 'answered=yes',
    answerExists: true,
  });
  const failCatalog = scoreDisableModel({
    prompt: 'walk through how store.js connects',
    screenText: 'ok',
    ptyText: 'ok',
    sessionSummary: { skillInjectHow: false, howInAvailableSkills: true, howSkillFileRead: false },
    frontmatter: frontmatterOk,
    doneLine: 'answered=yes',
    answerExists: true,
  });
  const cases = [
    ['frontmatterOk', frontmatterOk.ok === true],
    ['frontmatterBad', frontmatterBad.ok === false],
    ['passCase', passCase.contractHeld === true],
    ['failAttach', failAttach.contractHeld === false && failAttach.hostAttached === true],
    ['failCatalog', failCatalog.contractHeld === false && failCatalog.howInAvailableSkills === true],
    [
      'organicHowWordNotSlash',
      observeHostHowAttachment('walk through how store.js connects').slashHowCommand === false,
    ],
  ];
  const failed = cases.filter(([, ok]) => !ok);
  console.log(JSON.stringify({ selfTest: failed.length === 0, cases }, null, 2));
  if (failed.length) process.exit(1);
}

if (only === '--self-test') {
  await selfTest();
  process.exit(0);
}

const frontmatter = await readHowFrontmatterFiles();
await writeFile(
  join(evidenceRoot, 'frontmatter.json'),
  `${JSON.stringify(frontmatter, null, 2)}\n`,
);
if (!frontmatter.cursor.ok || !frontmatter.pi.ok) {
  console.error('how skill frontmatter missing disable-model-invocation: true on locked paths');
  console.error(JSON.stringify(frontmatter, null, 2));
  process.exit(1);
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
  const result = await runSide(side, preRule, preDigest, frontmatter);
  results.push(result);
  console.log(JSON.stringify(result));
}
console.log(
  JSON.stringify({
    scenario: 'cmd-disable-model-invocation',
    fixtureDigest: preDigest,
    frontmatter,
    results,
  }),
);
