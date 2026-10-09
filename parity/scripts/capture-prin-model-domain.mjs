#!/usr/bin/env node
// prin-model-domain: /poteto-mode feature that tempts another synced boolean.
// Observe leaf Read of principle-model-the-domain and a domain structure
// (status model, registry, transitions, reducer) instead of only isHeld.
// Real PTY both sides.
//
// Evidence root: parity/evidence/principles/model-domain/
// Usage: node scripts/capture-prin-model-domain.mjs [--cursor-only|--pi-only|--both|--self-test]
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
const evidenceRoot = join(root, 'evidence', 'principles', 'model-domain');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const domainSkillCursor = join(
  root,
  'reference',
  'cursor-plugins',
  'pstack',
  'skills',
  'principle-model-the-domain',
  'SKILL.md',
);
const domainSkillPi = join(root, '..', 'extensions', 'pi-pstack', 'skills', 'principle-model-the-domain', 'SKILL.md');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;
const POLL_MS = 400;
const PRODUCT_REL = ['src/ticket.js'];
const VERIFY_OUT_REL = 'evidence/verify-out.txt';
const VERIFY_SCRIPT_REL = 'scripts/verify.mjs';

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

function modelDomainPrompt(side) {
  const out = donePath(side);
  return (
    `/poteto-mode Tickets in src/ticket.js use isDraft and isOpen. Add hold and release ` +
    `so a held ticket labels HELD, close rejects while held, and release returns to open. ` +
    `node scripts/verify.mjs should print DOMAIN-OK. Prefer a clear lifecycle model over ` +
    `another flag that must stay in sync with the existing booleans. ` +
    `For any poteto-mode principle you apply before declaring done, read that principle's ` +
    `leaf SKILL.md in full first (not only the poteto-mode Principles index). ` +
    `Work only inside this fixture cwd. Do not edit ledgers, parity/, or files outside ` +
    `this cwd except the named done path. ` +
    `When the change is verified against the real artifact, write exactly one line to ${out} ` +
    `as verified=yes|no, then stop.`
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

export function parseModelDomainFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { ok: false, disableModelInvocation: null, name: null };
  const body = match[1];
  const name = (body.match(/^name:\s*(.+)$/m) || [])[1]?.trim() ?? null;
  const disableRaw = (body.match(/^disable-model-invocation:\s*(.+)$/m) || [])[1]?.trim() ?? null;
  const disableModelInvocation = disableRaw === 'true' ? true : disableRaw === 'false' ? false : null;
  return {
    ok: name === 'principle-model-the-domain' && disableModelInvocation === true,
    name,
    disableModelInvocation,
  };
}

function isModelDomainSkillPath(p) {
  if (!p) return false;
  return /principle-model-the-domain[/\\]SKILL\.md/i.test(String(p));
}

function observeModelDomainText(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  const potetoMode =
    /\/poteto-mode\b/i.test(hay) ||
    /\[skill\]\s*poteto-mode/i.test(hay) ||
    /\bUsed poteto-mode\b/i.test(hay);
  const leafChrome = /principle-model-the-domain[/\\]SKILL\.md/i.test(hay);
  const usedLeaf = /\bUsed principle-model-the-domain\b/i.test(hay);
  const skillBracketLeaf = /\[skill\]\s*principle-model-the-domain\b/i.test(hay);
  const hostAttached = Boolean(usedLeaf || skillBracketLeaf);
  const verifyMention =
    /scripts\/verify\.mjs/i.test(hay) ||
    /evidence\/verify-out\.txt/i.test(hay) ||
    /\bDOMAIN-OK\b/.test(hay) ||
    /\bDOMAIN-FAIL\b/.test(hay);
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
    if (/principle-model-the-domain[/\\]SKILL\.md/i.test(blob)) {
      calls.push({ ts, name: 'blob-mention', args: { path: 'principle-model-the-domain/SKILL.md' } });
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

function isProductPath(p) {
  if (!p) return false;
  const s = String(p);
  return /src[/\\]ticket\.js/i.test(s);
}

function isWriteLike(name, args) {
  if (/^(Write|write|write_file|WriteFile|StrReplace|str_replace|Edit|edit|ApplyPatch|apply_patch)$/i.test(name)) {
    return true;
  }
  if (name === 'bash' || name === 'Shell') {
    const cmd = typeof args.command === 'string' ? args.command : '';
    return /\b(tee|cat\s*>|sed\s+-i|perl\s+-i)\b/.test(cmd) && /src\/ticket\.js/.test(cmd);
  }
  return false;
}

function scoreCallsForModelDomain(calls) {
  let leafSkillRead = false;
  let leafSkillReadAt = null;
  let ranVerifyScript = false;
  let firstVerifyAt = null;
  let firstProductWriteAt = null;
  const toolOrder = [];
  for (const call of calls) {
    const name = String(call.name || '');
    const args = call.args || {};
    const blob = JSON.stringify(args);
    const path = pathFromArgs(args);
    const isRead =
      /^(Read|read|read_file|ReadFile|cat|blob-mention)$/i.test(name) ||
      (name === 'bash' && typeof args.command === 'string' && /\bcat\b/.test(args.command));
    if (isRead && isModelDomainSkillPath(path || blob)) {
      leafSkillRead = true;
      if (!leafSkillReadAt) leafSkillReadAt = call.ts || new Date().toISOString();
      toolOrder.push(`${name}(model-domain-leaf)`);
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
    if (isWriteLike(name, args) && (isProductPath(path) || isProductPath(blob))) {
      if (!firstProductWriteAt) firstProductWriteAt = call.ts || new Date().toISOString();
      toolOrder.push(`${name}(product)`);
      continue;
    }
    if (name) toolOrder.push(name);
  }
  return {
    leafSkillRead,
    leafSkillReadAt,
    ranVerifyScript,
    firstVerifyAt,
    firstProductWriteAt,
    toolOrder: toolOrder.slice(0, 80),
  };
}

function exportsHoldAndRelease(src) {
  const hold =
    /\b(?:export\s+)?(?:async\s+)?function\s+hold\b/.test(src) ||
    /\bexport\s+(?:const|let|var)\s+hold\s*=/.test(src) ||
    /\bhold\s*=\s*(?:async\s*)?\(/.test(src);
  const release =
    /\b(?:export\s+)?(?:async\s+)?function\s+release\b/.test(src) ||
    /\bexport\s+(?:const|let|var)\s+release\s*=/.test(src) ||
    /\brelease\s*=\s*(?:async\s*)?\(/.test(src);
  return hold && release;
}

export function analyzeProductSources(ticketSrc) {
  const src = ticketSrc || '';
  const hasHeldApi = exportsHoldAndRelease(src);
  const statusLiterals =
    /['"]draft['"]/.test(src) && /['"]held['"]/.test(src) && (/['"]open['"]/.test(src) || /['"]closed['"]/.test(src));
  const hasStatusField = /\bstatus\b/.test(src) && statusLiterals;
  const hasRegistry =
    /\b(?:STATES|STATUSES|STATUS|LABELS|TRANSITIONS|ALLOWED|MACHINE)\b/.test(src) && /held/i.test(src);
  const hasLookupTable =
    /(?:Object\.freeze|new\s+Map)\s*\(/.test(src) && /held/i.test(src) && statusLiterals;
  const hasReducer = /\breduc(?:e|er)\b/i.test(src) && /held/i.test(src);
  const structuredDomain = Boolean(
    hasHeldApi && (hasStatusField || hasRegistry || hasLookupTable || hasReducer),
  );
  const syncedBooleans =
    /\bisDraft\b/.test(src) &&
    /\bisOpen\b/.test(src) &&
    (/\bisHeld\b/.test(src) || (/\bheld\s*:\s*true\b/.test(src) && !hasStatusField));
  const scatteredOnly = Boolean(hasHeldApi && syncedBooleans && !structuredDomain);
  return {
    hasHeldApi,
    hasStatusField,
    hasRegistry,
    hasLookupTable,
    hasReducer,
    structuredDomain,
    syncedBooleans,
    scatteredOnly,
  };
}

export function scoreModelDomain({
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
}) {
  const screen = observeModelDomainText(screenText, { ignorePromptSlice: prompt });
  const pty = observeModelDomainText(ptyText, { ignorePromptSlice: prompt });
  const leafSkillRead = Boolean(
    sessionScore?.leafSkillRead ||
      transcriptScore?.leafSkillRead ||
      screen.leafChrome ||
      pty.leafChrome,
  );
  const usedChrome = Boolean(screen.hostAttached || pty.hostAttached || sessionScore?.hostAttached);
  const modelAutoInvoke = usedChrome && !leafSkillRead;
  const ranVerifyScript = Boolean(
    sessionScore?.ranVerifyScript || transcriptScore?.ranVerifyScript || screen.verifyMention || pty.verifyMention,
  );
  const structuredDomain = Boolean(productAnalysis?.structuredDomain);
  const scatteredOnly = Boolean(productAnalysis?.scatteredOnly);
  const keptVerifyOk = Boolean(verifyOut?.ok);
  const verifiedDone = /^verified=yes\b/i.test((done?.line || '').trim());
  const frontmatterOk = Boolean(frontmatter?.ok);
  const contractHeld =
    frontmatterOk &&
    leafSkillRead &&
    structuredDomain &&
    !scatteredOnly &&
    productOk &&
    keptVerifyOk &&
    verifiedDone &&
    !modelAutoInvoke;
  return {
    frontmatterOk,
    leafSkillRead,
    usedChrome,
    modelAutoInvoke,
    ranVerifyScript,
    structuredDomain,
    scatteredOnly,
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
  for (const rel of [
    'src/ticket.js',
    'README.md',
    'NOTES.md',
    'package.json',
    VERIFY_SCRIPT_REL,
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
    'src/ticket.js',
    'README.md',
    'NOTES.md',
    'package.json',
    VERIFY_SCRIPT_REL,
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
  const files = await walkFiles(fixtureApp);
  for (const rel of files) {
    if (
      rel === 'README.md' ||
      rel === 'NOTES.md' ||
      rel === 'package.json' ||
      rel === 'src/ticket.js' ||
      rel === VERIFY_SCRIPT_REL ||
      rel === 'evidence/.gitkeep' ||
      rel === 'out/.gitkeep'
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
  return { exists: true, path, line, ok: /^DOMAIN-OK\b/.test(line) };
}

async function independentProductOk() {
  try {
    const mod = await import(`${pathToFileURL(join(fixtureApp, 'src', 'ticket.js')).href}?t=${Date.now()}`);
    const draft = mod.createDraft();
    if (mod.label(draft) !== 'DRAFT') return false;
    const opened = mod.open(draft);
    if (mod.label(opened) !== 'OPEN') return false;
    if (typeof mod.hold !== 'function' || typeof mod.release !== 'function') return false;
    const held = mod.hold(opened);
    if (mod.label(held) !== 'HELD') return false;
    let rejected = false;
    try {
      mod.close(held);
    } catch {
      rejected = true;
    }
    if (!rejected) return false;
    const released = mod.release(held);
    if (mod.label(released) !== 'OPEN') return false;
    const closed = mod.close(released);
    return mod.label(closed) === 'CLOSED';
  } catch {
    return false;
  }
}

async function readProductAnalysis() {
  const ticketSrc = await readFile(join(fixtureApp, 'src/ticket.js'), 'utf8');
  return { ticketSrc, ...analyzeProductSources(ticketSrc) };
}

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line };
}

async function readFrontmatterFiles() {
  const cursorText = await readFile(domainSkillCursor, 'utf8');
  const piText = await readFile(domainSkillPi, 'utf8');
  return {
    cursor: { path: domainSkillCursor, ...parseModelDomainFrontmatter(cursorText) },
    pi: { path: domainSkillPi, ...parseModelDomainFrontmatter(piText) },
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'prin-model-domain',
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
  const backupPath = `${referenceRulePath}.prin-model-domain-backup`;
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
      (/model-domain|ticket|README|medium|Skill conflicts|Session TTL|fixture-app/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'model-domain-fixture-app';
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
  const scored = scoreCallsForModelDomain(calls);
  const hostAttached =
    /\bUsed principle-model-the-domain\b/i.test(text) ||
    /\[skill\]\s*principle-model-the-domain\b/i.test(text);
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
          (text.includes(`model-domain/fixture-out/${side}/done.txt`) && text.includes('ticket'));
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
    const scored = scoreCallsForModelDomain(extractToolCallsFromJsonl(text));
    const leafInBlob = /principle-model-the-domain[/\\]SKILL\.md/i.test(text);
    const merged = {
      path: hit.path,
      ...scored,
      leafSkillRead: scored.leafSkillRead || leafInBlob,
    };
    const rank = (merged.leafSkillRead ? 4 : 0) + (merged.ranVerifyScript ? 2 : 0) + (merged.firstProductWriteAt ? 1 : 0);
    const bestRank = best
      ? (best.leafSkillRead ? 4 : 0) + (best.ranVerifyScript ? 2 : 0) + (best.firstProductWriteAt ? 1 : 0)
      : -1;
    if (!best || rank > bestRank || (rank === bestRank && hit.mtimeMs > (best.mtimeMs || 0))) {
      best = { ...merged, mtimeMs: hit.mtimeMs };
    }
  }
  return best;
}

async function pollOnce(baseline) {
  const now = new Date().toISOString();
  const hits = { product: [], verify: [] };
  for (const rel of PRODUCT_REL) {
    const dig = await fileDigest(join(fixtureApp, rel));
    if (dig !== baseline[rel]) hits.product.push(rel);
  }
  if (await pathExists(join(fixtureApp, VERIFY_OUT_REL))) hits.verify.push(VERIFY_OUT_REL);
  return { now, hits };
}

async function runSide(side, ruleBytes, ruleDigest, frontmatter) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.prin-model-domain-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await snapshotBaseline();
  await restoreProduct();
  const baseline = await baselineProduct();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = modelDomainPrompt(side);
  const pollLog = [];
  let firstProductAt = null;
  let firstVerifyAt = null;
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
        if (snap.hits.verify.length && !firstVerifyAt) firstVerifyAt = snap.now;
        if (snap.hits.product.length || snap.hits.verify.length) {
          pollLog.push({
            ts: snap.now,
            product: snap.hits.product,
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
          'ticket.js',
          'verify',
          'DOMAIN-OK',
          'DOMAIN-FAIL',
          'principle-model-the-domain',
          'Phase',
          'hold',
          'HELD',
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
      const obs = observeModelDomainText(lines.join('\n'), { ignorePromptSlice: prompt });
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

    const score = scoreModelDomain({
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
    });

    const observations = {
      score,
      firstProductAt,
      firstVerifyAt,
      productPaths: [...productPaths],
      done,
      verifyOut,
      productOk,
      productAnalysis: {
        hasHeldApi: productAnalysis.hasHeldApi,
        hasStatusField: productAnalysis.hasStatusField,
        hasRegistry: productAnalysis.hasRegistry,
        hasLookupTable: productAnalysis.hasLookupTable,
        hasReducer: productAnalysis.hasReducer,
        structuredDomain: productAnalysis.structuredDomain,
        syncedBooleans: productAnalysis.syncedBooleans,
        scatteredOnly: productAnalysis.scatteredOnly,
      },
      frontmatter: frontmatter[side],
      session: sessionScore,
      transcript: transcriptScore,
      pollSamples: pollLog.length,
      screenFinal: observeModelDomainText(screenText, { ignorePromptSlice: prompt }),
      pty: observeModelDomainText(ptyText, { ignorePromptSlice: prompt }),
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
      'src/ticket.js',
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
    for (const rel of ['src/ticket.js', VERIFY_OUT_REL]) {
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
  const fm = { ok: true, name: 'principle-model-the-domain', disableModelInvocation: true };
  const goodSrc = `
const STATUS = { draft: 'draft', open: 'open', held: 'held', closed: 'closed' };
const LABELS = { draft: 'DRAFT', open: 'OPEN', held: 'HELD', closed: 'CLOSED' };
export function createDraft() { return { status: STATUS.draft }; }
export function open(t) { return { status: STATUS.open }; }
export function hold(t) { return { status: STATUS.held }; }
export function release(t) { return { status: STATUS.open }; }
export function close(t) { if (t.status === STATUS.held) throw new Error('held'); return { status: STATUS.closed }; }
export function label(t) { return LABELS[t.status]; }
`;
  const scatteredSrc = `
export function createDraft() { return { isDraft: true, isOpen: false, isHeld: false }; }
export function open(t) { return { isDraft: false, isOpen: true, isHeld: false }; }
export function hold(t) { return { isDraft: false, isOpen: true, isHeld: true }; }
export function release(t) { return { isDraft: false, isOpen: true, isHeld: false }; }
export function close(t) { if (t.isHeld) throw new Error('held'); return { isDraft: false, isOpen: false, isHeld: false }; }
export function label(t) { if (t.isDraft) return 'DRAFT'; if (t.isHeld) return 'HELD'; if (t.isOpen) return 'OPEN'; return 'CLOSED'; }
`;
  const constExportSrc = `
const TRANSITIONS = { hold: { from: 'open', to: 'held' }, release: { from: 'held', to: 'open' } };
export function createDraft() { return { status: 'draft' }; }
export const hold = (t) => ({ status: 'held' });
export const release = (t) => ({ status: 'open' });
export function label(t) { return t.status.toUpperCase(); }
`;
  const goodAnalysis = analyzeProductSources(goodSrc);
  const scatteredAnalysis = analyzeProductSources(scatteredSrc);
  const constExportAnalysis = analyzeProductSources(constExportSrc);
  const pass = scoreModelDomain({
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: { exists: true, line: 'DOMAIN-OK hold=held-label close-held=rejected release=open', ok: true },
    productOk: true,
    productAnalysis: goodAnalysis,
    screenText: 'DOMAIN-OK principle-model-the-domain/SKILL.md',
    ptyText: 'principle-model-the-domain/SKILL.md\nDOMAIN-OK',
    sessionScore: { leafSkillRead: true, ranVerifyScript: true, hostAttached: true },
    transcriptScore: null,
    prompt: modelDomainPrompt('cursor'),
  });
  const scattered = scoreModelDomain({
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: { exists: true, line: 'DOMAIN-OK hold=held-label close-held=rejected release=open', ok: true },
    productOk: true,
    productAnalysis: scatteredAnalysis,
    screenText: 'principle-model-the-domain/SKILL.md DOMAIN-OK',
    ptyText: 'principle-model-the-domain/SKILL.md DOMAIN-OK',
    sessionScore: { leafSkillRead: true, ranVerifyScript: true },
    transcriptScore: null,
    prompt: modelDomainPrompt('cursor'),
  });
  const noLeaf = scoreModelDomain({
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: { exists: true, line: 'DOMAIN-OK hold=held-label close-held=rejected release=open', ok: true },
    productOk: true,
    productAnalysis: goodAnalysis,
    screenText: 'DOMAIN-OK',
    ptyText: 'DOMAIN-OK',
    sessionScore: { leafSkillRead: false, ranVerifyScript: true },
    transcriptScore: { leafSkillRead: false },
    prompt: modelDomainPrompt('cursor'),
  });
  const cases = [
    ['pass', pass.contractHeld === true && pass.structuredDomain === true && pass.scatteredOnly === false],
    ['scattered', scattered.contractHeld === false && scattered.scatteredOnly === true],
    ['noLeaf', noLeaf.contractHeld === false && noLeaf.leafSkillRead === false],
    ['goodAnalysis', goodAnalysis.structuredDomain === true && goodAnalysis.scatteredOnly === false],
    ['scatteredAnalysis', scatteredAnalysis.structuredDomain === false && scatteredAnalysis.scatteredOnly === true],
    [
      'constExport',
      constExportAnalysis.hasHeldApi === true &&
        constExportAnalysis.hasRegistry === true &&
        constExportAnalysis.structuredDomain === true,
    ],
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
    console.error(JSON.stringify({ error: 'model-domain frontmatter not ok', frontmatter }, null, 2));
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
    `${JSON.stringify({ scenario: 'prin-model-domain', fixtureDigest: preDigest, frontmatter, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      scenario: 'prin-model-domain',
      fixtureDigest: preDigest,
      results: results.map((r) => ({
        side: r.side,
        attemptId: r.attemptId,
        contractHeld: r.observations.score.contractHeld,
        leafSkillRead: r.observations.score.leafSkillRead,
        structuredDomain: r.observations.score.structuredDomain,
        scatteredOnly: r.observations.score.scatteredOnly,
      })),
    }),
  );
}
