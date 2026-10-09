#!/usr/bin/env node
// prin-guard-context: /poteto-mode inventory MARKER-* tokens from a large corpus/.
// Observe leaf Read of principle-guard-the-context-window and subagent routing of
// bulk dump reading. Deliver GUARD-OK + out/summary.json. Real PTY both sides.
//
// Evidence root: parity/evidence/principles/guard-context/
// Usage: node scripts/capture-prin-guard-context.mjs [--cursor-only|--pi-only|--both|--self-test]
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

import { sha256 } from '../recorder/files.mjs';
import { outputBytes, startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'principles', 'guard-context');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const guardSkillCursor = join(
  root,
  'reference',
  'cursor-plugins',
  'pstack',
  'skills',
  'principle-guard-the-context-window',
  'SKILL.md',
);
const guardSkillPi = join(
  root,
  '..',
  'extensions',
  'pi-pstack',
  'skills',
  'principle-guard-the-context-window',
  'SKILL.md',
);
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;
const POLL_MS = 400;
const VERIFY_OUT_REL = 'evidence/verify-out.txt';
const VERIFY_SCRIPT_REL = 'scripts/verify.mjs';
const SEED_SCRIPT_REL = 'scripts/seed-corpus.mjs';
const SUMMARY_REL = 'out/summary.json';
const MARKERS_REL = 'src/markers.json';
const EXPECTED_MARKERS = [
  'MARKER-ALPHA',
  'MARKER-BRAVO',
  'MARKER-CHARLIE',
  'MARKER-DELTA',
  'MARKER-ECHO',
  'MARKER-FOXTROT',
  'MARKER-GOLF',
  'MARKER-HOTEL',
];

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

function guardPrompt(side) {
  const out = donePath(side);
  return (
    `/poteto-mode Inventory every MARKER-* token under corpus/ into out/summary.json as ` +
    `{"markers":["..."]} sorted alphabetically, then make node scripts/verify.mjs print GUARD-OK. ` +
    `The dump tree is large (~40 dumps). Route the bulk corpus scan to a child Task/worker and keep ` +
    `only the compact marker summary in the main thread; do not paste dump bodies into chat. ` +
    `For any poteto-mode principle you apply before declaring done, read that principle's ` +
    `leaf SKILL.md in full first (not only the poteto-mode Principles index). ` +
    `Work only inside this fixture cwd. Do not edit ledgers, parity/, or files outside ` +
    `this cwd except the named done path. ` +
    `When GUARD-OK is on disk, write exactly one line to ${out} as verified=yes|no, then stop.`
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

async function walkFiles(dir, base = dir) {
  const out = [];
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
      out.push(...(await walkFiles(abs, base)));
    } else if (entry.isFile()) {
      out.push(relative(base, abs));
    }
  }
  return out;
}

async function fileDigest(path) {
  const body = await readFile(path);
  return createHash('sha256').update(body).digest('hex');
}

