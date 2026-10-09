#!/usr/bin/env node
// Family 05 poteto-agent pair: invoke /poteto-mode with a tiny delegated marker write
// that forces one fresh poteto-agent Task, then observe whether the child loads
// poteto-mode SKILL.md (Principles index included) before other work.
// Real PTY both sides via the recorder.
//
// Usage: node scripts/capture-poteto-agent-read-skill.mjs [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/poteto-agent/
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
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
const evidenceRoot = join(root, 'evidence', 'poteto-agent');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;
const POLL_MS = 400;
const MARKER_LINE = 'HELLO';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stripAnsi = (text) =>
  text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');

function writeRootFor(side) {
  return join(evidenceRoot, 'fixture-out', side);
}

function markerPath(side) {
  return join(writeRootFor(side), 'marker.txt');
}

function donePath(side) {
  return join(writeRootFor(side), 'done.txt');
}

function potetoPrompt(side) {
  const marker = markerPath(side);
  const out = donePath(side);
  return (
    `/poteto-mode New playbook task. ` +
    `Spawn exactly one fresh poteto-agent Task (subagent_type poteto-agent; do not substitute generalPurpose) ` +
    `to write exactly the single line ${MARKER_LINE} to ${marker}. ` +
    `Parent must not write that marker itself. ` +
    `Work only inside this fixture cwd. Do not edit ledgers, parity/, or files outside this cwd. ` +
    `After the child finishes, parent writes exactly one line to ${out} naming the agent type used, then stop.`
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

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line };
}

async function readMarker(side) {
  const path = markerPath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line, ok: line === MARKER_LINE };
}

function observeSpawnText(text) {
  const potetoMode =
    /\/poteto-mode\b/i.test(text) ||
    /\[skill\]\s*poteto-mode/i.test(text) ||
    /\bUsed poteto-mode\b/i.test(text) ||
    /\bpoteto-mode\b/i.test(text);
  const potetoAgent =
    /\bpoteto-agent\b/i.test(text) ||
    /subagent_type["']?\s*[:=]\s*["']?poteto-agent/i.test(text) ||
    /agent_type["']?\s*[:=]\s*["']?poteto-agent/i.test(text);
  const generalPurpose =
    /\bgeneralPurpose\b/.test(text) ||
    /\bgeneral-purpose\b/i.test(text) ||
    /\bgeneral_purpose\b/i.test(text);
  const taskSpawn =
    (/\bTask\b/.test(text) || /\btask\b/.test(text) || /\bRunning subagent\b/i.test(text)) &&
    (potetoAgent || /subagent/i.test(text));
  const skillReadChrome =
    /poteto-mode[/\\]SKILL\.md/i.test(text) ||
    (/SKILL\.md/i.test(text) && /poteto-mode/i.test(text));
  const principlesChrome = /Principles index|## Principles|\bPrinciples\b.*poteto/i.test(text);
  const working = /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text);
  return {
    potetoMode,
    potetoAgent,
    generalPurpose,
    taskSpawn,
    skillReadChrome,
    principlesChrome,
    working,
  };
}

function isPotetoSkillPath(p) {
  if (!p) return false;
  const s = String(p);
  return /poteto-mode[/\\]SKILL\.md$/i.test(s) || /[/\\]poteto-mode[/\\]SKILL\.md/i.test(s);
}

function isGeneralPurposeKind(kind) {
  if (!kind) return false;
  const s = String(kind);
  return /^(generalPurpose|general-purpose|general_purpose)$/i.test(s);
}

function isPotetoAgentKind(kind) {
  if (!kind) return false;
  return String(kind).toLowerCase() === 'poteto-agent';
}

function classifyOrdering(skillFirstAt, otherWorkAt, skillSeen, workSeen) {
  if (skillFirstAt && otherWorkAt) {
    return skillFirstAt <= otherWorkAt ? 'skill_before_work' : 'work_before_skill';
  }
  if (skillFirstAt && !otherWorkAt) return 'skill_only';
  if (!skillFirstAt && otherWorkAt) return 'work_only';
  if (skillSeen || workSeen) return 'inconclusive';
  return 'neither';
}

function extractToolCallsFromJsonl(text) {
  const calls = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = o.timestamp || o.message?.timestamp || o.utc || null;
    const msg = o.message || o;
    const content = msg.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === 'toolCall' || part.type === 'tool_use' || part.type === 'tool-call') {
          const name = part.name || part.toolName || '';
          const args = part.arguments || part.input || {};
          calls.push({ ts, name, args, source: 'content' });
        }
      }
    }
    if (o.type === 'tool_call' || o.kind === 'tool_call') {
      const name = o.name || o.toolName || o.tool || '';
      const args = o.arguments || o.input || o.args || {};
      calls.push({ ts, name, args, source: 'top' });
    }
  }
  return calls;
}

