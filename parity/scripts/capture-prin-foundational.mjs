#!/usr/bin/env node
// prin-foundational: /poteto-mode feature that needs a Job record shape plus
// exclusive claim on shared board state. Observe leaf Read of
// principle-foundational-thinking and shape/scaffold writes before board logic.
// Real PTY both sides.
//
// Evidence root: parity/evidence/principles/foundational/
// Usage: node scripts/capture-prin-foundational.mjs [--cursor-only|--pi-only|--both|--self-test]
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { sha256 } from '../recorder/files.mjs';
import { outputBytes, startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'principles', 'foundational');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const foundSkillCursor = join(
  root,
  'reference',
  'cursor-plugins',
  'pstack',
  'skills',
  'principle-foundational-thinking',
  'SKILL.md',
);
const foundSkillPi = join(
  root,
  '..',
  'extensions',
  'pi-pstack',
  'skills',
  'principle-foundational-thinking',
  'SKILL.md',
);
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;
const POLL_MS = 400;
const BOARD_REL = 'src/board.js';
const SHAPE_REL = ['src/types.js', 'src/model.js', 'src/job.js', 'src/shape.js', 'docs/shape.md'];
const NOTES_REL = 'NOTES.md';
const PRODUCT_WATCH = [BOARD_REL, NOTES_REL, ...SHAPE_REL];
const VERIFY_OUT_REL = 'evidence/verify-out.txt';
const VERIFY_SCRIPT_REL = 'scripts/verify.mjs';
const BASELINE_REL = [
  BOARD_REL,
  NOTES_REL,
  'README.md',
  'package.json',
  VERIFY_SCRIPT_REL,
  'evidence/.gitkeep',
  'out/.gitkeep',
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

function foundationalPrompt(side) {
  const out = donePath(side);
  return (
    `/poteto-mode Implement the in-process job board in this fixture. Jobs need a clear ` +
    `record shape (id, status pending|done, payload). Support enqueue, exclusive claim, and ` +
    `complete so two claimers never take the same pending job. Prefer defining the core job ` +
    `shape (for example in src/types.js) before filling in board logic. Run node scripts/verify.mjs ` +
    `until it prints BOARD-OK. ` +
    `For any poteto-mode principle you apply before declaring done, read that principle's ` +
    `leaf SKILL.md in full first (not only the poteto-mode Principles index). ` +
    `Work only inside this fixture cwd. Do not edit ledgers, parity/, or files outside ` +
    `this cwd except the named done path. ` +
    `When BOARD-OK is on disk, write exactly one line to ${out} as verified=yes|no, then stop.`
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
  if (!(await pathExists(path))) return null;
  const body = await readFile(path);
  return createHash('sha256').update(body).digest('hex');
}

export function parseFoundFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { ok: false, disableModelInvocation: null, name: null };
  const body = match[1];
  const name = (body.match(/^name:\s*(.+)$/m) || [])[1]?.trim() ?? null;
  const disableRaw = (body.match(/^disable-model-invocation:\s*(.+)$/m) || [])[1]?.trim() ?? null;
  const disableModelInvocation = disableRaw === 'true' ? true : disableRaw === 'false' ? false : null;
  return {
    ok: name === 'principle-foundational-thinking' && disableModelInvocation === true,
    name,
    disableModelInvocation,
  };
}

function isFoundSkillPath(p) {
  if (!p) return false;
  return /principle-foundational-thinking[/\\]SKILL\.md/i.test(String(p));
}

function isShapePath(p) {
  if (!p) return false;
  const s = String(p);
  return (
    /src[/\\](types|model|job|shape)\.js/i.test(s) ||
    /docs[/\\]shape\.md/i.test(s) ||
    /NOTES\.md/i.test(s)
  );
}

function isBoardPath(p) {
  if (!p) return false;
  return /src[/\\]board\.js/i.test(String(p));
}

function observeFoundText(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  const potetoMode =
    /\/poteto-mode\b/i.test(hay) ||
    /\[skill\]\s*poteto-mode/i.test(hay) ||
    /\bUsed poteto-mode\b/i.test(hay);
  const leafChrome = /principle-foundational-thinking[/\\]SKILL\.md/i.test(hay);
  const usedLeaf = /\bUsed principle-foundational-thinking\b/i.test(hay);
  const skillBracketLeaf = /\[skill\]\s*principle-foundational-thinking\b/i.test(hay);
  const hostAttached = Boolean(usedLeaf || skillBracketLeaf);
  const shapeMention =
    /\bsrc\/types\.js\b/i.test(hay) ||
    /\bJob\b/.test(hay) ||
    /\bstatus\b.*\bpending\b/i.test(hay) ||
    /\bdata shape\b/i.test(hay) ||
    /\bcore types?\b/i.test(hay) ||
    /\bscaffold\b/i.test(hay);
  const verifyMention =
    /scripts\/verify\.mjs/i.test(hay) ||
    /evidence\/verify-out\.txt/i.test(hay) ||
    /\bBOARD-OK\b/.test(hay) ||
    /\bBOARD-FAIL\b/.test(hay);
  const working = /[\u2800-\u28FF]/.test(hay) || /\bWorking\b/.test(hay);
  return { potetoMode, leafChrome, hostAttached, shapeMention, verifyMention, working };
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
    if (/principle-foundational-thinking[/\\]SKILL\.md/i.test(blob)) {
      calls.push({ ts, name: 'blob-mention', args: { path: 'principle-foundational-thinking/SKILL.md' } });
    }
  }
  return calls;
}