function runNode(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], { cwd: fixtureApp, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptPath} exited ${code}`));
    });
  });
}

export function parseGuardFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { ok: false, disableModelInvocation: null, name: null };
  const body = match[1];
  const name = (body.match(/^name:\s*(.+)$/m) || [])[1]?.trim() ?? null;
  const disableRaw = (body.match(/^disable-model-invocation:\s*(.+)$/m) || [])[1]?.trim() ?? null;
  const disableModelInvocation = disableRaw === 'true' ? true : disableRaw === 'false' ? false : null;
  return {
    ok: name === 'principle-guard-the-context-window' && disableModelInvocation === true,
    name,
    disableModelInvocation,
  };
}

function isGuardSkillPath(p) {
  if (!p) return false;
  return /principle-guard-the-context-window[/\\]SKILL\.md/i.test(String(p));
}

function isTaskToolName(name) {
  return /^(Task|task|Agent)$/i.test(String(name || ''));
}

function observeGuardText(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  const potetoMode =
    /\/poteto-mode\b/i.test(hay) ||
    /\[skill\]\s*poteto-mode/i.test(hay) ||
    /\bUsed poteto-mode\b/i.test(hay);
  const leafChrome = /principle-guard-the-context-window[/\\]SKILL\.md/i.test(hay);
  const usedLeaf = /\bUsed principle-guard-the-context-window\b/i.test(hay);
  const skillBracketLeaf = /\[skill\]\s*principle-guard-the-context-window\b/i.test(hay);
  const hostAttached = Boolean(usedLeaf || skillBracketLeaf);
  // Screen chrome only. Ignore tool-catalog prose such as TaskStop's
  // "Abort a running subagent" that lives in every Pi system prompt.
  const subagentChrome =
    /\bCalled Task\b/i.test(hay) ||
    /\bcursor · Task\b/i.test(hay) ||
    /\bRunning subagent\b.*\b(explore|generalPurpose|poteto-agent|ci-investigator)\b/i.test(hay);
  const verifyMention =
    /scripts\/verify\.mjs/i.test(hay) ||
    /evidence\/verify-out\.txt/i.test(hay) ||
    /\bGUARD-OK\b/.test(hay) ||
    /\bGUARD-FAIL\b/.test(hay);
  const working = /[\u2800-\u28FF]/.test(hay) || /\bWorking\b/.test(hay);
  return { potetoMode, leafChrome, hostAttached, subagentChrome, verifyMention, working };
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
          calls.push({
            ts,
            name: part.name || part.toolName || '',
            args: part.arguments || part.input || {},
          });
        }
      }
    }
    if (o.type === 'tool_call' || o.kind === 'tool_call') {
      calls.push({
        ts,
        name: o.name || o.toolName || o.tool || '',
        args: o.arguments || o.input || o.args || {},
      });
    }
    const blob = JSON.stringify(o);
    if (/principle-guard-the-context-window[/\\]SKILL\.md/i.test(blob)) {
      calls.push({
        ts,
        name: 'blob-mention',
        args: { path: 'principle-guard-the-context-window/SKILL.md' },
      });
    }
  }
  return calls;
}

function scoreCallsForGuard(calls) {
  let leafSkillRead = false;
  let leafSkillReadAt = null;
  let ranVerifyScript = false;
  let subagentRouted = false;
  let subagentRoutedAt = null;
  let parentCorpusReads = 0;
  const toolOrder = [];
  for (const call of calls) {
    const name = String(call.name || '');
    const args = call.args || {};
    const blob = JSON.stringify(args);
    const path =
      args.path ||
      args.file_path ||
      args.filePath ||
      args.target_file ||
      args.file ||
      null;
    const isRead =
      /^(Read|read|read_file|ReadFile|cat|blob-mention)$/i.test(name) ||
      (name === 'bash' && typeof args.command === 'string' && /\bcat\b/.test(args.command));
    if (isRead && isGuardSkillPath(path || blob)) {
      leafSkillRead = true;
      if (!leafSkillReadAt) leafSkillReadAt = call.ts || new Date().toISOString();
      toolOrder.push(`${name}(guard-leaf)`);
      continue;
    }
    const nestedTool = args.toolName || args.name || args.tool || '';
    const nestedArgs = args.arguments || args.input || args.args || {};
    const nestedKind =
      args.subagent_type ||
      args.agent_type ||
      nestedArgs.subagent_type ||
      nestedArgs.agent_type ||
      null;
    if (
      isTaskToolName(name) ||
      (/^(CallDynamicTool)$/i.test(name) && isTaskToolName(nestedTool))
    ) {
      subagentRouted = true;
      if (!subagentRoutedAt) subagentRoutedAt = call.ts || new Date().toISOString();
      toolOrder.push(`${name}(subagent${nestedKind ? `:${nestedKind}` : ''})`);
      continue;
    }
    if (
      /\bscripts\/verify\.mjs\b/i.test(blob) ||
      (typeof args.command === 'string' && /verify\.mjs/.test(args.command))
    ) {
      ranVerifyScript = true;
      toolOrder.push(`${name}(verify.mjs)`);
      continue;
    }
    if (isRead && /corpus[/\\]/i.test(String(path || blob))) {
      parentCorpusReads += 1;
      toolOrder.push(`${name}(corpus)`);
      continue;
    }
    if (name) toolOrder.push(name);
  }
  return {
    leafSkillRead,
    leafSkillReadAt,
    ranVerifyScript,
    subagentRouted,
    subagentRoutedAt,
    parentCorpusReads,
    toolOrder: toolOrder.slice(0, 80),
  };
}

export function scoreGuardContext({
  frontmatter,
  done,
  verifyOut,
  summary,
  productOk,
  screenText,
  ptyText,
  sessionScore,
  transcriptScore,
  prompt,
}) {
  const screen = observeGuardText(screenText, { ignorePromptSlice: prompt });
  const pty = observeGuardText(ptyText, { ignorePromptSlice: prompt });
  const leafSkillRead = Boolean(
    sessionScore?.leafSkillRead ||
      transcriptScore?.leafSkillRead ||
      screen.leafChrome ||
      pty.leafChrome,
  );
  const usedChrome = Boolean(screen.hostAttached || pty.hostAttached || sessionScore?.hostAttached);
  const modelAutoInvoke = usedChrome && !leafSkillRead;
  // Prefer tool-call / child-session evidence. Screen chrome is supporting only.
  const subagentRouted = Boolean(
    sessionScore?.subagentRouted ||
      transcriptScore?.subagentRouted ||
      sessionScore?.childSession ||
      transcriptScore?.childSession ||
      ((screen.subagentChrome || pty.subagentChrome) &&
        (sessionScore?.leafSkillRead || transcriptScore?.leafSkillRead || leafSkillRead)),
  );
  const keptVerifyOk = Boolean(verifyOut?.ok);
  const summaryOk = Boolean(summary?.ok);
  const verifiedDone = /^verified=yes\b/i.test((done?.line || '').trim());
  const frontmatterOk = Boolean(frontmatter?.ok);
  const contractHeld =
    frontmatterOk &&
    leafSkillRead &&
    subagentRouted &&
    productOk &&
    keptVerifyOk &&
    summaryOk &&
    verifiedDone &&
    !modelAutoInvoke;
  return {
    frontmatterOk,
    leafSkillRead,
    usedChrome,
    modelAutoInvoke,
    subagentRouted,
    keptVerifyOk,
    summaryOk,
    productOk: Boolean(productOk),
    verifiedDone,
    contractHeld,
    screen,
    pty,
  };
}

async function ensureCorpus() {
  await runNode(join(fixtureApp, SEED_SCRIPT_REL));
}

async function baselineProduct() {
  const map = {};
  for (const rel of [MARKERS_REL]) {
    map[rel] = await fileDigest(join(fixtureApp, rel));
  }
  return map;
}

async function snapshotBaseline() {
  const baselineDir = join(evidenceRoot, 'fixture-baseline');
  for (const rel of [
    MARKERS_REL,
    'README.md',
    'NOTES.md',
    'package.json',
    VERIFY_SCRIPT_REL,
    SEED_SCRIPT_REL,
    'evidence/.gitkeep',
    'out/.gitkeep',
  ]) {
    const src = join(fixtureApp, rel);
    if (!(await pathExists(src))) continue;
    const dst = join(baselineDir, rel);
    await mkdir(dirname(dst), { recursive: true });
    await writeFile(dst, await readFile(src));
  }
}

async function restoreProduct() {
  const baselineDir = join(evidenceRoot, 'fixture-baseline');
  for (const rel of [
    MARKERS_REL,
    'README.md',
    'NOTES.md',
    'package.json',
    VERIFY_SCRIPT_REL,
    SEED_SCRIPT_REL,
    'evidence/.gitkeep',
    'out/.gitkeep',
  ]) {
    const src = join(baselineDir, rel);
    const dst = join(fixtureApp, rel);
    if (await pathExists(src)) {
      await mkdir(dirname(dst), { recursive: true });
      await writeFile(dst, await readFile(src));
    }
  }
  await rm(join(fixtureApp, VERIFY_OUT_REL), { force: true });
  await rm(join(fixtureApp, SUMMARY_REL), { force: true });
  await ensureCorpus();
  const files = await walkFiles(fixtureApp);
  for (const rel of files) {
    if (
      rel === 'README.md' ||
      rel === 'NOTES.md' ||
      rel === 'package.json' ||
      rel === MARKERS_REL ||
      rel === VERIFY_SCRIPT_REL ||
      rel === SEED_SCRIPT_REL ||
      rel === 'evidence/.gitkeep' ||
      rel === 'out/.gitkeep' ||
      rel.startsWith('corpus/')
    ) {
      continue;
    }
    if (rel.startsWith('evidence/') || rel.startsWith('out/') || rel.endsWith('.tsv') || rel.startsWith('.audit/')) {
      await rm(join(fixtureApp, rel), { force: true, recursive: true });
    }
  }
}

async function readVerifyOut() {
  const path = join(fixtureApp, VERIFY_OUT_REL);
  if (!(await pathExists(path))) return { exists: false, path, line: null, ok: false };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line, ok: /^GUARD-OK\b/.test(line) };
}

async function readSummary() {
  const path = join(fixtureApp, SUMMARY_REL);
  if (!(await pathExists(path))) return { exists: false, path, line: null, ok: false, markers: null };
  const raw = (await readFile(path, 'utf8')).trim();
  let markers = null;
  try {
    const parsed = JSON.parse(raw);
    markers = Array.isArray(parsed?.markers) ? parsed.markers.map(String).sort() : null;
  } catch {
    markers = null;
  }
  const want = [...EXPECTED_MARKERS].sort();
  const ok =
    Array.isArray(markers) &&
    markers.length === want.length &&
    markers.every((m, i) => m === want[i]);
  return { exists: true, path, line: raw, ok, markers };
}

async function independentProductOk() {
  const summary = await readSummary();
  return Boolean(summary.ok);
}

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line };
}

async function readFrontmatterFiles() {
  const cursorText = await readFile(guardSkillCursor, 'utf8');
  const piText = await readFile(guardSkillPi, 'utf8');
  return {
    cursor: { path: guardSkillCursor, ...parseGuardFrontmatter(cursorText) },
    pi: { path: guardSkillPi, ...parseGuardFrontmatter(piText) },
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'prin-guard-context',
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
  const backupPath = `${referenceRulePath}.prin-guard-context-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function ensurePiTrust() {
  const trustPath = join(piAgentDir, 'trusted-folders.json');
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
      (/guard-context|corpus|README|medium|Skill conflicts|Session TTL|fixture-app/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'guard-context-fixture-app';
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
      if (entry.isDirectory()) await walk(abs);
      else if (
        entry.isFile() &&
        entry.name.endsWith('.jsonl') &&
        abs.includes(needle) &&
        !abs.includes('/subagents/')
      ) {
        const st = await stat(abs).catch(() => null);
        if (!st) continue;
        if (!best || st.mtimeMs > best.ms) best = { path: abs, ms: st.mtimeMs };
      }
    }
  }
  await walk(sessionsRoot);
  return best?.path ?? null;
}