function scoreChildCalls(calls) {
  const toolOrder = [];
  let firstSkillReadAt = null;
  let firstOtherWorkAt = null;
  let skillPath = null;
  let skillLimit = null;
  let principlesInPath = false;
  let substituted = false;
  let potetoSpawn = false;

  for (const call of calls) {
    const name = String(call.name || '');
    const args = call.args || {};
    const blob = JSON.stringify(args);
    toolOrder.push(name);

    const kind = args.subagent_type || args.agent_type || args.subagentType || args.agentType;
    if (/^(Task|task|Agent)$/i.test(name)) {
      if (isPotetoAgentKind(kind) || /poteto-agent/i.test(blob)) potetoSpawn = true;
      if (isGeneralPurposeKind(kind)) substituted = true;
    }

    const path =
      args.path ||
      args.file_path ||
      args.filePath ||
      args.target_file ||
      args.file ||
      (typeof args.command === 'string' && args.command.match(/(?:^|\s)(\S*poteto-mode\S*SKILL\.md)/i)?.[1]) ||
      null;

    const isRead =
      /^(Read|read|read_file|ReadFile|cat)$/i.test(name) ||
      (name === 'bash' && typeof args.command === 'string' && /\bcat\b/.test(args.command) && /SKILL\.md/.test(args.command));

    const isWork =
      /^(Write|write|Edit|edit|StrReplace|ApplyPatch|Bash|bash|Shell|shell|Delete|delete|TodoWrite|TaskCreate)$/i.test(
        name,
      ) ||
      (name === 'bash' && typeof args.command === 'string' && !/SKILL\.md/.test(args.command));

    if (isRead && isPotetoSkillPath(path || blob)) {
      if (!firstSkillReadAt) {
        firstSkillReadAt = call.ts || new Date().toISOString();
        skillPath = path || 'poteto-mode/SKILL.md';
        skillLimit = args.limit ?? args.end_line ?? args.endLine ?? null;
        principlesInPath = true;
      }
      continue;
    }

    if (isWork && !firstOtherWorkAt) {
      if (isRead && isPotetoSkillPath(path || blob)) continue;
      firstOtherWorkAt = call.ts || new Date().toISOString();
    }
  }

  const ordering = classifyOrdering(
    firstSkillReadAt,
    firstOtherWorkAt,
    Boolean(firstSkillReadAt),
    Boolean(firstOtherWorkAt),
  );
  const skillBeforeWork =
    ordering === 'skill_before_work' || ordering === 'skill_only';

  return {
    toolOrder: toolOrder.slice(0, 40),
    firstSkillReadAt,
    firstOtherWorkAt,
    skillPath,
    skillLimit,
    principlesIndexCovered: Boolean(firstSkillReadAt) && (skillLimit == null || Number(skillLimit) >= 80),
    ordering,
    skillBeforeWork,
    potetoSpawnInChild: potetoSpawn,
    generalPurposeInChild: substituted,
  };
}

