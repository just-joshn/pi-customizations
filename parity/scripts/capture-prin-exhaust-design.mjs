#!/usr/bin/env node
// prin-exhaust-design: /poteto-mode novel picker with no precedent. Observe leaf Read of
// principle-exhaust-the-design-space and 2-3 competing prototypes before commit.
// Real PTY both sides.
//
// Evidence root: parity/evidence/principles/exhaust-design/
// Usage: node scripts/capture-prin-exhaust-design.mjs [--cursor-only|--pi-only|--both|--self-test]
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
const evidenceRoot = join(root, 'evidence', 'principles', 'exhaust-design');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const exhaustSkillCursor = join(
  root,
  'reference',
  'cursor-plugins',
  'pstack',
  'skills',
  'principle-exhaust-the-design-space',
  'SKILL.md',
);
const exhaustSkillPi = join(
  root,
  '..',
  'extensions',
  'pi-pstack',
  'skills',
  'principle-exhaust-the-design-space',
  'SKILL.md',
);
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;
const POLL_MS = 400;
const PRODUCT_REL = ['src/picker.js'];
const DOC_REL = ['README.md', 'NOTES.md', 'DECISION.md'];
const VERIFY_OUT_REL = 'evidence/verify-out.txt';
const VERIFY_SCRIPT_REL = 'scripts/verify.mjs';
const BASELINE_REL = [
  ...PRODUCT_REL,
  'README.md',
  'NOTES.md',
  'package.json',
  VERIFY_SCRIPT_REL,
  'evidence/.gitkeep',
  'prototypes/.gitkeep',
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

function exhaustPrompt(side) {
  const out = donePath(side);
  return (
    `/poteto-mode This fixture needs a next-action picker for incomplete relay jobs. ` +
    `There is no prior picker, menu, hotkey, or filter pattern in this repo. ` +
    `Ship pickNext(jobs) in src/picker.js so node scripts/verify.mjs prints EXHAUST-OK. ` +
    `Before committing one design, leave 2-3 competing sketches under prototypes/ ` +
    `(each with a distinct APPROACH: line) and a short DECISION.md that compares them ` +
    `and names the chosen approach with CHOSEN: <id>. A second flavor of the same shape ` +
    `does not count as a second approach. Keep verify output under evidence/. ` +
    `For any poteto-mode principle you apply before declaring done, read that principle's ` +
    `leaf SKILL.md in full first (not only the poteto-mode Principles index). ` +
    `Work only inside this fixture cwd. Do not edit ledgers, parity/, or files outside ` +
    `this cwd except the named done path. ` +
    `When EXHAUST-OK is on disk, write exactly one line to ${out} as verified=yes|no, then stop.`
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
      out.push(relative(base, abs).replace(/\\/g, '/'));
    }
  }
  return out;
}

async function fileDigest(path) {
  const body = await readFile(path);
  return createHash('sha256').update(body).digest('hex');
}

export function parseExhaustFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { ok: false, disableModelInvocation: null, name: null };
  const body = match[1];
  const name = (body.match(/^name:\s*(.+)$/m) || [])[1]?.trim() ?? null;
  const disableRaw = (body.match(/^disable-model-invocation:\s*(.+)$/m) || [])[1]?.trim() ?? null;
  const disableModelInvocation = disableRaw === 'true' ? true : disableRaw === 'false' ? false : null;
  return {
    ok: name === 'principle-exhaust-the-design-space' && disableModelInvocation === true,
    name,
    disableModelInvocation,
  };
}

function isExhaustSkillPath(p) {
  if (!p) return false;
  return /principle-exhaust-the-design-space[/\\]SKILL\.md/i.test(String(p));
}

function isPrototypeRel(rel) {
  if (!rel) return false;
  if (!rel.startsWith('prototypes/')) return false;
  if (rel === 'prototypes/.gitkeep') return false;
  return /\.(md|js|mjs|txt)$/i.test(rel);
}

