#!/usr/bin/env node
// prin-subtract-first: /poteto-mode add shout capability with seeded dead weight.
// Observe leaf Read of principle-subtract-before-you-add, delete dead modules
// first, then build shout on the simpler base. Real PTY both sides.
//
// Evidence root: parity/evidence/principles/subtract-first/
// Usage: node scripts/capture-prin-subtract-first.mjs [--cursor-only|--pi-only|--both|--self-test]
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
const evidenceRoot = join(root, 'evidence', 'principles', 'subtract-first');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const subSkillCursor = join(
  root,
  'reference',
  'cursor-plugins',
  'pstack',
  'skills',
  'principle-subtract-before-you-add',
  'SKILL.md',
);
const subSkillPi = join(
  root,
  '..',
  'extensions',
  'pi-pstack',
  'skills',
  'principle-subtract-before-you-add',
  'SKILL.md',
);
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;
const POLL_MS = 400;
const PRODUCT_REL = ['src/greet.js', 'src/core.js', 'src/legacyValidate.js', 'src/stubRefs.js'];
const DEAD_REL = ['src/legacyValidate.js', 'src/stubRefs.js'];
const VERIFY_OUT_REL = 'evidence/verify-out.txt';
const VERIFY_SCRIPT_REL = 'scripts/verify.mjs';
const BASELINE_REL = [
  'src/greet.js',
  'src/core.js',
  'src/legacyValidate.js',
  'src/stubRefs.js',
  'README.md',
  'NOTES.md',
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

function subtractPrompt(side) {
  const out = donePath(side);
  return (
    `/poteto-mode Add shout support so greet({ shout: true }) returns HELLO, WORLD ` +
    `while greet() keeps returning hello, world. node scripts/verify.mjs currently fails. ` +
    `NOTES.md describes leftover dead modules and some possible approaches. ` +
    `For any poteto-mode principle you apply before declaring done, read that principle's ` +
    `leaf SKILL.md in full first (not only the poteto-mode Principles index). ` +
    `Work only inside this fixture cwd. Do not edit ledgers, parity/, or files outside ` +
    `this cwd except the named done path. ` +
    `When SUBTRACT-OK is on disk, write exactly one line to ${out} as verified=yes|no, then stop.`
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

export function parseSubtractFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { ok: false, disableModelInvocation: null, name: null };
  const body = match[1];
  const name = (body.match(/^name:\s*(.+)$/m) || [])[1]?.trim() ?? null;
  const disableRaw = (body.match(/^disable-model-invocation:\s*(.+)$/m) || [])[1]?.trim() ?? null;
  const disableModelInvocation = disableRaw === 'true' ? true : disableRaw === 'false' ? false : null;
  return {
    ok: name === 'principle-subtract-before-you-add' && disableModelInvocation === true,
    name,
    disableModelInvocation,
  };
}

function isSubtractSkillPath(p) {
  if (!p) return false;
  return /principle-subtract-before-you-add[/\\]SKILL\.md/i.test(String(p));
}

function isDeadPath(p) {
  if (!p) return false;
  const s = String(p);
  return /src[/\\](legacyValidate|stubRefs)\.js/i.test(s);
}

function isCapabilityPath(p) {
  if (!p) return false;
  const s = String(p);
  return /src[/\\]greet\.js/i.test(s);
}

function observeSubtractText(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  const potetoMode =
    /\/poteto-mode\b/i.test(hay) ||
    /\[skill\]\s*poteto-mode/i.test(hay) ||
    /\bUsed poteto-mode\b/i.test(hay);
  const leafChrome = /principle-subtract-before-you-add[/\\]SKILL\.md/i.test(hay);
  const usedLeaf = /\bUsed principle-subtract-before-you-add\b/i.test(hay);
  const skillBracketLeaf = /\[skill\]\s*principle-subtract-before-you-add\b/i.test(hay);
  const hostAttached = Boolean(usedLeaf || skillBracketLeaf);
  const verifyMention =
    /scripts\/verify\.mjs/i.test(hay) ||
    /evidence\/verify-out\.txt/i.test(hay) ||
    /\bSUBTRACT-OK\b/.test(hay) ||
    /\bSUBTRACT-FAIL\b/.test(hay);
  const working = /[\u2800-\u28FF]/.test(hay) || /\bWorking\b/.test(hay);
  return { potetoMode, leafChrome, hostAttached, verifyMention, working };
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
    if (/principle-subtract-before-you-add[/\\]SKILL\.md/i.test(blob)) {
      calls.push({ ts, name: 'blob-mention', args: { path: 'principle-subtract-before-you-add/SKILL.md' } });
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
    return /\b(tee|cat\s*>|sed\s+-i|perl\s+-i)\b/.test(cmd) && /src\/greet\.js/.test(cmd);
  }
  return false;
}

function isDeleteLike(name, args) {
  if (/^(Delete|delete|delete_file|DeleteFile|rm|Remove)$/i.test(name)) return true;
  if (name === 'bash' || name === 'Shell') {
    const cmd = typeof args.command === 'string' ? args.command : '';
    return /\brm\b/.test(cmd) && /legacyValidate|stubRefs/.test(cmd);
  }
  return false;
}

function scoreCallsForSubtract(calls) {
  let leafSkillRead = false;
  let leafSkillReadAt = null;
  let ranVerifyScript = false;
  let firstDeadDeleteAt = null;
  let firstCapabilityWriteAt = null;
  const toolOrder = [];
  for (const call of calls) {
    const name = String(call.name || '');
    const args = call.args || {};
    const blob = JSON.stringify(args);
    const path = pathFromArgs(args);
    const isRead =
      /^(Read|read|read_file|ReadFile|cat|blob-mention)$/i.test(name) ||
      (name === 'bash' && typeof args.command === 'string' && /\bcat\b/.test(args.command));
    if (isRead && isSubtractSkillPath(path || blob)) {
      leafSkillRead = true;
      if (!leafSkillReadAt) leafSkillReadAt = call.ts || new Date().toISOString();
      toolOrder.push(`${name}(subtract-leaf)`);
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
    if (isDeleteLike(name, args) && (isDeadPath(path) || isDeadPath(blob))) {
      if (!firstDeadDeleteAt) firstDeadDeleteAt = call.ts || new Date().toISOString();
      toolOrder.push(`${name}(dead-delete)`);
      continue;
    }
    if (isWriteLike(name, args) && (isCapabilityPath(path) || isCapabilityPath(blob))) {
      if (!firstCapabilityWriteAt) firstCapabilityWriteAt = call.ts || new Date().toISOString();
      toolOrder.push(`${name}(capability)`);
      continue;
    }
    if (name) toolOrder.push(name);
  }
  const removedBeforeAdd =
    Boolean(firstDeadDeleteAt) &&
    Boolean(firstCapabilityWriteAt) &&
    String(firstDeadDeleteAt) <= String(firstCapabilityWriteAt);
  return {
    leafSkillRead,
    leafSkillReadAt,
    ranVerifyScript,
    firstDeadDeleteAt,
    firstCapabilityWriteAt,
    removedBeforeAdd,
    toolOrder: toolOrder.slice(0, 80),
  };
}

export function scoreSubtractFirst({
  frontmatter,
  done,
  verifyOut,
  productOk,
  deadWeightGone,
  capabilityAdded,
  removedBeforeAdd,
  speculativeKept,
  screenText,
  ptyText,
  sessionScore,
  transcriptScore,
  prompt,
  firstDeletedAt,
  firstCapabilityAt,
}) {
  const screen = observeSubtractText(screenText, { ignorePromptSlice: prompt });
  const pty = observeSubtractText(ptyText, { ignorePromptSlice: prompt });
  const leafSkillRead = Boolean(
    sessionScore?.leafSkillRead ||
      transcriptScore?.leafSkillRead ||
      screen.leafChrome ||
      pty.leafChrome,
  );
  const usedChrome = Boolean(screen.hostAttached || pty.hostAttached || sessionScore?.hostAttached);
  const modelAutoInvoke = usedChrome && !leafSkillRead;
  const toolOrderOk = Boolean(sessionScore?.removedBeforeAdd || transcriptScore?.removedBeforeAdd);
  const pollOrderOk =
    Boolean(firstDeletedAt) &&
    Boolean(firstCapabilityAt) &&
    String(firstDeletedAt) <= String(firstCapabilityAt);
  const orderOk = Boolean(removedBeforeAdd) || toolOrderOk || pollOrderOk;
  const keptVerifyOk = Boolean(verifyOut?.ok);
  const verifiedDone = /^verified=yes\b/i.test((done?.line || '').trim());
  const frontmatterOk = Boolean(frontmatter?.ok);
  const contractHeld =
    frontmatterOk &&
    leafSkillRead &&
    Boolean(deadWeightGone) &&
    Boolean(capabilityAdded) &&
    orderOk &&
    !speculativeKept &&
    productOk &&
    keptVerifyOk &&
    verifiedDone &&
    !modelAutoInvoke;
  return {
    frontmatterOk,
    leafSkillRead,
    usedChrome,
    modelAutoInvoke,
    deadWeightGone: Boolean(deadWeightGone),
    capabilityAdded: Boolean(capabilityAdded),
    removedBeforeAdd: orderOk,
    speculativeKept: Boolean(speculativeKept),
    keptVerifyOk,
    productOk: Boolean(productOk),
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
  const keep = new Set(BASELINE_REL);
  const files = await walkFiles(fixtureApp);
  for (const rel of files) {
    if (keep.has(rel)) continue;
    if (
      rel.startsWith('src/') ||
      rel.startsWith('evidence/') ||
      rel.startsWith('out/') ||
      rel.endsWith('.tsv') ||
      rel.startsWith('.audit/')
    ) {
      await rm(join(fixtureApp, rel), { force: true, recursive: true });
    }
  }
}

async function readVerifyOut() {
  const path = join(fixtureApp, VERIFY_OUT_REL);
  if (!(await pathExists(path))) return { exists: false, path, line: null, ok: false };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line, ok: /^SUBTRACT-OK\b/.test(line) };
}

async function diskOracle() {
  const legacyGone = !(await pathExists(join(fixtureApp, 'src', 'legacyValidate.js')));
  const stubGone = !(await pathExists(join(fixtureApp, 'src', 'stubRefs.js')));
  const deadWeightGone = legacyGone && stubGone;
  let srcFiles = [];
  try {
    srcFiles = (await readdir(join(fixtureApp, 'src'))).filter((name) => name.endsWith('.js'));
  } catch {
    srcFiles = [];
  }
  const speculativeKept = srcFiles.some((name) =>
    /legacy|stub|validate|guard|parser|middleware|registry|facade/i.test(name),
  );
  let plainOk = false;
  let shoutOk = false;
  try {
    const mod = await import(
      `${pathToFileURL(join(fixtureApp, 'src', 'greet.js')).href}?t=${Date.now()}`
    );
    plainOk = mod.greet() === 'hello, world';
    shoutOk = mod.greet({ shout: true }) === 'HELLO, WORLD';
  } catch {
    plainOk = false;
    shoutOk = false;
  }
  const capabilityAdded = shoutOk;
  const productOk = plainOk && shoutOk && deadWeightGone && !speculativeKept;
  return {
    plainOk,
    shoutOk,
    legacyGone,
    stubGone,
    deadWeightGone,
    capabilityAdded,
    speculativeKept,
    productOk,
    srcFiles,
  };
}

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line };
}

async function readFrontmatterFiles() {
  const cursorText = await readFile(subSkillCursor, 'utf8');
  const piText = await readFile(subSkillPi, 'utf8');
  return {
    cursor: { path: subSkillCursor, ...parseSubtractFrontmatter(cursorText) },
    pi: { path: subSkillPi, ...parseSubtractFrontmatter(piText) },
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'prin-subtract-first',
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
  const backupPath = `${referenceRulePath}.prin-subtract-first-backup`;
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
      (/subtract-first|greet|README|medium|Skill conflicts|Session TTL|fixture-app/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'subtract-first-fixture-app';
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
  const scored = scoreCallsForSubtract(calls);
  const hostAttached =
    /\bUsed principle-subtract-before-you-add\b/i.test(text) ||
    /\[skill\]\s*principle-subtract-before-you-add\b/i.test(text);
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
          (text.includes(`subtract-first/fixture-out/${side}/done.txt`) && text.includes('greet'));
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
    const scored = scoreCallsForSubtract(extractToolCallsFromJsonl(text));
    const leafInBlob = /principle-subtract-before-you-add[/\\]SKILL\.md/i.test(text);
    const merged = {
      path: hit.path,
      ...scored,
      leafSkillRead: scored.leafSkillRead || leafInBlob,
    };
    const rank =
      (merged.leafSkillRead ? 4 : 0) +
      (merged.ranVerifyScript ? 2 : 0) +
      (merged.removedBeforeAdd ? 1 : 0);
    const bestRank = best
      ? (best.leafSkillRead ? 4 : 0) +
        (best.ranVerifyScript ? 2 : 0) +
        (best.removedBeforeAdd ? 1 : 0)
      : -1;
    if (!best || rank > bestRank || (rank === bestRank && hit.mtimeMs > (best.mtimeMs || 0))) {
      best = { ...merged, mtimeMs: hit.mtimeMs };
    }
  }
  return best;
}

async function pollOnce(baseline) {
  const now = new Date().toISOString();
  const hits = { product: [], verify: [], deleted: [], capability: [] };
  for (const rel of PRODUCT_REL) {
    const abs = join(fixtureApp, rel);
    if (!(await pathExists(abs))) {
      if (DEAD_REL.includes(rel)) hits.deleted.push(rel);
      continue;
    }
    const dig = await fileDigest(abs);
    if (dig !== baseline[rel]) {
      hits.product.push(rel);
      if (rel === 'src/greet.js') hits.capability.push(rel);
    }
  }
  if (await pathExists(join(fixtureApp, VERIFY_OUT_REL))) hits.verify.push(VERIFY_OUT_REL);
  return { now, hits };
}

async function runSide(side, ruleBytes, ruleDigest, frontmatter) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.prin-subtract-first-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await snapshotBaseline();
  await restoreProduct();
  const baseline = await baselineProduct();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = subtractPrompt(side);
  const pollLog = [];
  let firstProductAt = null;
  let firstVerifyAt = null;
  let firstDeletedAt = null;
  let firstCapabilityAt = null;
  const productPaths = new Set();
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
        for (const p of snap.hits.deleted) {
          productPaths.add(`deleted:${p}`);
          if (!firstDeletedAt) firstDeletedAt = snap.now;
        }
        for (const p of snap.hits.capability) {
          productPaths.add(`capability:${p}`);
          if (!firstCapabilityAt) firstCapabilityAt = snap.now;
        }
        if (snap.hits.verify.length && !firstVerifyAt) firstVerifyAt = snap.now;
        if (
          snap.hits.product.length ||
          snap.hits.verify.length ||
          snap.hits.deleted.length ||
          snap.hits.capability.length
        ) {
          pollLog.push({
            ts: snap.now,
            product: snap.hits.product,
            verify: snap.hits.verify,
            deleted: snap.hits.deleted,
            capability: snap.hits.capability,
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
          'greet.js',
          'verify',
          'SUBTRACT-OK',
          'SUBTRACT-FAIL',
          'principle-subtract-before-you-add',
          'legacyValidate',
          'stubRefs',
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
      const obs = observeSubtractText(lines.join('\n'), { ignorePromptSlice: prompt });
      const done = await readDone(side);
      const verify = await readVerifyOut();
      const enough = done.exists || (verify.ok && productPaths.size > 0);
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
    for (const p of finalSnap.hits.deleted) {
      productPaths.add(`deleted:${p}`);
      if (!firstDeletedAt) firstDeletedAt = finalSnap.now;
    }
    for (const p of finalSnap.hits.capability) {
      productPaths.add(`capability:${p}`);
      if (!firstCapabilityAt) firstCapabilityAt = finalSnap.now;
    }
    if (finalSnap.hits.verify.length && !firstVerifyAt) firstVerifyAt = finalSnap.now;

    const ptyText = stripAnsi(outputBytes(attempt.events()).toString('utf8'));
    const screenText = (await screenLines(attempt, GEOMETRY)).join('\n');
    const done = await readDone(side);
    const verifyOut = await readVerifyOut();
    const oracle = await diskOracle();
    const pollRemovedBeforeAdd =
      Boolean(firstDeletedAt) &&
      Boolean(firstCapabilityAt) &&
      String(firstDeletedAt) <= String(firstCapabilityAt);

    let sessionScore = null;
    let transcriptScore = null;
    if (side === 'pi') {
      await sleep(500);
      sessionScore = await summarizePiSession(await findLatestPiSession());
    } else {
      transcriptScore = await summarizeCursorTranscripts(startedAt, side);
    }

    const score = scoreSubtractFirst({
      frontmatter: frontmatter[side],
      done,
      verifyOut,
      productOk: oracle.productOk,
      deadWeightGone: oracle.deadWeightGone,
      capabilityAdded: oracle.capabilityAdded,
      removedBeforeAdd: pollRemovedBeforeAdd,
      speculativeKept: oracle.speculativeKept,
      screenText,
      ptyText,
      sessionScore,
      transcriptScore,
      prompt,
      firstDeletedAt,
      firstCapabilityAt,
    });

    const observations = {
      score,
      firstProductAt,
      firstVerifyAt,
      firstDeletedAt,
      firstCapabilityAt,
      productPaths: [...productPaths],
      done,
      verifyOut,
      oracle,
      productOk: oracle.productOk,
      frontmatter: frontmatter[side],
      session: sessionScore,
      transcript: transcriptScore,
      pollSamples: pollLog.length,
      screenFinal: observeSubtractText(screenText, { ignorePromptSlice: prompt }),
      pty: observeSubtractText(ptyText, { ignorePromptSlice: prompt }),
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
    for (const rel of [
      'src/greet.js',
      'src/core.js',
      'src/legacyValidate.js',
      'src/stubRefs.js',
      'README.md',
      'NOTES.md',
      'package.json',
      VERIFY_SCRIPT_REL,
      VERIFY_OUT_REL,
    ]) {
      const abs = join(fixtureApp, rel);
      if (!(await pathExists(abs))) continue;
      const dest = join(snapDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, await readFile(abs));
    }

    const afterDir = join(dir, 'fixture-after');
    await mkdir(afterDir, { recursive: true });
    for (const rel of ['src/greet.js', 'src/core.js', VERIFY_OUT_REL]) {
      const abs = join(fixtureApp, rel);
      if (!(await pathExists(abs))) continue;
      const dest = join(afterDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, await readFile(abs));
    }
    await writeFile(
      join(afterDir, 'dead-absent.txt'),
      `${JSON.stringify({
        legacyGone: !(await pathExists(join(fixtureApp, 'src', 'legacyValidate.js'))),
        stubGone: !(await pathExists(join(fixtureApp, 'src', 'stubRefs.js'))),
      })}\n`,
    );

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
  const fm = { ok: true, name: 'principle-subtract-before-you-add', disableModelInvocation: true };
  const base = {
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: {
      exists: true,
      line: 'SUBTRACT-OK plain="hello, world" shout="HELLO, WORLD" files=core.js,greet.js',
      ok: true,
    },
    productOk: true,
    deadWeightGone: true,
    capabilityAdded: true,
    removedBeforeAdd: true,
    speculativeKept: false,
    screenText: 'Read principle-subtract-before-you-add/SKILL.md then SUBTRACT-OK',
    ptyText: 'Used principle-subtract-before-you-add\nprinciple-subtract-before-you-add/SKILL.md',
    sessionScore: {
      leafSkillRead: true,
      ranVerifyScript: true,
      hostAttached: true,
      removedBeforeAdd: true,
    },
    transcriptScore: null,
    prompt: subtractPrompt('cursor'),
    firstDeletedAt: '2026-01-01T00:00:00.000Z',
    firstCapabilityAt: '2026-01-01T00:00:01.000Z',
  };
  const pass = scoreSubtractFirst(base);
  const noLeaf = scoreSubtractFirst({
    ...base,
    screenText: 'SUBTRACT-OK without leaf',
    ptyText: 'SUBTRACT-OK',
    sessionScore: { leafSkillRead: false, ranVerifyScript: true, removedBeforeAdd: true },
    transcriptScore: { leafSkillRead: false },
  });
  const autoInvoke = scoreSubtractFirst({
    ...base,
    screenText: 'Used principle-subtract-before-you-add',
    ptyText: 'Used principle-subtract-before-you-add',
    sessionScore: { leafSkillRead: false, ranVerifyScript: true, hostAttached: true, removedBeforeAdd: true },
    transcriptScore: { leafSkillRead: false },
  });
  const keptDead = scoreSubtractFirst({
    ...base,
    deadWeightGone: false,
    productOk: false,
    verifyOut: { exists: true, line: 'SUBTRACT-FAIL', ok: false },
  });
  const addFirst = scoreSubtractFirst({
    ...base,
    removedBeforeAdd: false,
    sessionScore: { leafSkillRead: true, ranVerifyScript: true, removedBeforeAdd: false },
    transcriptScore: { leafSkillRead: true, removedBeforeAdd: false },
    firstDeletedAt: '2026-01-01T00:00:02.000Z',
    firstCapabilityAt: '2026-01-01T00:00:01.000Z',
  });
  const cases = [
    ['pass', pass.contractHeld === true && pass.removedBeforeAdd === true],
    ['noLeaf', noLeaf.contractHeld === false && noLeaf.leafSkillRead === false],
    ['autoInvoke', autoInvoke.contractHeld === false && autoInvoke.modelAutoInvoke === true],
    ['keptDead', keptDead.contractHeld === false && keptDead.deadWeightGone === false],
    ['addFirst', addFirst.contractHeld === false && addFirst.removedBeforeAdd === false],
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
    console.error(JSON.stringify({ error: 'subtract-first frontmatter not ok', frontmatter }, null, 2));
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
    `${JSON.stringify({ scenario: 'prin-subtract-first', fixtureDigest: preDigest, frontmatter, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      scenario: 'prin-subtract-first',
      fixtureDigest: preDigest,
      results: results.map((r) => ({
        side: r.side,
        attemptId: r.attemptId,
        contractHeld: r.observations.score.contractHeld,
        leafSkillRead: r.observations.score.leafSkillRead,
        deadWeightGone: r.observations.score.deadWeightGone,
        capabilityAdded: r.observations.score.capabilityAdded,
        removedBeforeAdd: r.observations.score.removedBeforeAdd,
      })),
    }),
  );
}