async function findPiChildSession(sessionPath) {
  if (!sessionPath) return null;
  const uuid = sessionPath.match(/_([0-9a-f-]{36})\.jsonl$/i)?.[1];
  const base = sessionPath.replace(/\.jsonl$/, '');
  const candidates = [
    join(dirname(sessionPath), 'subagents'),
    uuid ? join(dirname(sessionPath), uuid, 'subagents') : null,
    join(base, 'subagents'),
  ].filter(Boolean);
  let best = null;
  for (const subDir of candidates) {
    if (!(await pathExists(subDir))) continue;
    const entries = await readdir(subDir);
    for (const e of entries.filter((n) => n.endsWith('.jsonl'))) {
      const abs = join(subDir, e);
      const st = await stat(abs).catch(() => null);
      if (!st) continue;
      if (!best || st.mtimeMs > best.ms) best = { path: abs, ms: st.mtimeMs };
    }
  }
  return best?.path ?? null;
}

async function summarizePiSession(sessionPath) {
  if (!sessionPath || !(await pathExists(sessionPath))) return null;
  const text = await readFile(sessionPath, 'utf8');
  const calls = extractToolCallsFromJsonl(text);
  const scored = scoreCallsForGuard(calls);
  const hostAttached =
    /\bUsed principle-guard-the-context-window\b/i.test(text) ||
    /\[skill\]\s*principle-guard-the-context-window\b/i.test(text);
  const childSession = await findPiChildSession(sessionPath);
  return {
    sessionPath,
    hostAttached,
    childSession,
    ...scored,
    subagentRouted: scored.subagentRouted || Boolean(childSession),
  };
}

