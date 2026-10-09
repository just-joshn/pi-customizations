#!/usr/bin/env node
// prin-outcome-oriented: /poteto-mode finish the phased pricing rewrite in
// NOTES.md. Observe leaf Read of principle-outcome-oriented-execution,
// converge on priceFor, and leave no long-lived dual path. Real PTY both sides.
//
// Evidence root: parity/evidence/principles/outcome-oriented/
// Usage: node scripts/capture-prin-outcome-oriented.mjs [--cursor-only|--pi-only|--both|--self-test]
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
const evidenceRoot = join(root, 'evidence', 'principles', 'outcome-oriented');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const outcomeSkillCursor = join(
  root,
  'reference',
  'cursor-plugins',
  'pstack',
  'skills',
  'principle-outcome-oriented-execution',
  'SKILL.md',
);
const outcomeSkillPi = join(
  root,
  '..',
  'extensions',
  'pi-pstack',
  'skills',
  'principle-outcome-oriented-execution',
  'SKILL.md',
);
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;
const POLL_MS = 400;
const PRODUCT_REL = ['src/pricingV1.js', 'src/cart.js', 'src/checkout.js', 'src/pricing.js'];
const V1_REL = 'src/pricingV1.js';
const CALLER_REL = ['src/cart.js', 'src/checkout.js'];
const VERIFY_OUT_REL = 'evidence/verify-out.txt';
const VERIFY_SCRIPT_REL = 'scripts/verify.mjs';
const BASELINE_REL = [
  'src/pricingV1.js',
  'src/cart.js',
  'src/checkout.js',
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

function outcomePrompt(side) {
  const out = donePath(side);
  return (
    `/poteto-mode Finish the pricing rewrite described in NOTES.md. ` +
    `The phase plan is already written. Converge on a single priceFor API in ` +
    `src/pricing.js, point cart.js and checkout.js at it, and remove pricingV1 so ` +
    `node scripts/verify.mjs prints OUTCOME-OK. Do not leave a long-lived dual path ` +
    `or throwaway compatibility bridge. ` +
    `For any poteto-mode principle you apply before declaring done, read that principle's ` +
    `leaf SKILL.md in full first (not only the poteto-mode Principles index). ` +
    `Work only inside this fixture cwd. Do not edit ledgers, parity/, or files outside ` +
    `this cwd except the named done path. ` +
    `When OUTCOME-OK is on disk, write exactly one line to ${out} as verified=yes|no, then stop.`
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

export function parseOutcomeFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { ok: false, disableModelInvocation: null, name: null };
  const body = match[1];
  const name = (body.match(/^name:\s*(.+)$/m) || [])[1]?.trim() ?? null;
  const disableRaw = (body.match(/^disable-model-invocation:\s*(.+)$/m) || [])[1]?.trim() ?? null;
  const disableModelInvocation = disableRaw === 'true' ? true : disableRaw === 'false' ? false : null;
  return {
    ok: name === 'principle-outcome-oriented-execution' && disableModelInvocation === true,
    name,
    disableModelInvocation,
  };
}

function isOutcomeSkillPath(p) {
  if (!p) return false;
  return /principle-outcome-oriented-execution[/\\]SKILL\.md/i.test(String(p));
}

function isV1Path(p) {
  if (!p) return false;
  return /src[/\\]pricingV1\.js/i.test(String(p));
}

function isCallerPath(p) {
  if (!p) return false;
  return /src[/\\](cart|checkout)\.js/i.test(String(p));
}

function isPricingPath(p) {
  if (!p) return false;
  return /src[/\\]pricing\.js/i.test(String(p));
}

function observeOutcomeText(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  const potetoMode =
    /\/poteto-mode\b/i.test(hay) ||
    /\[skill\]\s*poteto-mode/i.test(hay) ||
    /\bUsed poteto-mode\b/i.test(hay);
  const leafChrome = /principle-outcome-oriented-execution[/\\]SKILL\.md/i.test(hay);
  const usedLeaf = /\bUsed principle-outcome-oriented-execution\b/i.test(hay);
  const skillBracketLeaf = /\[skill\]\s*principle-outcome-oriented-execution\b/i.test(hay);
  const hostAttached = Boolean(usedLeaf || skillBracketLeaf);
  const verifyMention =
    /scripts\/verify\.mjs/i.test(hay) ||
    /evidence\/verify-out\.txt/i.test(hay) ||
    /\bOUTCOME-OK\b/.test(hay) ||
    /\bOUTCOME-FAIL\b/.test(hay);
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
    if (/principle-outcome-oriented-execution[/\\]SKILL\.md/i.test(blob)) {
      calls.push({
        ts,
        name: 'blob-mention',
        args: { path: 'principle-outcome-oriented-execution/SKILL.md' },
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
    return /\b(tee|cat\s*>|sed\s+-i|perl\s+-i)\b/.test(cmd) && /src\/(cart|checkout|pricing)\.js/.test(cmd);
  }
  return false;
}

function isDeleteLike(name, args) {
  if (/^(Delete|delete|delete_file|DeleteFile|rm|Remove)$/i.test(name)) return true;
  if (name === 'bash' || name === 'Shell') {
    const cmd = typeof args.command === 'string' ? args.command : '';
    return /\brm\b/.test(cmd) && /pricingV1/.test(cmd);
  }
  return false;
}

function scoreCallsForOutcome(calls) {
  let leafSkillRead = false;
  let leafSkillReadAt = null;
  let ranVerifyScript = false;
  let firstV1DeleteAt = null;
  let firstCallerAt = null;
  let firstPricingAt = null;
  const toolOrder = [];
  for (const call of calls) {
    const name = String(call.name || '');
    const args = call.args || {};
    const blob = JSON.stringify(args);
    const path = pathFromArgs(args);
    const isRead =
      /^(Read|read|read_file|ReadFile|cat|blob-mention)$/i.test(name) ||
      (name === 'bash' && typeof args.command === 'string' && /\bcat\b/.test(args.command));
    if (isRead && isOutcomeSkillPath(path || blob)) {
      leafSkillRead = true;
      if (!leafSkillReadAt) leafSkillReadAt = call.ts || new Date().toISOString();
      toolOrder.push(`${name}(outcome-leaf)`);
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
    if (isDeleteLike(name, args) && (isV1Path(path) || isV1Path(blob))) {
      if (!firstV1DeleteAt) firstV1DeleteAt = call.ts || new Date().toISOString();
      toolOrder.push(`${name}(v1-delete)`);
      continue;
    }
    if (isWriteLike(name, args) && (isCallerPath(path) || isCallerPath(blob))) {
      if (!firstCallerAt) firstCallerAt = call.ts || new Date().toISOString();
      toolOrder.push(`${name}(caller)`);
      continue;
    }
    if (isWriteLike(name, args) && (isPricingPath(path) || isPricingPath(blob))) {
      if (!firstPricingAt) firstPricingAt = call.ts || new Date().toISOString();
      toolOrder.push(`${name}(pricing)`);
      continue;
    }
    if (name) toolOrder.push(name);
  }
  const converged =
    Boolean(firstV1DeleteAt) &&
    (Boolean(firstCallerAt) || Boolean(firstPricingAt));
  return {
    leafSkillRead,
    leafSkillReadAt,
    ranVerifyScript,
    firstV1DeleteAt,
    firstCallerAt,
    firstPricingAt,
    converged,
    toolOrder: toolOrder.slice(0, 80),
  };
}

export function scoreOutcomeOriented({
  frontmatter,
  done,
  verifyOut,
  productOk,
  v1Deleted,
  callersConverged,
  pricingPresent,
  dualPath,
  converged,
  screenText,
  ptyText,
  sessionScore,
  transcriptScore,
  prompt,
}) {
  const screen = observeOutcomeText(screenText, { ignorePromptSlice: prompt });
  const pty = observeOutcomeText(ptyText, { ignorePromptSlice: prompt });
  const leafSkillRead = Boolean(
    sessionScore?.leafSkillRead ||
      transcriptScore?.leafSkillRead ||
      screen.leafChrome ||
      pty.leafChrome,
  );
  const usedChrome = Boolean(screen.hostAttached || pty.hostAttached || sessionScore?.hostAttached);
  const modelAutoInvoke = usedChrome && !leafSkillRead;
  const waveOk = Boolean(converged || sessionScore?.converged || transcriptScore?.converged);
  const keptVerifyOk = Boolean(verifyOut?.ok);
  const verifiedDone = /^verified=yes\b/i.test((done?.line || '').trim());
  const frontmatterOk = Boolean(frontmatter?.ok);
  const convergeWithoutDualPath =
    Boolean(v1Deleted) &&
    Boolean(callersConverged) &&
    Boolean(pricingPresent) &&
    !dualPath &&
    Boolean(productOk);
  const contractHeld =
    frontmatterOk &&
    leafSkillRead &&
    convergeWithoutDualPath &&
    waveOk &&
    keptVerifyOk &&
    verifiedDone &&
    !modelAutoInvoke;
  return {
    frontmatterOk,
    leafSkillRead,
    usedChrome,
    modelAutoInvoke,
    v1Deleted: Boolean(v1Deleted),
    callersConverged: Boolean(callersConverged),
    pricingPresent: Boolean(pricingPresent),
    dualPath: Boolean(dualPath),
    convergeWithoutDualPath,
    converged: waveOk,
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
    const abs = join(fixtureApp, rel);
    if (await pathExists(abs)) map[rel] = await fileDigest(abs);
    else map[rel] = null;
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
  await rm(join(fixtureApp, 'src', 'pricing.js'), { force: true });
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
  return { exists: true, path, line, ok: /^OUTCOME-OK\b/.test(line) };
}

async function diskOracle() {
  const v1Deleted = !(await pathExists(join(fixtureApp, V1_REL)));
  const pricingPresent = await pathExists(join(fixtureApp, 'src', 'pricing.js'));
  let srcFiles = [];
  try {
    srcFiles = (await readdir(join(fixtureApp, 'src'))).filter((name) => name.endsWith('.js'));
  } catch {
    srcFiles = [];
  }
  let legacySymbol = false;
  let dualPath = false;
  let callersConverged = true;
  for (const name of srcFiles) {
    const body = await readFile(join(fixtureApp, 'src', name), 'utf8');
    if (/\bpriceV1\b/.test(body) || /\bpricingV1\b/.test(body)) legacySymbol = true;
    if (/compat|shim|bridge|adapter|dual.?path/i.test(name)) dualPath = true;
    if (
      /\bpriceV1\b/.test(body) &&
      /\bpriceFor\b/.test(body) &&
      /export\s+(?:function|const|\{)/.test(body)
    ) {
      dualPath = true;
    }
    if (CALLER_REL.some((rel) => rel.endsWith(name))) {
      if (!/\bpriceFor\b/.test(body) || /\bpriceV1\b/.test(body)) callersConverged = false;
    }
  }
  if (!v1Deleted && pricingPresent) dualPath = true;
  if (!pricingPresent) callersConverged = false;
  let cartOk = false;
  let checkoutOk = false;
  try {
    const cartMod = await import(
      `${pathToFileURL(join(fixtureApp, 'src', 'cart.js')).href}?t=${Date.now()}`
    );
    const checkoutMod = await import(
      `${pathToFileURL(join(fixtureApp, 'src', 'checkout.js')).href}?t=${Date.now()}`
    );
    cartOk = cartMod.cart() === 'cart:5';
    checkoutOk = checkoutMod.checkout() === 'pay:5';
  } catch {
    cartOk = false;
    checkoutOk = false;
  }
  const productOk =
    cartOk && checkoutOk && v1Deleted && pricingPresent && callersConverged && !legacySymbol && !dualPath;
  return {
    cartOk,
    checkoutOk,
    v1Deleted,
    pricingPresent,
    callersConverged,
    legacySymbol,
    dualPath,
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
  const cursorText = await readFile(outcomeSkillCursor, 'utf8');
  const piText = await readFile(outcomeSkillPi, 'utf8');
  return {
    cursor: { path: outcomeSkillCursor, ...parseOutcomeFrontmatter(cursorText) },
    pi: { path: outcomeSkillPi, ...parseOutcomeFrontmatter(piText) },
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'prin-outcome-oriented',
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
  const backupPath = `${referenceRulePath}.prin-outcome-oriented-backup`;
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
      (/outcome-oriented|cart|pricing|README|medium|Skill conflicts|Session TTL|fixture-app/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'outcome-oriented-fixture-app';
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
  const scored = scoreCallsForOutcome(calls);
  const hostAttached =
    /\bUsed principle-outcome-oriented-execution\b/i.test(text) ||
    /\[skill\]\s*principle-outcome-oriented-execution\b/i.test(text);
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
          (text.includes(`outcome-oriented/fixture-out/${side}/done.txt`) && text.includes('priceFor'));
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
    const scored = scoreCallsForOutcome(extractToolCallsFromJsonl(text));
    const leafInBlob = /principle-outcome-oriented-execution[/\\]SKILL\.md/i.test(text);
    const merged = {
      path: hit.path,
      ...scored,
      leafSkillRead: scored.leafSkillRead || leafInBlob,
    };
    const rank =
      (merged.leafSkillRead ? 4 : 0) +
      (merged.ranVerifyScript ? 2 : 0) +
      (merged.converged ? 1 : 0);
    const bestRank = best
      ? (best.leafSkillRead ? 4 : 0) + (best.ranVerifyScript ? 2 : 0) + (best.converged ? 1 : 0)
      : -1;
    if (!best || rank > bestRank || (rank === bestRank && hit.mtimeMs > (best.mtimeMs || 0))) {
      best = { ...merged, mtimeMs: hit.mtimeMs };
    }
  }
  return best;
}

async function pollOnce(baseline) {
  const now = new Date().toISOString();
  const hits = { product: [], verify: [], deleted: [], callers: [], format: [] };
  for (const rel of PRODUCT_REL) {
    const abs = join(fixtureApp, rel);
    if (!(await pathExists(abs))) {
      if (rel === V1_REL && baseline[rel] != null) hits.deleted.push(rel);
      continue;
    }
    const dig = await fileDigest(abs);
    if (dig !== baseline[rel]) {
      hits.product.push(rel);
      if (CALLER_REL.includes(rel)) hits.callers.push(rel);
      if (rel === 'src/pricing.js') hits.format.push(rel);
    }
  }
  if (await pathExists(join(fixtureApp, VERIFY_OUT_REL))) hits.verify.push(VERIFY_OUT_REL);
  return { now, hits };
}

async function runSide(side, ruleBytes, ruleDigest, frontmatter) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.prin-outcome-oriented-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await snapshotBaseline();
  await restoreProduct();
  const baseline = await baselineProduct();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = outcomePrompt(side);
  const pollLog = [];
  let firstProductAt = null;
  let firstVerifyAt = null;
  let firstV1DeleteAt = null;
  let firstCallerAt = null;
  let firstPricingAt = null;
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
          if (!firstV1DeleteAt) firstV1DeleteAt = snap.now;
        }
        for (const p of snap.hits.callers) {
          productPaths.add(`caller:${p}`);
          if (!firstCallerAt) firstCallerAt = snap.now;
        }
        for (const p of snap.hits.format) {
          productPaths.add(`format:${p}`);
          if (!firstPricingAt) firstPricingAt = snap.now;
        }
        if (snap.hits.verify.length && !firstVerifyAt) firstVerifyAt = snap.now;
        if (
          snap.hits.product.length ||
          snap.hits.verify.length ||
          snap.hits.deleted.length ||
          snap.hits.callers.length ||
          snap.hits.format.length
        ) {
          pollLog.push({
            ts: snap.now,
            product: snap.hits.product,
            verify: snap.hits.verify,
            deleted: snap.hits.deleted,
            callers: snap.hits.callers,
            format: snap.hits.format,
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
          'cart.js',
          'checkout.js',
          'pricing.js',
          'verify',
          'OUTCOME-OK',
          'OUTCOME-FAIL',
          'principle-outcome-oriented-execution',
          'pricingV1',
          'priceFor',
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
      const obs = observeOutcomeText(lines.join('\n'), { ignorePromptSlice: prompt });
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
      if (!firstV1DeleteAt) firstV1DeleteAt = finalSnap.now;
    }
    for (const p of finalSnap.hits.callers) {
      productPaths.add(`caller:${p}`);
      if (!firstCallerAt) firstCallerAt = finalSnap.now;
    }
    for (const p of finalSnap.hits.format) {
      productPaths.add(`format:${p}`);
      if (!firstPricingAt) firstPricingAt = finalSnap.now;
    }
    if (finalSnap.hits.verify.length && !firstVerifyAt) firstVerifyAt = finalSnap.now;

    const ptyText = stripAnsi(outputBytes(attempt.events()).toString('utf8'));
    const screenText = (await screenLines(attempt, GEOMETRY)).join('\n');
    const done = await readDone(side);
    const verifyOut = await readVerifyOut();
    const oracle = await diskOracle();
    const pollSameWave =
      Boolean(firstV1DeleteAt) && (Boolean(firstCallerAt) || Boolean(firstPricingAt));

    let sessionScore = null;
    let transcriptScore = null;
    if (side === 'pi') {
      await sleep(500);
      sessionScore = await summarizePiSession(await findLatestPiSession());
    } else {
      transcriptScore = await summarizeCursorTranscripts(startedAt, side);
    }

    const score = scoreOutcomeOriented({
      frontmatter: frontmatter[side],
      done,
      verifyOut,
      productOk: oracle.productOk,
      v1Deleted: oracle.v1Deleted,
      callersConverged: oracle.callersConverged,
      pricingPresent: oracle.pricingPresent,
      dualPath: oracle.dualPath,
      converged: pollSameWave,
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
      firstV1DeleteAt,
      firstCallerAt,
      firstPricingAt,
      productPaths: [...productPaths],
      done,
      verifyOut,
      oracle,
      productOk: oracle.productOk,
      frontmatter: frontmatter[side],
      session: sessionScore,
      transcript: transcriptScore,
      pollSamples: pollLog.length,
      screenFinal: observeOutcomeText(screenText, { ignorePromptSlice: prompt }),
      pty: observeOutcomeText(ptyText, { ignorePromptSlice: prompt }),
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
      'src/pricingV1.js',
      'src/cart.js',
      'src/checkout.js',
      'src/pricing.js',
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
    for (const rel of ['src/cart.js', 'src/checkout.js', 'src/pricing.js', VERIFY_OUT_REL]) {
      const abs = join(fixtureApp, rel);
      if (!(await pathExists(abs))) continue;
      const dest = join(afterDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, await readFile(abs));
    }
    await writeFile(
      join(afterDir, 'legacy-absent.txt'),
      `${JSON.stringify({
        v1Gone: !(await pathExists(join(fixtureApp, V1_REL))),
        pricingPresent: await pathExists(join(fixtureApp, 'src', 'pricing.js')),
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
  const fm = {
    ok: true,
    name: 'principle-outcome-oriented-execution',
    disableModelInvocation: true,
  };
  const base = {
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: {
      exists: true,
      line: 'OUTCOME-OK cart="cart:5" checkout="pay:5" files=cart.js,checkout.js,pricing.js',
      ok: true,
    },
    productOk: true,
    v1Deleted: true,
    callersConverged: true,
    pricingPresent: true,
    dualPath: false,
    converged: true,
    screenText: 'Read principle-outcome-oriented-execution/SKILL.md then OUTCOME-OK',
    ptyText:
      'Used principle-outcome-oriented-execution\nprinciple-outcome-oriented-execution/SKILL.md',
    sessionScore: {
      leafSkillRead: true,
      ranVerifyScript: true,
      hostAttached: true,
      converged: true,
    },
    transcriptScore: null,
    prompt: outcomePrompt('cursor'),
  };
  const pass = scoreOutcomeOriented(base);
  const noLeaf = scoreOutcomeOriented({
    ...base,
    screenText: 'OUTCOME-OK without leaf',
    ptyText: 'OUTCOME-OK',
    sessionScore: { leafSkillRead: false, ranVerifyScript: true, converged: true },
    transcriptScore: { leafSkillRead: false },
  });
  const autoInvoke = scoreOutcomeOriented({
    ...base,
    screenText: 'Used principle-outcome-oriented-execution',
    ptyText: 'Used principle-outcome-oriented-execution',
    sessionScore: {
      leafSkillRead: false,
      ranVerifyScript: true,
      hostAttached: true,
      converged: true,
    },
    transcriptScore: { leafSkillRead: false },
  });
  const keptLegacy = scoreOutcomeOriented({
    ...base,
    v1Deleted: false,
    productOk: false,
    verifyOut: { exists: true, line: 'OUTCOME-FAIL', ok: false },
  });
  const shim = scoreOutcomeOriented({
    ...base,
    dualPath: true,
    productOk: false,
  });
  const cases = [
    [
      'pass',
      pass.contractHeld === true &&
        pass.convergeWithoutDualPath === true &&
        pass.v1Deleted === true &&
        pass.dualPath === false,
    ],
    ['noLeaf', noLeaf.contractHeld === false && noLeaf.leafSkillRead === false],
    ['autoInvoke', autoInvoke.contractHeld === false && autoInvoke.modelAutoInvoke === true],
    ['keptLegacy', keptLegacy.contractHeld === false && keptLegacy.v1Deleted === false],
    [
      'shim',
      shim.contractHeld === false &&
        shim.dualPath === true &&
        shim.convergeWithoutDualPath === false,
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
    console.error(JSON.stringify({ error: 'outcome-oriented frontmatter not ok', frontmatter }, null, 2));
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
    `${JSON.stringify({ scenario: 'prin-outcome-oriented', fixtureDigest: preDigest, frontmatter, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      scenario: 'prin-outcome-oriented',
      fixtureDigest: preDigest,
      results: results.map((r) => ({
        side: r.side,
        attemptId: r.attemptId,
        contractHeld: r.observations.score.contractHeld,
        leafSkillRead: r.observations.score.leafSkillRead,
        v1Deleted: r.observations.score.v1Deleted,
        callersConverged: r.observations.score.callersConverged,
        dualPath: r.observations.score.dualPath,
        convergeWithoutDualPath: r.observations.score.convergeWithoutDualPath,
        converged: r.observations.score.converged,
      })),
    }),
  );
}