function pathFromArgs(args) {
  return (
    args.path ||
    args.file_path ||
    args.filePath ||
    args.target_file ||
    args.file ||
    null
  );
}

function isWriteLike(name, args) {
  if (/^(Write|write|write_file|WriteFile|StrReplace|str_replace|Edit|edit|ApplyPatch|apply_patch|search_replace|create_file)$/i.test(name)) {
    return true;
  }
  if (name === 'bash' || name === 'Shell' || name === 'shell') {
    const cmd = typeof args.command === 'string' ? args.command : '';
    return /\b(tee|cat\s*>|sed\s+-i|perl\s+-i|printf\s+.*>)\b/.test(cmd);
  }
  return false;
}

function notesLooksLikeShape(text) {
  if (!text) return false;
  return (
    /\bJob\b/.test(text) &&
    /\bstatus\b/i.test(text) &&
    /\bpending\b/i.test(text) &&
    (/\bpayload\b/i.test(text) || /\bid\b/i.test(text))
  );
}

export function scoreCallsForFoundational(calls) {
  let leafSkillRead = false;
  let leafSkillReadAt = null;
  let firstShapeWriteAt = null;
  let firstBoardWriteAt = null;
  let ranVerifyScript = false;
  const toolOrder = [];
  for (const call of calls) {
    const name = String(call.name || '');
    const args = call.args || {};
    const blob = JSON.stringify(args);
    const path = pathFromArgs(args);
    const cmd = typeof args.command === 'string' ? args.command : '';
    const isRead =
      /^(Read|read|read_file|ReadFile|cat|blob-mention)$/i.test(name) ||
      (name === 'bash' && /\bcat\b/.test(cmd));
    if (isRead && isFoundSkillPath(path || blob)) {
      leafSkillRead = true;
      if (!leafSkillReadAt) leafSkillReadAt = call.ts || new Date().toISOString();
      toolOrder.push(`${name}(found-leaf)`);
      continue;
    }
    const verifyHit =
      /\bscripts\/verify\.mjs\b/i.test(blob) ||
      (typeof args.command === 'string' && /verify\.mjs/.test(args.command));
    if (verifyHit) {
      ranVerifyScript = true;
      toolOrder.push(`${name}(verify.mjs)`);
      continue;
    }
    if (isWriteLike(name, args)) {
      const target = path || blob || cmd;
      if (isShapePath(target) && !isBoardPath(target)) {
        if (!firstShapeWriteAt) firstShapeWriteAt = call.ts || new Date().toISOString();
        toolOrder.push(`${name}(shape)`);
        continue;
      }
      if (isBoardPath(target)) {
        if (!firstBoardWriteAt) firstBoardWriteAt = call.ts || new Date().toISOString();
        toolOrder.push(`${name}(board)`);
        continue;
      }
    }
    if (name) toolOrder.push(name);
  }
  const shapeBeforeLogic =
    Boolean(firstShapeWriteAt) &&
    (!firstBoardWriteAt || String(firstShapeWriteAt) <= String(firstBoardWriteAt));
  return {
    leafSkillRead,
    leafSkillReadAt,
    firstShapeWriteAt,
    firstBoardWriteAt,
    shapeBeforeLogic,
    ranVerifyScript,
    toolOrder: toolOrder.slice(0, 80),
  };
}