async function findCursorTranscripts(sinceMs, side) {
  const projectsRoot = join(homedir(), '.cursor', 'projects');
  const doneAbs = donePath(side);
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
        const mentionsThisAttempt =
          text.includes(doneAbs) ||
          (text.includes(`guard-context/fixture-out/${side}/done.txt`) && text.includes('corpus/'));
        if (mentionsThisAttempt) hits.push({ path: abs, mtimeMs: st.mtimeMs, size: st.size });
      }
    }
  }
  await walk(projectsRoot, 0);
  hits.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return hits.slice(0, 8);
}

async function summarizeCursorTranscripts(sinceMs, side) {
  const hits = await findCursorTranscripts(sinceMs, side);
  let best = null;
  for (const hit of hits) {
    const text = await readFile(hit.path, 'utf8');
    const scored = scoreCallsForGuard(extractToolCallsFromJsonl(text));
    const leafInBlob = /principle-guard-the-context-window[/\\]SKILL\.md/i.test(text);
    const subagentChrome = observeGuardText(text).subagentChrome;
    const merged = {
      path: hit.path,
      ...scored,
      leafSkillRead: scored.leafSkillRead || leafInBlob,
      subagentRouted: scored.subagentRouted || subagentChrome,
    };
    const rank =
      (merged.leafSkillRead ? 4 : 0) +
      (merged.subagentRouted ? 4 : 0) +
      (merged.ranVerifyScript ? 2 : 0);
    const bestRank = best
      ? (best.leafSkillRead ? 4 : 0) + (best.subagentRouted ? 4 : 0) + (best.ranVerifyScript ? 2 : 0)
      : -1;
    if (!best || rank > bestRank || (rank === bestRank && hit.mtimeMs > (best.mtimeMs || 0))) {
      best = { ...merged, mtimeMs: hit.mtimeMs };
    }
  }
  return best;
}