async function summarizeTranscriptFile(path) {
  if (!path || !(await pathExists(path))) return null;
  const text = await readFile(path, 'utf8');
  const calls = extractToolCallsFromJsonl(text);
  const score = scoreChildCalls(calls);
  const hasInlineSkill =
    /poteto-mode[\s\S]{0,200}SKILL\.md/i.test(text) ||
    /<manually_attached_skills>[\s\S]*Skill Name:\s*poteto-mode/i.test(text);
  const hasPrinciplesInline = /## Principles/.test(text) && /poteto-mode/i.test(text);
  return {
    path,
    callCount: calls.length,
    hasInlineSkill,
    hasPrinciplesInline,
    ...score,
    skillLoadedBeforeWork:
      score.skillBeforeWork ||
      (hasInlineSkill && hasPrinciplesInline && score.ordering !== 'work_before_skill'),
  };
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'poteto-agent-fixture-app';
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
      } else if (entry.isFile() && entry.name.endsWith('.jsonl') && abs.includes(needle) && !abs.includes('/subagents/')) {
        const st = await stat(abs).catch(() => null);
        if (!st) continue;
        if (!best || st.mtimeMs > best.ms) best = { path: abs, ms: st.mtimeMs };
      }
    }
  }
  await walk(sessionsRoot);
  return best?.path ?? null;
}

async function summarizePiParentSession(sessionPath) {
  if (!sessionPath || !(await pathExists(sessionPath))) return null;
  const text = await readFile(sessionPath, 'utf8');
  const calls = extractToolCallsFromJsonl(text);
  const toolOrder = [];
  let potetoTask = false;
  let generalPurposeTask = false;
  let unknownAgent = false;
  let firstTaskAt = null;
  const taskArgs = [];

  for (const call of calls) {
    const name = String(call.name || '');
    toolOrder.push(name);
    if (!/^(Task|task)$/i.test(name)) continue;
    const args = call.args || {};
    const kind = args.subagent_type || args.agent_type || args.subagentType || args.agentType;
    taskArgs.push({ name, kind, ts: call.ts });
    if (!firstTaskAt) firstTaskAt = call.ts;
    if (isPotetoAgentKind(kind) || /poteto-agent/i.test(JSON.stringify(args))) potetoTask = true;
    if (isGeneralPurposeKind(kind)) generalPurposeTask = true;
  }
  if (/Unknown agent_type:\s*poteto-agent/i.test(text)) unknownAgent = true;

  let childPath = null;
  // Pi stores the parent jsonl next to a UUID dir: <ts>_<uuid>.jsonl and <uuid>/subagents/.
  const base = sessionPath.replace(/\.jsonl$/, '');
  const uuid = sessionPath.match(/_([0-9a-f-]{36})\.jsonl$/i)?.[1];
  const candidates = [
    join(dirname(sessionPath), 'subagents'),
    uuid ? join(dirname(sessionPath), uuid, 'subagents') : null,
    join(base, 'subagents'),
  ].filter(Boolean);
  for (const subDir of candidates) {
    if (!(await pathExists(subDir))) continue;
    const entries = await readdir(subDir);
    const jsonl = entries.filter((e) => e.endsWith('.jsonl'));
    let best = null;
    for (const e of jsonl) {
      const abs = join(subDir, e);
      const st = await stat(abs).catch(() => null);
      if (!st) continue;
      if (!best || st.mtimeMs > best.ms) best = { path: abs, ms: st.mtimeMs };
    }
    if (best) {
      childPath = best.path;
      break;
    }
  }

  const child = childPath ? await summarizeTranscriptFile(childPath) : null;
  return {
    sessionPath,
    toolOrder: toolOrder.slice(0, 40),
    potetoTask,
    generalPurposeTask,
    unknownAgent,
    firstTaskAt,
    taskArgs,
    childPath,
    child,
  };
}