function observeExhaustText(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  const potetoMode =
    /\/poteto-mode\b/i.test(hay) ||
    /\[skill\]\s*poteto-mode/i.test(hay) ||
    /\bUsed poteto-mode\b/i.test(hay);
  const leafChrome = /principle-exhaust-the-design-space[/\\]SKILL\.md/i.test(hay);
  const usedLeaf = /\bUsed principle-exhaust-the-design-space\b/i.test(hay);
  const skillBracketLeaf = /\[skill\]\s*principle-exhaust-the-design-space\b/i.test(hay);
  const hostAttached = Boolean(usedLeaf || skillBracketLeaf);
  const verifyMention =
    /scripts\/verify\.mjs/i.test(hay) ||
    /evidence\/verify-out\.txt/i.test(hay) ||
    /\bEXHAUST-OK\b/.test(hay) ||
    /\bEXHAUST-FAIL\b/.test(hay);
  const protoMention = /prototypes\//i.test(hay) || /\bAPPROACH:\b/i.test(hay) || /\bDECISION\.md\b/i.test(hay);
  const working = /[\u2800-\u28FF]/.test(hay) || /\bWorking\b/.test(hay);
  return { potetoMode, leafChrome, hostAttached, verifyMention, protoMention, working };
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
    if (/principle-exhaust-the-design-space[/\\]SKILL\.md/i.test(blob)) {
      calls.push({
        ts,
        name: 'blob-mention',
        args: { path: 'principle-exhaust-the-design-space/SKILL.md' },
      });
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
  if (/^(Write|write|write_file|WriteFile|StrReplace|str_replace|Edit|edit|ApplyPatch|apply_patch)$/i.test(name)) {
    return true;
  }
  if (name === 'bash' || name === 'Shell') {
    const cmd = typeof args.command === 'string' ? args.command : '';
    return /\b(tee|cat\s*>|sed\s+-i|perl\s+-i)\b/.test(cmd);
  }
  return false;
}

function scoreCallsForExhaust(calls) {
  let leafSkillRead = false;
  let leafSkillReadAt = null;
  let ranVerifyScript = false;
  let firstVerifyAt = null;
  let firstProtoWriteAt = null;
  let firstProductWriteAt = null;
  let wroteDecision = false;
  const toolOrder = [];
  for (const call of calls) {
    const name = String(call.name || '');
    const args = call.args || {};
    const blob = JSON.stringify(args);
    const path = pathFromArgs(args);
    const isRead =
      /^(Read|read|read_file|ReadFile|cat|blob-mention)$/i.test(name) ||
      (name === 'bash' && typeof args.command === 'string' && /\bcat\b/.test(args.command));
    if (isRead && isExhaustSkillPath(path || blob)) {
      leafSkillRead = true;
      if (!leafSkillReadAt) leafSkillReadAt = call.ts || new Date().toISOString();
      toolOrder.push(`${name}(exhaust-leaf)`);
      continue;
    }
    const verifyHit =
      /\bscripts\/verify\.mjs\b/i.test(blob) ||
      (typeof args.command === 'string' && /verify\.mjs/.test(args.command));
    if (verifyHit) {
      ranVerifyScript = true;
      if (!firstVerifyAt) firstVerifyAt = call.ts || new Date().toISOString();
      toolOrder.push(`${name}(verify.mjs)`);
      continue;
    }
    const pathStr = String(path || '');
    if (isWriteLike(name, args)) {
      if (/prototypes\//i.test(pathStr) || /prototypes\//i.test(blob)) {
        if (!firstProtoWriteAt) firstProtoWriteAt = call.ts || new Date().toISOString();
        toolOrder.push(`${name}(prototype)`);
        continue;
      }
      if (/DECISION\.md/i.test(pathStr) || /DECISION\.md/i.test(blob)) {
        wroteDecision = true;
        toolOrder.push(`${name}(decision)`);
        continue;
      }
      if (/src[/\\]picker\.js/i.test(pathStr) || /src[/\\]picker\.js/i.test(blob)) {
        if (!firstProductWriteAt) firstProductWriteAt = call.ts || new Date().toISOString();
        toolOrder.push(`${name}(product)`);
        continue;
      }
    }
    if (name) toolOrder.push(name);
  }
  return {
    leafSkillRead,
    leafSkillReadAt,
    ranVerifyScript,
    firstVerifyAt,
    firstProtoWriteAt,
    firstProductWriteAt,
    wroteDecision,
    toolOrder: toolOrder.slice(0, 80),
  };
}

export async function listPrototypeArtifacts(base = fixtureApp) {
  const files = await walkFiles(base);
  return files.filter(isPrototypeRel);
}

export function analyzePrototypes(protoBodies) {
  const approaches = [];
  for (const { rel, body } of protoBodies) {
    const match = (body || '').match(/^\s*APPROACH:\s*(\S+)/im);
    const id = match
      ? match[1]
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
      : null;
    approaches.push({ rel, id });
  }
  const ids = approaches.map((a) => a.id).filter(Boolean);
  const unique = new Set(ids);
  return {
    count: protoBodies.length,
    approaches,
    distinctApproaches: unique.size,
    okCount: protoBodies.length >= 2 && protoBodies.length <= 3,
    okDistinct: unique.size >= 2 && unique.size === ids.length,
  };
}

export function scoreExhaustDesign({
  frontmatter,
  done,
  verifyOut,
  productOk,
  prototypeArtifacts,
  prototypeAnalysis,
  decisionExists,
  screenText,
  ptyText,
  sessionScore,
  transcriptScore,
  prompt,
  firstProtoAt,
  firstProductAt,
}) {
  const screen = observeExhaustText(screenText, { ignorePromptSlice: prompt });
  const pty = observeExhaustText(ptyText, { ignorePromptSlice: prompt });
  const leafSkillRead = Boolean(
    sessionScore?.leafSkillRead ||
      transcriptScore?.leafSkillRead ||
      screen.leafChrome ||
      pty.leafChrome,
  );
  const usedChrome = Boolean(screen.hostAttached || pty.hostAttached || sessionScore?.hostAttached);
  const modelAutoInvoke = usedChrome && !leafSkillRead;
  const ranVerifyScript = Boolean(
    sessionScore?.ranVerifyScript ||
      transcriptScore?.ranVerifyScript ||
      screen.verifyMention ||
      pty.verifyMention,
  );
  const prototypesPresent = Boolean(
    (prototypeArtifacts?.length || 0) >= 2 &&
      prototypeAnalysis?.okCount &&
      prototypeAnalysis?.okDistinct,
  );
  const prototypesBeforeProduct = Boolean(
    firstProtoAt && firstProductAt && Date.parse(firstProtoAt) <= Date.parse(firstProductAt),
  );
  const exhaustOk = Boolean(verifyOut?.ok);
  const verifiedDone = /^verified=yes\b/i.test((done?.line || '').trim());
  const frontmatterOk = Boolean(frontmatter?.ok);
  const contractHeld =
    frontmatterOk &&
    leafSkillRead &&
    ranVerifyScript &&
    exhaustOk &&
    productOk &&
    prototypesPresent &&
    decisionExists &&
    verifiedDone &&
    !modelAutoInvoke;
  return {
    frontmatterOk,
    leafSkillRead,
    usedChrome,
    modelAutoInvoke,
    ranVerifyScript,
    exhaustOk,
    productOk: Boolean(productOk),
    prototypesPresent,
    prototypesBeforeProduct,
    decisionExists: Boolean(decisionExists),
    verifiedDone,
    contractHeld,
    screen,
    pty,
  };
}

async function baselineProduct() {
  const map = {};
  for (const rel of PRODUCT_REL) {
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
  for (const rel of BASELINE_REL) {
    const src = join(baselineDir, rel);
    const dst = join(fixtureApp, rel);
    if (await pathExists(src)) {
      await mkdir(dirname(dst), { recursive: true });
      await writeFile(dst, await readFile(src));
    }
  }
  await rm(join(fixtureApp, VERIFY_OUT_REL), { force: true });
  await rm(join(fixtureApp, 'DECISION.md'), { force: true });
  const files = await walkFiles(fixtureApp);
  for (const rel of files) {
    if (BASELINE_REL.includes(rel)) continue;
    if (isPrototypeRel(rel) || rel === 'DECISION.md' || rel.startsWith('evidence/') || rel.startsWith('out/') || rel.startsWith('.audit/')) {
      await rm(join(fixtureApp, rel), { force: true, recursive: true });
    }
  }
  await mkdir(join(fixtureApp, 'prototypes'), { recursive: true });
  await writeFile(join(fixtureApp, 'prototypes/.gitkeep'), '');
  await mkdir(join(fixtureApp, 'evidence'), { recursive: true });
  await writeFile(join(fixtureApp, 'evidence/.gitkeep'), '');
}

async function readVerifyOut() {
  const path = join(fixtureApp, VERIFY_OUT_REL);
  if (!(await pathExists(path))) return { exists: false, path, line: null, ok: false };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line, ok: /^EXHAUST-OK\b/i.test(line) };
}

async function independentProductOk() {
  try {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, [join(fixtureApp, VERIFY_SCRIPT_REL)], {
      cwd: fixtureApp,
      encoding: 'utf8',
      env: { ...process.env },
    });
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
    return r.status === 0 && /EXHAUST-OK\b/i.test(out);
  } catch {
    return false;
  }
}