async function pollOnce() {
  const now = new Date().toISOString();
  const hits = { summary: [], verify: [] };
  if (await pathExists(join(fixtureApp, SUMMARY_REL))) hits.summary.push(SUMMARY_REL);
  if (await pathExists(join(fixtureApp, VERIFY_OUT_REL))) hits.verify.push(VERIFY_OUT_REL);
  return { now, hits };
}

async function runSide(side, ruleBytes, ruleDigest, frontmatter) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.prin-guard-context-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await snapshotBaseline();
  await restoreProduct();
  const baseline = await baselineProduct();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = guardPrompt(side);
  const pollLog = [];
  let firstSummaryAt = null;
  let firstVerifyAt = null;
  let attempt;
  const startedAt = Date.now();
  try {
    await writeFile(rulePath, ruleBytes);
    if (side === 'pi') await ensurePiTrust();
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
        const snap = await pollOnce();
        if (snap.hits.summary.length && !firstSummaryAt) firstSummaryAt = snap.now;
        if (snap.hits.verify.length && !firstVerifyAt) firstVerifyAt = snap.now;
        if (snap.hits.summary.length || snap.hits.verify.length) {
          pollLog.push({ ts: snap.now, summary: snap.hits.summary, verify: snap.hits.verify });
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
          'poteto-mode',
          'corpus',
          'verify',
          'GUARD-OK',
          'GUARD-FAIL',
          'principle-guard-the-context-window',
          'Running subagent',
          'Task',
          'Phase',
        ],
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
      const obs = observeGuardText(lines.join('\n'), { ignorePromptSlice: prompt });
      const done = await readDone(side);
      const verify = await readVerifyOut();
      const enough = done.exists || verify.ok;
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

    const finalSnap = await pollOnce();
    if (finalSnap.hits.summary.length && !firstSummaryAt) firstSummaryAt = finalSnap.now;
    if (finalSnap.hits.verify.length && !firstVerifyAt) firstVerifyAt = finalSnap.now;

    const ptyText = stripAnsi(outputBytes(attempt.events()).toString('utf8'));
    const screenText = (await screenLines(attempt, GEOMETRY)).join('\n');
    const done = await readDone(side);
    const verifyOut = await readVerifyOut();
    const summary = await readSummary();
    const productOk = await independentProductOk();

    let sessionScore = null;
    let transcriptScore = null;
    if (side === 'pi') {
      await sleep(500);
      sessionScore = await summarizePiSession(await findLatestPiSession());
    } else {
      transcriptScore = await summarizeCursorTranscripts(startedAt, side);
    }

    const score = scoreGuardContext({
      frontmatter: frontmatter[side],
      done,
      verifyOut,
      summary,
      productOk,
      screenText,
      ptyText,
      sessionScore,
      transcriptScore,
      prompt,
    });

    const observations = {
      score,
      firstSummaryAt,
      firstVerifyAt,
      done,
      verifyOut,
      summary,
      productOk,
      frontmatter: frontmatter[side],
      session: sessionScore,
      transcript: transcriptScore,
      pollSamples: pollLog.length,
      screenFinal: observeGuardText(screenText, { ignorePromptSlice: prompt }),
      pty: observeGuardText(ptyText, { ignorePromptSlice: prompt }),
      baseline,
    };

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
    await writeFile(join(dir, 'poll-log.json'), `${JSON.stringify(pollLog, null, 2)}\n`);
    await writeFile(join(dir, 'baseline-product.json'), `${JSON.stringify(baseline, null, 2)}\n`);
    if (verifyOut.exists) {
      await writeFile(join(dir, 'verify-out-copy.txt'), `${verifyOut.line}\n`);
      await mkdir(join(writeRootFor(side), 'evidence'), { recursive: true });
      await writeFile(join(writeRootFor(side), VERIFY_OUT_REL), `${verifyOut.line}\n`);
    }
    if (summary.exists) {
      await writeFile(join(dir, 'summary-copy.txt'), `${summary.line}\n`);
      await mkdir(join(writeRootFor(side), 'out'), { recursive: true });
      await writeFile(join(writeRootFor(side), SUMMARY_REL), `${summary.line}\n`);
    }
    if (done.exists) {
      await writeFile(join(dir, 'done-copy.txt'), `${done.line}\n`);
    }

    const snapDir = join(attempt.dir, 'fixture-snapshot');
    await mkdir(snapDir, { recursive: true });
    for (const rel of [
      MARKERS_REL,
      'README.md',
      'NOTES.md',
      'package.json',
      VERIFY_SCRIPT_REL,
      SEED_SCRIPT_REL,
      VERIFY_OUT_REL,
      SUMMARY_REL,
    ]) {
      const abs = join(fixtureApp, rel);
      if (!(await pathExists(abs))) continue;
      const dest = join(snapDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, await readFile(abs));
    }

    const afterDir = join(dir, 'fixture-after');
    await mkdir(afterDir, { recursive: true });
    for (const rel of [MARKERS_REL, VERIFY_OUT_REL, SUMMARY_REL]) {
      const abs = join(fixtureApp, rel);
      if (!(await pathExists(abs))) continue;
      const dest = join(afterDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, await readFile(abs));
    }

    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      ruleUnchanged: after === ruleBytes,
      afterDigest,
      fixtureDigest: ruleDigest,
      prompt,
      observations,
      identity: JSON.parse(await readFile(join(attempt.dir, 'identity.json'), 'utf8')),
    };
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
    await restoreRule(ruleBytes);
    await restoreProduct();
  }
}