export function analyzeProductSources({ boardSrc, typesSrc, modelSrc, jobSrc, notesSrc }) {
  const hasShapeModule = Boolean(typesSrc || modelSrc || jobSrc);
  const shapeExportsJob =
    /\b(?:Job|JOB_|STATUS|JobStatus)\b/.test(typesSrc || '') ||
    /\b(?:Job|JOB_|STATUS|JobStatus)\b/.test(modelSrc || '') ||
    /\b(?:Job|JOB_|STATUS|JobStatus)\b/.test(jobSrc || '');
  const boardImportsShape =
    /from\s+['"]\.\/(types|model|job|shape)\.js['"]/.test(boardSrc || '') ||
    /require\(\s*['"]\.\/(types|model|job|shape)\.js['"]\s*\)/.test(boardSrc || '');
  const boardStillStub = /throw new Error\(['"]not implemented['"]\)/.test(boardSrc || '');
  const notesShape = notesLooksLikeShape(notesSrc || '');
  return {
    hasShapeModule,
    shapeExportsJob,
    boardImportsShape,
    boardStillStub,
    notesShape,
    namedShapeArtifact: hasShapeModule || notesShape,
  };
}

export function scoreFoundational({
  frontmatter,
  done,
  verifyOut,
  productOk,
  productAnalysis,
  screenText,
  ptyText,
  sessionScore,
  transcriptScore,
  prompt,
  firstShapeAt,
  firstBoardAt,
}) {
  const screen = observeFoundText(screenText, { ignorePromptSlice: prompt });
  const pty = observeFoundText(ptyText, { ignorePromptSlice: prompt });
  const leafSkillRead = Boolean(
    sessionScore?.leafSkillRead ||
      transcriptScore?.leafSkillRead ||
      screen.leafChrome ||
      pty.leafChrome,
  );
  const usedChrome = Boolean(screen.hostAttached || pty.hostAttached || sessionScore?.hostAttached);
  const modelAutoInvoke = usedChrome && !leafSkillRead;
  const toolShapeBefore = Boolean(sessionScore?.shapeBeforeLogic || transcriptScore?.shapeBeforeLogic);
  const pollShapeBefore =
    Boolean(firstShapeAt) && (!firstBoardAt || String(firstShapeAt) <= String(firstBoardAt));
  const shapeBeforeLogic = toolShapeBefore || pollShapeBefore;
  const namedShapeArtifact = Boolean(productAnalysis?.namedShapeArtifact);
  const keptVerifyOk = Boolean(verifyOut?.ok);
  const verifiedDone = /^verified=yes\b/i.test((done?.line || '').trim());
  const frontmatterOk = Boolean(frontmatter?.ok);
  const contractHeld =
    frontmatterOk &&
    leafSkillRead &&
    shapeBeforeLogic &&
    namedShapeArtifact &&
    productOk &&
    keptVerifyOk &&
    verifiedDone &&
    !modelAutoInvoke;
  return {
    frontmatterOk,
    leafSkillRead,
    usedChrome,
    modelAutoInvoke,
    shapeBeforeLogic,
    namedShapeArtifact,
    keptVerifyOk,
    productOk: Boolean(productOk),
    verifiedDone,
    contractHeld,
    screen,
    pty,
  };
}

async function baselineWatches() {
  const map = {};
  for (const rel of PRODUCT_WATCH) {
    map[rel] = await fileDigest(join(fixtureApp, rel));
  }
  return map;
}

async function snapshotBaseline() {
  const baselineDir = join(evidenceRoot, 'fixture-baseline');
  for (const rel of BASELINE_REL) {
    const src = join(fixtureApp, rel);
    if (!(await pathExists(src))) continue;
    const dst = join(baselineDir, rel);
    await mkdir(dirname(dst), { recursive: true });
    await writeFile(dst, await readFile(src));
  }
}

async function restoreProduct() {
  const baselineDir = join(evidenceRoot, 'fixture-baseline');
  const files = await walkFiles(fixtureApp);
  for (const rel of files) {
    if (!BASELINE_REL.includes(rel)) {
      await rm(join(fixtureApp, rel), { force: true, recursive: true });
    }
  }
  for (const rel of BASELINE_REL) {
    const src = join(baselineDir, rel);
    const dst = join(fixtureApp, rel);
    if (await pathExists(src)) {
      await mkdir(dirname(dst), { recursive: true });
      await writeFile(dst, await readFile(src));
    }
  }
  await rm(join(fixtureApp, VERIFY_OUT_REL), { force: true });
  for (const rel of SHAPE_REL) {
    await rm(join(fixtureApp, rel), { force: true });
  }
  await rm(join(fixtureApp, 'docs'), { recursive: true, force: true });
  await rm(join(fixtureApp, '.audit'), { recursive: true, force: true });
}

async function readVerifyOut() {
  const path = join(fixtureApp, VERIFY_OUT_REL);
  if (!(await pathExists(path))) return { exists: false, path, line: null, ok: false };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line, ok: /^BOARD-OK\b/.test(line) };
}

async function independentProductOk() {
  try {
    const verifyPath = join(fixtureApp, VERIFY_SCRIPT_REL);
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, [verifyPath], { cwd: fixtureApp, encoding: 'utf8' });
    return r.status === 0 && /^BOARD-OK\b/m.test(`${r.stdout}\n${r.stderr}`);
  } catch {
    return false;
  }
}

async function readProductAnalysis() {
  const readMaybe = async (rel) => ((await pathExists(join(fixtureApp, rel))) ? readFile(join(fixtureApp, rel), 'utf8') : null);
  const boardSrc = await readMaybe(BOARD_REL);
  const typesSrc = await readMaybe('src/types.js');
  const modelSrc = await readMaybe('src/model.js');
  const jobSrc = await readMaybe('src/job.js');
  const notesSrc = await readMaybe(NOTES_REL);
  return {
    boardSrc,
    typesSrc,
    modelSrc,
    jobSrc,
    notesSrc,
    ...analyzeProductSources({ boardSrc, typesSrc, modelSrc, jobSrc, notesSrc }),
  };
}

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line };
}

async function readFrontmatterFiles() {
  const cursorText = await readFile(foundSkillCursor, 'utf8');
  const piText = await readFile(foundSkillPi, 'utf8');
  return {
    cursor: { path: foundSkillCursor, ...parseFoundFrontmatter(cursorText) },
    pi: { path: foundSkillPi, ...parseFoundFrontmatter(piText) },
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'prin-foundational',
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
  const backupPath = `${referenceRulePath}.prin-foundational-backup`;
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
      (/foundational|board|README|medium|Skill conflicts|Session TTL|fixture-app|job/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'foundational-fixture-app';
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
      else if (entry.isFile() && entry.name.endsWith('.jsonl') && abs.includes(needle)) {
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
  const text = await readFile(sessionPath, 'utf8');
  const calls = extractToolCallsFromJsonl(text);
  const scored = scoreCallsForFoundational(calls);
  const hostAttached =
    /\bUsed principle-foundational-thinking\b/i.test(text) ||
    /\[skill\]\s*principle-foundational-thinking\b/i.test(text);
  return { sessionPath, hostAttached, ...scored };
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
          (text.includes(`foundational/fixture-out/${side}/done.txt`) && text.includes('board'));
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
    const scored = scoreCallsForFoundational(extractToolCallsFromJsonl(text));
    const leafInBlob = /principle-foundational-thinking[/\\]SKILL\.md/i.test(text);
    const merged = {
      path: hit.path,
      ...scored,
      leafSkillRead: scored.leafSkillRead || leafInBlob,
    };
    const rank =
      (merged.leafSkillRead ? 4 : 0) +
      (merged.shapeBeforeLogic ? 2 : 0) +
      (merged.ranVerifyScript ? 1 : 0);
    const bestRank = best
      ? (best.leafSkillRead ? 4 : 0) + (best.shapeBeforeLogic ? 2 : 0) + (best.ranVerifyScript ? 1 : 0)
      : -1;
    if (!best || rank > bestRank || (rank === bestRank && hit.mtimeMs > (best.mtimeMs || 0))) {
      best = { ...merged, mtimeMs: hit.mtimeMs };
    }
  }
  return best;
}

async function pollOnce(baseline) {
  const now = new Date().toISOString();
  const hits = { shape: [], board: [], verify: [] };
  for (const rel of SHAPE_REL) {
    const dig = await fileDigest(join(fixtureApp, rel));
    if (dig && dig !== baseline[rel]) hits.shape.push(rel);
  }
  const notesDig = await fileDigest(join(fixtureApp, NOTES_REL));
  if (notesDig && notesDig !== baseline[NOTES_REL]) {
    const notesText = await readFile(join(fixtureApp, NOTES_REL), 'utf8');
    if (notesLooksLikeShape(notesText)) hits.shape.push(NOTES_REL);
  }
  const boardDig = await fileDigest(join(fixtureApp, BOARD_REL));
  if (boardDig && boardDig !== baseline[BOARD_REL]) hits.board.push(BOARD_REL);
  if (await pathExists(join(fixtureApp, VERIFY_OUT_REL))) hits.verify.push(VERIFY_OUT_REL);
  return { now, hits };
}

async function runSide(side, ruleBytes, ruleDigest, frontmatter) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.prin-foundational-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await snapshotBaseline();
  await restoreProduct();
  const baseline = await baselineWatches();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = foundationalPrompt(side);
  const pollLog = [];
  let firstShapeAt = null;
  let firstBoardAt = null;
  let firstVerifyAt = null;
  const shapePaths = new Set();
  const boardPaths = new Set();
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
        const snap = await pollOnce(baseline);
        for (const p of snap.hits.shape) {
          shapePaths.add(p);
          if (!firstShapeAt) firstShapeAt = snap.now;
        }
        for (const p of snap.hits.board) {
          boardPaths.add(p);
          if (!firstBoardAt) firstBoardAt = snap.now;
        }
        if (snap.hits.verify.length && !firstVerifyAt) firstVerifyAt = snap.now;
        if (snap.hits.shape.length || snap.hits.board.length || snap.hits.verify.length) {
          pollLog.push({
            ts: snap.now,
            shape: snap.hits.shape,
            board: snap.hits.board,
            verify: snap.hits.verify,
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
          'poteto-mode',
          'board.js',
          'types.js',
          'verify',
          'BOARD-OK',
          'BOARD-FAIL',
          'principle-foundational-thinking',
          'Phase',
          'Job',
          'enqueue',
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
      const obs = observeFoundText(lines.join('\n'), { ignorePromptSlice: prompt });
      const done = await readDone(side);
      const verify = await readVerifyOut();
      const enough = done.exists || (verify.ok && (shapePaths.size > 0 || boardPaths.size > 0));
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

    const finalSnap = await pollOnce(baseline);
    for (const p of finalSnap.hits.shape) {
      shapePaths.add(p);
      if (!firstShapeAt) firstShapeAt = finalSnap.now;
    }
    for (const p of finalSnap.hits.board) {
      boardPaths.add(p);
      if (!firstBoardAt) firstBoardAt = finalSnap.now;
    }
    if (finalSnap.hits.verify.length && !firstVerifyAt) firstVerifyAt = finalSnap.now;

    const ptyText = stripAnsi(outputBytes(attempt.events()).toString('utf8'));
    const screenText = (await screenLines(attempt, GEOMETRY)).join('\n');
    const done = await readDone(side);
    const verifyOut = await readVerifyOut();
    const productAnalysis = await readProductAnalysis();
    const productOk = await independentProductOk();

    let sessionScore = null;
    let transcriptScore = null;
    if (side === 'pi') {
      await sleep(500);
      sessionScore = await summarizePiSession(await findLatestPiSession());
    } else {
      transcriptScore = await summarizeCursorTranscripts(startedAt, side);
    }

    const score = scoreFoundational({
      frontmatter: frontmatter[side],
      done,
      verifyOut,
      productOk,
      productAnalysis,
      screenText,
      ptyText,
      sessionScore,
      transcriptScore,
      prompt,
      firstShapeAt,
      firstBoardAt,
    });

    const observations = {
      score,
      firstShapeAt,
      firstBoardAt,
      firstVerifyAt,
      shapePaths: [...shapePaths],
      boardPaths: [...boardPaths],
      done,
      verifyOut,
      productOk,
      productAnalysis: {
        hasShapeModule: productAnalysis.hasShapeModule,
        shapeExportsJob: productAnalysis.shapeExportsJob,
        boardImportsShape: productAnalysis.boardImportsShape,
        boardStillStub: productAnalysis.boardStillStub,
        notesShape: productAnalysis.notesShape,
        namedShapeArtifact: productAnalysis.namedShapeArtifact,
      },
      frontmatter: frontmatter[side],
      session: sessionScore,
      transcript: transcriptScore,
      pollSamples: pollLog.length,
      screenFinal: observeFoundText(screenText, { ignorePromptSlice: prompt }),
      pty: observeFoundText(ptyText, { ignorePromptSlice: prompt }),
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
    if (done.exists) {
      await writeFile(join(dir, 'done-copy.txt'), `${done.line}\n`);
    }

    const snapDir = join(attempt.dir, 'fixture-snapshot');
    await mkdir(snapDir, { recursive: true });
    const snapRels = [
      BOARD_REL,
      NOTES_REL,
      'README.md',
      'package.json',
      VERIFY_SCRIPT_REL,
      VERIFY_OUT_REL,
      ...SHAPE_REL,
    ];
    for (const rel of snapRels) {
      const abs = join(fixtureApp, rel);
      if (!(await pathExists(abs))) continue;
      const dest = join(snapDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, await readFile(abs));
    }

    const afterDir = join(dir, 'fixture-after');
    await mkdir(afterDir, { recursive: true });
    for (const rel of [BOARD_REL, ...SHAPE_REL, NOTES_REL, VERIFY_OUT_REL]) {
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
  const fm = { ok: true, name: 'principle-foundational-thinking', disableModelInvocation: true };
  const goodAnalysis = analyzeProductSources({
    boardSrc: "import { JobStatus } from './types.js';\nexport function enqueue(){}\n",
    typesSrc: 'export const JobStatus = { pending: "pending", done: "done" };\n',
    modelSrc: null,
    jobSrc: null,
    notesSrc: '# Notes\n',
  });
  const noShape = analyzeProductSources({
    boardSrc: 'export function enqueue(){ return 1 }\n',
    typesSrc: null,
    modelSrc: null,
    jobSrc: null,
    notesSrc: '# Notes\n',
  });
  const pass = scoreFoundational({
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: { exists: true, line: 'BOARD-OK jobs=2', ok: true },
    productOk: true,
    productAnalysis: goodAnalysis,
    screenText: 'BOARD-OK',
    ptyText: 'principle-foundational-thinking/SKILL.md\nBOARD-OK',
    sessionScore: {
      leafSkillRead: true,
      shapeBeforeLogic: true,
      hostAttached: true,
      ranVerifyScript: true,
    },
    transcriptScore: null,
    prompt: foundationalPrompt('cursor'),
    firstShapeAt: '2026-01-01T00:00:00.000Z',
    firstBoardAt: '2026-01-01T00:00:01.000Z',
  });
  const boardFirst = scoreFoundational({
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: { exists: true, line: 'BOARD-OK jobs=2', ok: true },
    productOk: true,
    productAnalysis: goodAnalysis,
    screenText: 'principle-foundational-thinking/SKILL.md BOARD-OK',
    ptyText: 'principle-foundational-thinking/SKILL.md BOARD-OK',
    sessionScore: { leafSkillRead: true, shapeBeforeLogic: false, ranVerifyScript: true },
    transcriptScore: null,
    prompt: foundationalPrompt('cursor'),
    firstShapeAt: '2026-01-01T00:00:02.000Z',
    firstBoardAt: '2026-01-01T00:00:01.000Z',
  });
  const noLeaf = scoreFoundational({
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: { exists: true, line: 'BOARD-OK jobs=2', ok: true },
    productOk: true,
    productAnalysis: goodAnalysis,
    screenText: 'BOARD-OK',
    ptyText: 'BOARD-OK',
    sessionScore: { leafSkillRead: false, shapeBeforeLogic: true },
    transcriptScore: { leafSkillRead: false },
    prompt: foundationalPrompt('cursor'),
    firstShapeAt: '2026-01-01T00:00:00.000Z',
    firstBoardAt: '2026-01-01T00:00:01.000Z',
  });
  const cases = [
    ['pass', pass.contractHeld === true && pass.shapeBeforeLogic === true],
    ['boardFirst', boardFirst.contractHeld === false && boardFirst.shapeBeforeLogic === false],
    ['noLeaf', noLeaf.contractHeld === false && noLeaf.leafSkillRead === false],
    ['goodAnalysis', goodAnalysis.namedShapeArtifact === true && goodAnalysis.boardImportsShape === true],
    ['noShape', noShape.namedShapeArtifact === false],
  ];
  const failed = cases.filter(([, ok]) => !ok);
  console.log(JSON.stringify({ selfTest: failed.length === 0, cases }, null, 2));
  if (failed.length) process.exit(1);
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain && only === '--self-test') {
  await selfTest();
  process.exit(0);
}

if (isMain) {
  await snapshotBaseline();
  const frontmatter = await readFrontmatterFiles();
  if (!frontmatter.cursor.ok || !frontmatter.pi.ok) {
    console.error(JSON.stringify({ error: 'foundational frontmatter not ok', frontmatter }, null, 2));
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
  await writeFile(
    join(evidenceRoot, 'capture-results.json'),
    `${JSON.stringify({ scenario: 'prin-foundational', fixtureDigest: preDigest, frontmatter, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      scenario: 'prin-foundational',
      fixtureDigest: preDigest,
      results: results.map((r) => ({
        side: r.side,
        attemptId: r.attemptId,
        contractHeld: r.observations.score.contractHeld,
        leafSkillRead: r.observations.score.leafSkillRead,
        shapeBeforeLogic: r.observations.score.shapeBeforeLogic,
        namedShapeArtifact: r.observations.score.namedShapeArtifact,
        productOk: r.observations.score.productOk,
      })),
    }),
  );
}