async function readPrototypeBodies() {
  const rels = await listPrototypeArtifacts();
  const bodies = [];
  for (const rel of rels) {
    bodies.push({ rel, body: await readFile(join(fixtureApp, rel), 'utf8') });
  }
  return bodies;
}

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line };
}

async function readFrontmatterFiles() {
  const cursorText = await readFile(exhaustSkillCursor, 'utf8');
  const piText = await readFile(exhaustSkillPi, 'utf8');
  return {
    cursor: { path: exhaustSkillCursor, ...parseExhaustFrontmatter(cursorText) },
    pi: { path: exhaustSkillPi, ...parseExhaustFrontmatter(piText) },
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'prin-exhaust-design',
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
  const backupPath = `${referenceRulePath}.prin-exhaust-design-backup`;
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
      (/exhaust|picker|README|medium|Skill conflicts|Session TTL|fixture-app/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'exhaust-design-fixture-app';
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
  const scored = scoreCallsForExhaust(calls);
  const hostAttached =
    /\bUsed principle-exhaust-the-design-space\b/i.test(text) ||
    /\[skill\]\s*principle-exhaust-the-design-space\b/i.test(text);
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
          (text.includes(`exhaust-design/fixture-out/${side}/done.txt`) && text.includes('picker'));
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
    const scored = scoreCallsForExhaust(extractToolCallsFromJsonl(text));
    const leafInBlob = /principle-exhaust-the-design-space[/\\]SKILL\.md/i.test(text);
    const merged = {
      path: hit.path,
      ...scored,
      leafSkillRead: scored.leafSkillRead || leafInBlob,
    };
    const rank = (merged.leafSkillRead ? 4 : 0) + (merged.ranVerifyScript ? 2 : 0);
    const bestRank = best ? (best.leafSkillRead ? 4 : 0) + (best.ranVerifyScript ? 2 : 0) : -1;
    if (!best || rank > bestRank || (rank === bestRank && hit.mtimeMs > (best.mtimeMs || 0))) {
      best = { ...merged, mtimeMs: hit.mtimeMs };
    }
  }
  return best;
}

async function pollOnce(baseline) {
  const now = new Date().toISOString();
  const hits = { product: [], verify: [], prototypes: [], decision: [] };
  for (const rel of PRODUCT_REL) {
    const dig = await fileDigest(join(fixtureApp, rel));
    if (dig !== baseline[rel]) hits.product.push(rel);
  }
  if (await pathExists(join(fixtureApp, VERIFY_OUT_REL))) hits.verify.push(VERIFY_OUT_REL);
  if (await pathExists(join(fixtureApp, 'DECISION.md'))) hits.decision.push('DECISION.md');
  for (const rel of await listPrototypeArtifacts()) hits.prototypes.push(rel);
  return { now, hits };
}

async function runSide(side, ruleBytes, ruleDigest, frontmatter) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.prin-exhaust-design-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await snapshotBaseline();
  await restoreProduct();
  const baseline = await baselineProduct();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = exhaustPrompt(side);
  const pollLog = [];
  let firstProductAt = null;
  let firstVerifyAt = null;
  let firstProtoAt = null;
  let firstDecisionAt = null;
  const productPaths = new Set();
  const prototypePaths = new Set();
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
        for (const p of snap.hits.product) {
          productPaths.add(p);
          if (!firstProductAt) firstProductAt = snap.now;
        }
        for (const p of snap.hits.prototypes) {
          prototypePaths.add(p);
          if (!firstProtoAt) firstProtoAt = snap.now;
        }
        if (snap.hits.decision.length && !firstDecisionAt) firstDecisionAt = snap.now;
        if (snap.hits.verify.length && !firstVerifyAt) firstVerifyAt = snap.now;
        if (
          snap.hits.product.length ||
          snap.hits.verify.length ||
          snap.hits.prototypes.length ||
          snap.hits.decision.length
        ) {
          pollLog.push({
            ts: snap.now,
            product: snap.hits.product,
            verify: snap.hits.verify,
            prototypes: snap.hits.prototypes,
            decision: snap.hits.decision,
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
          'picker',
          'verify',
          'EXHAUST-OK',
          'EXHAUST-FAIL',
          'principle-exhaust-the-design-space',
          'prototypes',
          'APPROACH',
          'DECISION',
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
      const obs = observeExhaustText(lines.join('\n'), { ignorePromptSlice: prompt });
      const done = await readDone(side);
      const verify = await readVerifyOut();
      for (const p of await listPrototypeArtifacts()) prototypePaths.add(p);
      const enough =
        done.exists ||
        (verify.ok && productPaths.size > 0 && prototypePaths.size >= 2 && (await pathExists(join(fixtureApp, 'DECISION.md'))));
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
    for (const p of finalSnap.hits.product) {
      productPaths.add(p);
      if (!firstProductAt) firstProductAt = finalSnap.now;
    }
    for (const p of finalSnap.hits.prototypes) {
      prototypePaths.add(p);
      if (!firstProtoAt) firstProtoAt = finalSnap.now;
    }
    if (finalSnap.hits.decision.length && !firstDecisionAt) firstDecisionAt = finalSnap.now;
    if (finalSnap.hits.verify.length && !firstVerifyAt) firstVerifyAt = finalSnap.now;

    const ptyText = stripAnsi(outputBytes(attempt.events()).toString('utf8'));
    const screenText = (await screenLines(attempt, GEOMETRY)).join('\n');
    const done = await readDone(side);
    const verifyOut = await readVerifyOut();
    const productOk = await independentProductOk();
    const protoBodies = await readPrototypeBodies();
    const prototypeAnalysis = analyzePrototypes(protoBodies);
    const decisionExists = await pathExists(join(fixtureApp, 'DECISION.md'));

    let sessionScore = null;
    let transcriptScore = null;
    if (side === 'pi') {
      await sleep(500);
      sessionScore = await summarizePiSession(await findLatestPiSession());
    } else {
      transcriptScore = await summarizeCursorTranscripts(startedAt, side);
    }

    const score = scoreExhaustDesign({
      frontmatter: frontmatter[side],
      done,
      verifyOut,
      productOk,
      prototypeArtifacts: [...prototypePaths],
      prototypeAnalysis,
      decisionExists,
      screenText,
      ptyText,
      sessionScore,
      transcriptScore,
      prompt,
      firstProtoAt,
      firstProductAt,
    });

    const observations = {
      score,
      firstProductAt,
      firstVerifyAt,
      firstProtoAt,
      firstDecisionAt,
      productPaths: [...productPaths],
      prototypeArtifacts: [...prototypePaths],
      prototypeAnalysis,
      done,
      verifyOut,
      productOk,
      decisionExists,
      frontmatter: frontmatter[side],
      session: sessionScore,
      transcript: transcriptScore,
      pollSamples: pollLog.length,
      screenFinal: observeExhaustText(screenText, { ignorePromptSlice: prompt }),
      pty: observeExhaustText(ptyText, { ignorePromptSlice: prompt }),
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
    const snapRels = [...BASELINE_REL, 'DECISION.md', VERIFY_OUT_REL, ...prototypePaths];
    for (const rel of [...new Set(snapRels)]) {
      const abs = join(fixtureApp, rel);
      if (!(await pathExists(abs))) continue;
      const dest = join(snapDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, await readFile(abs));
    }

    const afterDir = join(dir, 'fixture-after');
    await mkdir(afterDir, { recursive: true });
    for (const rel of [...PRODUCT_REL, ...DOC_REL, VERIFY_OUT_REL, ...prototypePaths]) {
      const abs = join(fixtureApp, rel);
      if (!(await pathExists(abs))) continue;
      const dest = join(afterDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, await readFile(abs));
      if (isPrototypeRel(rel) || rel === 'DECISION.md') {
        const durable = join(writeRootFor(side), rel);
        await mkdir(dirname(durable), { recursive: true });
        await writeFile(durable, await readFile(abs));
      }
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
  const fm = { ok: true, name: 'principle-exhaust-the-design-space', disableModelInvocation: true };
  const goodAnalysis = analyzePrototypes([
    { rel: 'prototypes/a.md', body: 'APPROACH: stdout-menu\nnumbered list' },
    { rel: 'prototypes/b.md', body: 'APPROACH: hotkey\nsingle key' },
    { rel: 'prototypes/c.md', body: 'APPROACH: fuzzy-filter\ntype to narrow' },
  ]);
  const sameShape = analyzePrototypes([
    { rel: 'prototypes/a.md', body: 'APPROACH: menu-numbered\nx' },
    { rel: 'prototypes/b.md', body: 'APPROACH: menu-lettered\ny' },
  ]);
  const pass = scoreExhaustDesign({
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: { exists: true, line: 'EXHAUST-OK prototypes=3 chosen=hotkey', ok: true },
    productOk: true,
    prototypeArtifacts: ['prototypes/a.md', 'prototypes/b.md', 'prototypes/c.md'],
    prototypeAnalysis: goodAnalysis,
    decisionExists: true,
    screenText: 'principle-exhaust-the-design-space/SKILL.md EXHAUST-OK',
    ptyText: 'Used principle-exhaust-the-design-space\nprinciple-exhaust-the-design-space/SKILL.md',
    sessionScore: { leafSkillRead: true, ranVerifyScript: true, hostAttached: true },
    transcriptScore: null,
    prompt: exhaustPrompt('cursor'),
    firstProtoAt: '2026-01-01T00:00:00.000Z',
    firstProductAt: '2026-01-01T00:01:00.000Z',
  });
  const noLeaf = scoreExhaustDesign({
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: { exists: true, line: 'EXHAUST-OK prototypes=2 chosen=hotkey', ok: true },
    productOk: true,
    prototypeArtifacts: ['prototypes/a.md', 'prototypes/b.md'],
    prototypeAnalysis: analyzePrototypes([
      { rel: 'prototypes/a.md', body: 'APPROACH: stdout-menu\n' },
      { rel: 'prototypes/b.md', body: 'APPROACH: hotkey\n' },
    ]),
    decisionExists: true,
    screenText: 'EXHAUST-OK',
    ptyText: 'EXHAUST-OK',
    sessionScore: { leafSkillRead: false, ranVerifyScript: true },
    transcriptScore: { leafSkillRead: false },
    prompt: exhaustPrompt('cursor'),
    firstProtoAt: '2026-01-01T00:00:00.000Z',
    firstProductAt: '2026-01-01T00:01:00.000Z',
  });
  const noProto = scoreExhaustDesign({
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: { exists: true, line: 'EXHAUST-FAIL', ok: false },
    productOk: false,
    prototypeArtifacts: [],
    prototypeAnalysis: analyzePrototypes([]),
    decisionExists: false,
    screenText: 'principle-exhaust-the-design-space/SKILL.md',
    ptyText: 'principle-exhaust-the-design-space/SKILL.md',
    sessionScore: { leafSkillRead: true, ranVerifyScript: true },
    transcriptScore: null,
    prompt: exhaustPrompt('cursor'),
    firstProtoAt: null,
    firstProductAt: '2026-01-01T00:01:00.000Z',
  });
  const cases = [
    ['pass', pass.contractHeld === true && pass.prototypesPresent === true && pass.prototypesBeforeProduct === true],
    ['noLeaf', noLeaf.contractHeld === false && noLeaf.leafSkillRead === false],
    ['noProto', noProto.contractHeld === false && noProto.prototypesPresent === false],
    ['goodAnalysis', goodAnalysis.okCount && goodAnalysis.okDistinct && goodAnalysis.distinctApproaches === 3],
    ['sameShapeTags', sameShape.okDistinct === true && sameShape.distinctApproaches === 2],
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
    console.error(JSON.stringify({ error: 'exhaust-design frontmatter not ok', frontmatter }, null, 2));
    process.exit(1);
  }
  const preRule = await readFile(referenceRulePath, 'utf8');
  const preDigest = await sha256(referenceRulePath);
  if (preDigest !== LOCKED_FIXTURE_DIGEST) {
    console.error(`Reference rule digest ${preDigest} does not match the locked fixture ${LOCKED_FIXTURE_DIGEST}`);
    process.exit(1);
  }

  const { spawnSync } = await import('node:child_process');
  const pre = spawnSync(process.execPath, [join(fixtureApp, VERIFY_SCRIPT_REL)], {
    cwd: fixtureApp,
    encoding: 'utf8',
  });
  if (pre.status === 0 || !/EXHAUST-FAIL/.test(pre.stdout || '')) {
    console.error('Expected baseline fixture to fail verify with EXHAUST-FAIL');
    process.exit(1);
  }
  await rm(join(fixtureApp, VERIFY_OUT_REL), { force: true });

  const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
  const results = [];
  for (const side of sides) {
    const result = await runSide(side, preRule, preDigest, frontmatter);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await writeFile(
    join(evidenceRoot, 'capture-results.json'),
    `${JSON.stringify({ scenario: 'prin-exhaust-design', fixtureDigest: preDigest, frontmatter, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      scenario: 'prin-exhaust-design',
      fixtureDigest: preDigest,
      results: results.map((r) => ({
        side: r.side,
        attemptId: r.attemptId,
        contractHeld: r.observations.score.contractHeld,
        leafSkillRead: r.observations.score.leafSkillRead,
        prototypesPresent: r.observations.score.prototypesPresent,
        exhaustOk: r.observations.score.exhaustOk,
        productOk: r.observations.score.productOk,
      })),
    }),
  );
}