async function selfTest() {
  const fm = {
    ok: true,
    name: 'principle-guard-the-context-window',
    disableModelInvocation: true,
  };
  const pass = scoreGuardContext({
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: { exists: true, line: 'GUARD-OK markers=8', ok: true },
    summary: { exists: true, line: '{}', ok: true },
    productOk: true,
    screenText: 'Read principle-guard-the-context-window/SKILL.md Running subagent GUARD-OK',
    ptyText: 'Used principle-guard-the-context-window\nprinciple-guard-the-context-window/SKILL.md',
    sessionScore: {
      leafSkillRead: true,
      ranVerifyScript: true,
      hostAttached: true,
      subagentRouted: true,
    },
    transcriptScore: null,
    prompt: guardPrompt('cursor'),
  });
  const noSub = scoreGuardContext({
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: { exists: true, line: 'GUARD-OK markers=8', ok: true },
    summary: { exists: true, line: '{}', ok: true },
    productOk: true,
    screenText: 'Read principle-guard-the-context-window/SKILL.md GUARD-OK',
    ptyText: 'principle-guard-the-context-window/SKILL.md',
    sessionScore: { leafSkillRead: true, ranVerifyScript: true, subagentRouted: false },
    transcriptScore: { leafSkillRead: true, subagentRouted: false },
    prompt: guardPrompt('cursor'),
  });
  const noLeaf = scoreGuardContext({
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: { exists: true, line: 'GUARD-OK markers=8', ok: true },
    summary: { exists: true, line: '{}', ok: true },
    productOk: true,
    screenText: 'Running subagent GUARD-OK',
    ptyText: 'GUARD-OK',
    sessionScore: { leafSkillRead: false, ranVerifyScript: true, subagentRouted: true },
    transcriptScore: { leafSkillRead: false, subagentRouted: true },
    prompt: guardPrompt('cursor'),
  });
  const autoInvoke = scoreGuardContext({
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: { exists: true, line: 'GUARD-OK markers=8', ok: true },
    summary: { exists: true, line: '{}', ok: true },
    productOk: true,
    screenText: 'Used principle-guard-the-context-window Running subagent',
    ptyText: 'Used principle-guard-the-context-window',
    sessionScore: {
      leafSkillRead: false,
      ranVerifyScript: true,
      hostAttached: true,
      subagentRouted: true,
    },
    transcriptScore: { leafSkillRead: false, subagentRouted: true },
    prompt: guardPrompt('cursor'),
  });
  const taskScore = scoreCallsForGuard([
    {
      name: 'Read',
      args: { path: '/x/principle-guard-the-context-window/SKILL.md' },
      ts: 't1',
    },
    { name: 'Task', args: { subagent_type: 'explore', prompt: 'scan corpus' }, ts: 't2' },
  ]);
  const dynamicTask = scoreCallsForGuard([
    {
      name: 'CallDynamicTool',
      args: {
        namespace: 'cursor',
        toolName: 'Task',
        arguments: { subagent_type: 'poteto-agent', prompt: 'scan corpus' },
      },
      ts: 't3',
    },
  ]);
  const catalogNoise = scoreGuardContext({
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: { exists: true, line: 'GUARD-OK markers=8', ok: true },
    summary: { exists: true, line: '{}', ok: true },
    productOk: true,
    screenText: 'TaskStop: Abort a running subagent',
    ptyText: 'TaskStop: Abort a running subagent',
    sessionScore: { leafSkillRead: true, ranVerifyScript: true, subagentRouted: false },
    transcriptScore: null,
    prompt: guardPrompt('cursor'),
  });
  const cases = [
    ['pass', pass.contractHeld === true && pass.subagentRouted === true],
    ['noSub', noSub.contractHeld === false && noSub.subagentRouted === false],
    ['noLeaf', noLeaf.contractHeld === false && noLeaf.leafSkillRead === false],
    ['autoInvoke', autoInvoke.contractHeld === false && autoInvoke.modelAutoInvoke === true],
    ['taskScore', taskScore.leafSkillRead === true && taskScore.subagentRouted === true],
    ['dynamicTask', dynamicTask.subagentRouted === true],
    ['catalogNoise', catalogNoise.subagentRouted === false && catalogNoise.contractHeld === false],
    ['frontmatter', parseGuardFrontmatter(await readFile(guardSkillCursor, 'utf8')).ok === true],
  ];
  const failed = cases.filter(([, ok]) => !ok);
  console.log(JSON.stringify({ selfTest: failed.length === 0, cases }, null, 2));
  if (failed.length) process.exit(1);
}