async function findCursorChildTranscripts(sinceMs, markerAbs) {
  const projectsRoot = join(homedir(), '.cursor', 'projects');
  const hits = [];
  async function walk(dir, depth) {
    if (depth > 6) return;
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'agent-transcripts' || depth < 3) await walk(abs, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const st = await stat(abs).catch(() => null);
        if (!st || st.mtimeMs < sinceMs - 60_000) continue;
        let text;
        try {
          text = await readFile(abs, 'utf8');
        } catch {
          continue;
        }
        const mentionsMarker = text.includes(markerAbs) || text.includes('marker.txt');
        const mentionsPoteto =
          /poteto-agent/i.test(text) || /poteto-mode[/\\]SKILL\.md/i.test(text) || /HELLO/.test(text);
        if (mentionsMarker || (mentionsPoteto && /poteto-mode/i.test(text))) {
          hits.push({ path: abs, mtimeMs: st.mtimeMs, size: st.size });
        }
      }
    }
  }
  await walk(projectsRoot, 0);
  hits.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return hits.slice(0, 8);
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'cmd-poteto-agent-read-skill',
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
  const backupPath = `${referenceRulePath}.poteto-agent-read-skill-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.poteto-agent-read-skill-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(markerPath(side), { force: true });
  await rm(donePath(side), { force: true });
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = potetoPrompt(side);
  const pollLog = [];
  let firstSpawnAt = null;
  let firstSkillChromeAt = null;
  let attempt;
  const startedMs = Date.now();
  try {
    await writeFile(rulePath, ruleBytes);
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(ruleDigest) : piSpec(ruleDigest));
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitEither(attempt, GEOMETRY, ['note', 'README', 'pi', 'fixture'], 120_000);
    }
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);

    const stopPoll = new AbortController();
    const pollLoop = (async () => {
      while (!stopPoll.signal.aborted) {
        const now = new Date().toISOString();
        const lines = await screenLines(attempt, GEOMETRY);
        const screenObs = observeSpawnText(lines.join('\n'));
        if ((screenObs.potetoAgent || screenObs.taskSpawn) && !firstSpawnAt) firstSpawnAt = now;
        if (screenObs.skillReadChrome && !firstSkillChromeAt) firstSkillChromeAt = now;
        if (screenObs.potetoAgent || screenObs.taskSpawn || screenObs.skillReadChrome) {
          pollLog.push({
            ts: now,
            potetoAgent: screenObs.potetoAgent,
            taskSpawn: screenObs.taskSpawn,
            skillReadChrome: screenObs.skillReadChrome,
            generalPurpose: screenObs.generalPurpose,
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
        ['poteto-agent', 'poteto-mode', 'Running subagent', 'Task', 'HELLO', 'SKILL.md', 'marker.txt'],
        300_000,
      );
    } catch {
      // settle may still land artifacts
    }
    await dumpScreen(attempt, dir, '03-signal', GEOMETRY);

    const deadline = Date.now() + SETTLE_MS;
    let calm = 0;
    while (Date.now() < deadline) {
      const lines = await screenLines(attempt, GEOMETRY);
      const obs = observeSpawnText(lines.join('\n'));
      const done = await readDone(side);
      const marker = await readMarker(side);
      const enough = done.exists || marker.ok || (firstSpawnAt && !obs.working && Date.now() - Date.parse(firstSpawnAt) > 180_000);
      if (enough && !obs.working) {
        calm += 1;
        if (calm >= 3) break;
      } else {
        calm = 0;
      }
      await sleep(800);
    }
    try {
      await waitSettled(attempt, GEOMETRY, 90_000);
    } catch {
      // best-effort
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '04-settled', GEOMETRY);

    stopPoll.abort();
    await pollLoop.catch(() => {});

    const ptyText = stripAnsi(outputBytes(attempt.events()).toString('utf8'));
    const ptyObs = observeSpawnText(ptyText);
    if ((ptyObs.potetoAgent || ptyObs.taskSpawn) && !firstSpawnAt) {
      firstSpawnAt = new Date().toISOString();
    }

    let sessionSummary = null;
    let cursorChildren = [];
    let bestChild = null;

    if (side === 'pi') {
      await sleep(500);
      const sessionPath = await findLatestPiSession();
      sessionSummary = await summarizePiParentSession(sessionPath);
      bestChild = sessionSummary?.child ?? null;
      if (sessionSummary?.potetoTask && !firstSpawnAt) firstSpawnAt = sessionSummary.firstTaskAt;
    } else {
      const hits = await findCursorChildTranscripts(startedMs, markerPath(side));
      cursorChildren = [];
      for (const hit of hits) {
        const scored = await summarizeTranscriptFile(hit.path);
        if (!scored) continue;
        let text = '';
        try {
          text = await readFile(hit.path, 'utf8');
        } catch {
          text = '';
        }
        const wroteMarker =
          text.includes(markerPath(side)) &&
          (text.includes(`'${MARKER_LINE}'`) ||
            text.includes(`"${MARKER_LINE}"`) ||
            text.includes(`${MARKER_LINE}\\n`) ||
            /printf ['"]HELLO/.test(text));
        cursorChildren.push({ ...scored, wroteMarker });
      }
      bestChild =
        cursorChildren.find((c) => c.wroteMarker && (c.skillBeforeWork || c.skillLoadedBeforeWork)) ||
        cursorChildren.find((c) => c.wroteMarker) ||
        cursorChildren.find((c) => c.skillBeforeWork || c.skillLoadedBeforeWork) ||
        cursorChildren.find((c) => c.skillPath) ||
        cursorChildren[0] ||
        null;
    }

    const marker = await readMarker(side);
    const done = await readDone(side);
    const screenFinal = observeSpawnText((await screenLines(attempt, GEOMETRY)).join('\n'));

    const potetoAgentSpawned = Boolean(
      firstSpawnAt ||
        ptyObs.potetoAgent ||
        screenFinal.potetoAgent ||
        sessionSummary?.potetoTask ||
        bestChild?.potetoSpawnInChild,
    );
    const generalPurposeSubstituted = Boolean(
      sessionSummary?.generalPurposeTask && !sessionSummary?.potetoTask,
    );
    const unknownAgentType = Boolean(sessionSummary?.unknownAgent);
    const skillBeforeWork = Boolean(bestChild?.skillBeforeWork || bestChild?.skillLoadedBeforeWork);
    const principlesCovered = Boolean(
      bestChild?.principlesIndexCovered || bestChild?.hasPrinciplesInline,
    );

    let verdict = 'inconclusive';
    if (unknownAgentType || generalPurposeSubstituted) {
      verdict = generalPurposeSubstituted ? 'generalPurpose_substituted' : 'no_poteto_agent';
    } else if (!potetoAgentSpawned && !bestChild) {
      verdict = 'no_poteto_agent';
    } else if (bestChild?.ordering) {
      verdict = bestChild.ordering;
    } else if (skillBeforeWork) {
      verdict = 'skill_before_work';
    }

    const observations = {
      screenFinal,
      pty: {
        potetoMode: ptyObs.potetoMode,
        potetoAgent: ptyObs.potetoAgent,
        taskSpawn: ptyObs.taskSpawn,
        skillReadChrome: ptyObs.skillReadChrome,
        generalPurpose: ptyObs.generalPurpose,
      },
      firstSpawnAt,
      firstSkillChromeAt,
      marker,
      done,
      potetoAgentSpawned,
      generalPurposeSubstituted,
      unknownAgentType,
      skillBeforeWork,
      principlesCovered,
      verdict,
      passShaped:
        potetoAgentSpawned &&
        !generalPurposeSubstituted &&
        !unknownAgentType &&
        skillBeforeWork &&
        principlesCovered,
      session: sessionSummary,
      cursorChildren: cursorChildren.map((c) => ({
        path: c.path,
        ordering: c.ordering,
        skillBeforeWork: c.skillBeforeWork,
        skillLoadedBeforeWork: c.skillLoadedBeforeWork,
        skillPath: c.skillPath,
        principlesIndexCovered: c.principlesIndexCovered,
        hasInlineSkill: c.hasInlineSkill,
        toolOrder: c.toolOrder,
      })),
      bestChild: bestChild
        ? {
            path: bestChild.path,
            ordering: bestChild.ordering,
            skillBeforeWork: bestChild.skillBeforeWork,
            skillLoadedBeforeWork: bestChild.skillLoadedBeforeWork,
            skillPath: bestChild.skillPath,
            skillLimit: bestChild.skillLimit,
            principlesIndexCovered: bestChild.principlesIndexCovered,
            hasInlineSkill: bestChild.hasInlineSkill,
            hasPrinciplesInline: bestChild.hasPrinciplesInline,
            toolOrder: bestChild.toolOrder,
            firstSkillReadAt: bestChild.firstSkillReadAt,
            firstOtherWorkAt: bestChild.firstOtherWorkAt,
          }
        : null,
      pollSamples: pollLog.length,
    };

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
    await writeFile(join(dir, 'poll-log.json'), `${JSON.stringify(pollLog, null, 2)}\n`);

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
    scenario: 'cmd-poteto-agent-read-skill',
    fixtureDigest: preDigest,
    results,
  }),
);