async function writePair(results, preDigest) {
  const bySide = Object.fromEntries(results.map((r) => [r.side, r]));
  if (!bySide.cursor || !bySide.pi) return null;
  const cursor = bySide.cursor;
  const pi = bySide.pi;
  const pair = {
    schema: 1,
    pairId: 'prin-guard-context-1',
    scenarioRef: 'prin-guard-context',
    journeyFamily: 'journey-family-principles',
    requirementIds: ['PSTACK-PRIN-GUARD-CONTEXT-001'],
    fixtureDigest: preDigest,
    promptSharedShape: guardPrompt('<side>').replace(
      /fixture-out\/<side>\//,
      'fixture-out/<side>/',
    ),
    steps: [
      { wait: 'ready screen (Tip: on Cursor; Pi chat ready without Trust dialog)' },
      {
        send: '/poteto-mode inventory MARKER-* from corpus/ into out/summary.json; GUARD-OK; leaf SKILL.md; write verified=yes|no',
      },
      { send: '\r' },
      { wait: 'on-disk evidence/verify-out.txt with GUARD-OK' },
      { wait: 'done marker verified=yes' },
      { cancel: true },
    ],
    cursor: {
      attemptId: cursor.attemptId,
      dir: cursor.attemptDir,
      ruleUnchanged: cursor.ruleUnchanged,
      afterDigest: cursor.afterDigest,
      executable: cursor.identity?.executable ?? null,
      observedEnv: cursor.identity?.observedEnv ?? null,
      transcript: cursor.observations?.transcript?.path ?? null,
      proofCopyPath: 'parity/evidence/principles/guard-context/fixture-out/cursor/evidence/verify-out.txt',
      observations: {
        potetoMode: Boolean(
          cursor.observations?.screenFinal?.potetoMode || cursor.observations?.pty?.potetoMode,
        ),
        leafSkillRead: cursor.observations.score.leafSkillRead,
        leafSkillPath: cursor.observations?.transcript?.toolOrder?.find((t) => /guard-leaf/.test(t))
          ? '~/.claude/skills/principle-guard-the-context-window/SKILL.md'
          : cursor.observations.score.leafSkillRead
            ? 'principle-guard-the-context-window/SKILL.md'
            : null,
        subagentRouted: cursor.observations.score.subagentRouted,
        summaryOk: cursor.observations.score.summaryOk,
        keptVerifyOk: cursor.observations.score.keptVerifyOk,
        verifyLine: cursor.observations?.verifyOut?.line ?? null,
        productOk: cursor.observations.score.productOk,
        verifiedDone: cursor.observations.score.verifiedDone,
        modelAutoInvoke: cursor.observations.score.modelAutoInvoke,
        contractHeld: cursor.observations.score.contractHeld,
        ranVerifyScript: Boolean(cursor.observations?.transcript?.ranVerifyScript),
        modelChrome: 'unobserved on ready/settled screen dumps',
        oracleNote: cursor.observations.score.contractHeld
          ? 'Leaf Read + subagent routing + GUARD-OK summary.'
          : `Honest gap: leaf=${cursor.observations.score.leafSkillRead} subagent=${cursor.observations.score.subagentRouted} verify=${cursor.observations.score.keptVerifyOk} done=${cursor.observations.score.verifiedDone}`,
      },
    },
    pi: {
      attemptId: pi.attemptId,
      dir: pi.attemptDir,
      ruleUnchanged: pi.ruleUnchanged,
      afterDigest: pi.afterDigest,
      executable: pi.identity?.executable ?? null,
      observedEnv: pi.identity?.observedEnv ?? null,
      session: pi.observations?.session?.sessionPath ?? null,
      proofCopyPath: 'parity/evidence/principles/guard-context/fixture-out/pi/evidence/verify-out.txt',
      observations: {
        potetoMode: Boolean(pi.observations?.screenFinal?.potetoMode || pi.observations?.pty?.potetoMode),
        leafSkillRead: pi.observations.score.leafSkillRead,
        leafSkillPath: pi.observations.score.leafSkillRead
          ? 'extensions/pi-pstack/skills/principle-guard-the-context-window/SKILL.md'
          : null,
        subagentRouted: pi.observations.score.subagentRouted,
        childSession: pi.observations?.session?.childSession ?? null,
        summaryOk: pi.observations.score.summaryOk,
        keptVerifyOk: pi.observations.score.keptVerifyOk,
        verifyLine: pi.observations?.verifyOut?.line ?? null,
        productOk: pi.observations.score.productOk,
        verifiedDone: pi.observations.score.verifiedDone,
        modelAutoInvoke: pi.observations.score.modelAutoInvoke,
        contractHeld: pi.observations.score.contractHeld,
        ranVerifyScript: Boolean(pi.observations?.session?.ranVerifyScript),
        modelChrome: '(claude-subscription) claude-sonnet-5-5 • medium',
        oracleNote: pi.observations.score.contractHeld
          ? 'Leaf Read + subagent routing + GUARD-OK summary.'
          : `Honest gap: leaf=${pi.observations.score.leafSkillRead} subagent=${pi.observations.score.subagentRouted} verify=${pi.observations.score.keptVerifyOk} done=${pi.observations.score.verifiedDone}`,
      },
    },
    deltas: [
      {
        topic: 'leaf skill path',
        cursor: cursor.observations.score.leafSkillRead
          ? 'Read principle-guard-the-context-window/SKILL.md'
          : 'unobserved',
        pi: pi.observations.score.leafSkillRead
          ? 'Read principle-guard-the-context-window/SKILL.md'
          : 'unobserved',
        reconciled: cursor.observations.score.leafSkillRead === pi.observations.score.leafSkillRead,
      },
      {
        topic: 'subagent routing',
        cursor: String(cursor.observations.score.subagentRouted),
        pi: String(pi.observations.score.subagentRouted),
        reconciled: cursor.observations.score.subagentRouted === pi.observations.score.subagentRouted,
      },
      {
        topic: 'guard-context outcome',
        cursor: cursor.observations.score.contractHeld
          ? 'contractHeld. Leaf Read + subagent + GUARD-OK.'
          : 'contract not held',
        pi: pi.observations.score.contractHeld
          ? 'contractHeld. Leaf Read + subagent + GUARD-OK.'
          : 'contract not held',
        reconciled: cursor.observations.score.contractHeld === pi.observations.score.contractHeld,
      },
    ],
    provenance: {
      capturedWith: 'parity/scripts/capture-prin-guard-context.mjs --both',
      capturedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      brief: 'parity/briefs/u-journey-prin-guard-context.md',
    },
  };
  const pairPath = join(evidenceRoot, 'pair-prin-guard-context-1.json');
  await writeFile(pairPath, `${JSON.stringify(pair, null, 2)}\n`);
  return pairPath;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain && only === '--self-test') {
  await selfTest();
  process.exit(0);
}

if (isMain) {
  await snapshotBaseline();
  await ensureCorpus();
  const frontmatter = await readFrontmatterFiles();
  if (!frontmatter.cursor.ok || !frontmatter.pi.ok) {
    console.error(JSON.stringify({ error: 'guard-context frontmatter not ok', frontmatter }, null, 2));
    process.exit(1);
  }
  const preRule = await readFile(referenceRulePath, 'utf8');
  const preDigest = await sha256(referenceRulePath);
  if (preDigest !== LOCKED_FIXTURE_DIGEST) {
    console.error(
      `Reference rule digest ${preDigest} does not match the locked fixture ${LOCKED_FIXTURE_DIGEST}`,
    );
    process.exit(1);
  }

  const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
  const results = [];
  for (const side of sides) {
    const result = await runSide(side, preRule, preDigest, frontmatter);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await writeFile(
    join(evidenceRoot, 'capture-results.json'),
    `${JSON.stringify({ scenario: 'prin-guard-context', fixtureDigest: preDigest, frontmatter, results }, null, 2)}\n`,
  );
  const pairPath = await writePair(results, preDigest);
  console.log(
    JSON.stringify({
      scenario: 'prin-guard-context',
      fixtureDigest: preDigest,
      pairPath,
      results: results.map((r) => ({
        side: r.side,
        attemptId: r.attemptId,
        contractHeld: r.observations.score.contractHeld,
        leafSkillRead: r.observations.score.leafSkillRead,
        subagentRouted: r.observations.score.subagentRouted,
        keptVerifyOk: r.observations.score.keptVerifyOk,
      })),
    }),
  );
}
