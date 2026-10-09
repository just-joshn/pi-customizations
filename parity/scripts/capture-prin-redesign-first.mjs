#!/usr/bin/env node
// prin-redesign-first: /poteto-mode integrate currency into an existing price
// design. Observe leaf Read of principle-redesign-from-first-principles and a
// foundational Price redesign (not a bolt-on optional field). Real PTY both sides.
// Evidence root: parity/evidence/principles/redesign-first/
//
// Usage: node scripts/capture-prin-redesign-first.mjs [--cursor-only|--pi-only|--both|--self-test]
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
const evidenceRoot = join(root, 'evidence', 'principles', 'redesign-first');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const redesignSkillCursor = join(
  root,
  'reference',
  'cursor-plugins',
  'pstack',
  'skills',
  'principle-redesign-from-first-principles',
  'SKILL.md',
);
const redesignSkillPi = join(
  root,
  '..',
  'extensions',
  'pi-pstack',
  'skills',
  'principle-redesign-from-first-principles',
  'SKILL.md',
);
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;
const POLL_MS = 400;
const PRODUCT_REL = ['src/product.js'];
const DOC_REL = ['README.md', 'NOTES.md', 'docs/price.md'];
const VERIFY_OUT_REL = 'evidence/verify-out.txt';
const VERIFY_SCRIPT_REL = 'scripts/verify.mjs';
const BASELINE_REL = [
  ...PRODUCT_REL,
  ...DOC_REL,
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

function redesignPrompt(side) {
  const out = donePath(side);
  return (
    `/poteto-mode Every product price must carry an explicit currency. Today price is a ` +
    `bare number and the docs treat USD as implied. Make node scripts/verify.mjs print ` +
    `REDESIGN-OK. Prefer redesigning Price as if currency had always been part of the ` +
    `core shape (createProduct, formatPrice, docs/price.md, README examples) rather than ` +
    `keeping bare-number prices with an optional side field. ` +
    `Keep verify output under evidence/ (scripts/verify.mjs already writes evidence/verify-out.txt). ` +
    `For any poteto-mode principle you apply before declaring done, read that principle's ` +
    `leaf SKILL.md in full first (not only the poteto-mode Principles index). ` +
    `Work only inside this fixture cwd. Do not edit ledgers, parity/, or files outside ` +
    `this cwd except the named done path. ` +
    `When REDESIGN-OK is on disk, write exactly one line to ${out} as verified=yes|no, then stop.`
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

export function parseRedesignFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { ok: false, disableModelInvocation: null, name: null };
  const body = match[1];
  const name = (body.match(/^name:\s*(.+)$/m) || [])[1]?.trim() ?? null;
  const disableRaw = (body.match(/^disable-model-invocation:\s*(.+)$/m) || [])[1]?.trim() ?? null;
  const disableModelInvocation = disableRaw === 'true' ? true : disableRaw === 'false' ? false : null;
  return {
    ok: name === 'principle-redesign-from-first-principles' && disableModelInvocation === true,
    name,
    disableModelInvocation,
  };
}

function isRedesignSkillPath(p) {
  if (!p) return false;
  return /principle-redesign-from-first-principles[/\\]SKILL\.md/i.test(String(p));
}

function isProductPath(p) {
  if (!p) return false;
  return /src[/\\]product\.js/i.test(String(p));
}

function isDocPath(p) {
  if (!p) return false;
  const s = String(p);
  return /docs[/\\]price\.md/i.test(s) || /README\.md/i.test(s);
}

function observeRedesignText(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  const potetoMode =
    /\/poteto-mode\b/i.test(hay) ||
    /\[skill\]\s*poteto-mode/i.test(hay) ||
    /\bUsed poteto-mode\b/i.test(hay);
  const leafChrome = /principle-redesign-from-first-principles[/\\]SKILL\.md/i.test(hay);
  const usedLeaf = /\bUsed principle-redesign-from-first-principles\b/i.test(hay);
  const skillBracketLeaf = /\[skill\]\s*principle-redesign-from-first-principles\b/i.test(hay);
  const hostAttached = Boolean(usedLeaf || skillBracketLeaf);
  const verifyMention =
    /scripts\/verify\.mjs/i.test(hay) ||
    /evidence\/verify-out\.txt/i.test(hay) ||
    /\bREDESIGN-OK\b/.test(hay) ||
    /\bREDESIGN-FAIL\b/.test(hay);
  const redesignMention =
    /\bcurrency\b/i.test(hay) ||
    /\bamount\b/i.test(hay) ||
    /docs\/price\.md/i.test(hay) ||
    /createProduct/i.test(hay) ||
    /formatPrice/i.test(hay);
  const working = /[\u2800-\u28FF]/.test(hay) || /\bWorking\b/.test(hay);
  return { potetoMode, leafChrome, hostAttached, verifyMention, redesignMention, working };
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
    if (/principle-redesign-from-first-principles[/\\]SKILL\.md/i.test(blob)) {
      calls.push({ ts, name: 'blob-mention', args: { path: 'principle-redesign-from-first-principles/SKILL.md' } });
    }
  }
  return calls;
}

function scoreCallsForRedesign(calls) {
  let leafSkillRead = false;
  let leafSkillReadAt = null;
  let ranVerifyScript = false;
  let wroteProduct = false;
  let wroteDocs = false;
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
    if (isRead && isRedesignSkillPath(path || blob)) {
      leafSkillRead = true;
      if (!leafSkillReadAt) leafSkillReadAt = call.ts || new Date().toISOString();
      toolOrder.push(`${name}(redesign-leaf)`);
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
    const writeLike = /^(Write|write|write_file|WriteFile|Edit|StrReplace|search_replace|create_file)$/i.test(
      name,
    );
    if (writeLike && path && isProductPath(path)) {
      wroteProduct = true;
      toolOrder.push(`${name}(product)`);
      continue;
    }
    if (writeLike && path && isDocPath(path)) {
      wroteDocs = true;
      toolOrder.push(`${name}(docs)`);
      continue;
    }
    if (name) toolOrder.push(name);
  }
  return {
    leafSkillRead,
    leafSkillReadAt,
    ranVerifyScript,
    wroteProduct,
    wroteDocs,
    toolOrder: toolOrder.slice(0, 80),
  };
}

export function scoreRedesignFirst({
  frontmatter,
  done,
  verifyOut,
  productFixed,
  docsPropagated,
  bareRejected,
  screenText,
  ptyText,
  sessionScore,
  transcriptScore,
  prompt,
}) {
  const screen = observeRedesignText(screenText, { ignorePromptSlice: prompt });
  const pty = observeRedesignText(ptyText, { ignorePromptSlice: prompt });
  const leafSkillRead = Boolean(
    sessionScore?.leafSkillRead ||
      transcriptScore?.leafSkillRead ||
      screen.leafChrome ||
      pty.leafChrome,
  );
  const usedChrome = Boolean(screen.hostAttached || pty.hostAttached || sessionScore?.hostAttached);
  const modelAutoInvoke = usedChrome && !leafSkillRead;
  const keptVerifyOk = Boolean(verifyOut?.ok);
  const docsOk = docsPropagated !== false;
  const noBoltOn = bareRejected !== false;
  const verifiedDone = /^verified=yes\b/i.test((done?.line || '').trim());
  const frontmatterOk = Boolean(frontmatter?.ok);
  const foundationalRedesign = Boolean(productFixed) && docsOk && noBoltOn;
  const contractHeld =
    frontmatterOk &&
    leafSkillRead &&
    foundationalRedesign &&
    keptVerifyOk &&
    verifiedDone &&
    !modelAutoInvoke;
  return {
    frontmatterOk,
    leafSkillRead,
    usedChrome,
    modelAutoInvoke,
    keptVerifyOk,
    productFixed: Boolean(productFixed),
    docsPropagated: docsOk,
    bareRejected: noBoltOn,
    foundationalRedesign,
    verifiedDone,
    contractHeld,
    screen,
    pty,
  };
}

async function baselineProduct() {
  const map = {};
  for (const rel of [...PRODUCT_REL, ...DOC_REL]) {
    if (!(await pathExists(join(fixtureApp, rel)))) continue;
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
  await rm(join(fixtureApp, '.audit'), { recursive: true, force: true });
  await rm(join(fixtureApp, 'out'), { recursive: true, force: true });
}

async function readVerifyOut() {
  const path = join(fixtureApp, VERIFY_OUT_REL);
  if (!(await pathExists(path))) return { exists: false, path, line: null, ok: false };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line, ok: /^REDESIGN-OK\b/.test(line) };
}

async function independentProductFixed() {
  try {
    const mod = await import(
      `${pathToFileURL(join(fixtureApp, 'src', 'product.js')).href}?t=${Date.now()}`
    );
    let bareRejected = false;
    try {
      mod.createProduct({ id: 'a', name: 'A', price: 10 });
    } catch {
      bareRejected = true;
    }
    if (!bareRejected) return { ok: false, bareRejected: false };
    const shaped = mod.createProduct({
      id: 'mug',
      name: 'Mug',
      price: { amount: 12, currency: 'EUR' },
    });
    const price = shaped.price;
    if (!price || price.amount !== 12 || price.currency !== 'EUR') {
      return { ok: false, bareRejected: true };
    }
    const label = String(mod.formatPrice(price));
    const ok = /12/.test(label) && /EUR/i.test(label);
    return { ok, bareRejected: true, label };
  } catch {
    return { ok: false, bareRejected: false };
  }
}

async function docsPropagatedOk() {
  const priceDoc = await readFile(join(fixtureApp, 'docs', 'price.md'), 'utf8');
  const readme = await readFile(join(fixtureApp, 'README.md'), 'utf8');
  const coreDoc =
    /amount\s*,\s*currency|currency\s*,\s*amount|\{[^}]*amount[^}]*currency[^}]*\}/i.test(
      priceDoc,
    );
  const oldDoc = /bare number|currency is implied/i.test(priceDoc);
  const readmeOk = /currency/i.test(readme) && !/USD implied|bare number/i.test(readme);
  return { ok: coreDoc && !oldDoc && readmeOk, coreDoc, oldDoc, readmeOk };
}

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line };
}

async function readFrontmatterFiles() {
  const cursorText = await readFile(redesignSkillCursor, 'utf8');
  const piText = await readFile(redesignSkillPi, 'utf8');
  return {
    cursor: { path: redesignSkillCursor, ...parseRedesignFrontmatter(cursorText) },
    pi: { path: redesignSkillPi, ...parseRedesignFrontmatter(piText) },
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'prin-redesign-first',
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
  const backupPath = `${referenceRulePath}.prin-redesign-first-backup`;
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
      (/fixture-app|currency|Price|README|medium|Skill conflicts|Session TTL|redesign-first/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'redesign-first-fixture-app';
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
  const scored = scoreCallsForRedesign(calls);
  const hostAttached =
    /\bUsed principle-redesign-from-first-principles\b/i.test(text) ||
    /\[skill\]\s*principle-redesign-from-first-principles\b/i.test(text);
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
          (text.includes(`redesign-first/fixture-out/${side}/done.txt`) &&
            (text.includes('currency') || text.includes('REDESIGN-OK') || text.includes('createProduct')));
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
    const scored = scoreCallsForRedesign(extractToolCallsFromJsonl(text));
    const leafInBlob = /principle-redesign-from-first-principles[/\\]SKILL\.md/i.test(text);
    const merged = {
      path: hit.path,
      ...scored,
      leafSkillRead: scored.leafSkillRead || leafInBlob,
    };
    const rank =
      (merged.leafSkillRead ? 4 : 0) +
      (merged.wroteProduct ? 2 : 0) +
      (merged.wroteDocs ? 1 : 0) +
      (merged.ranVerifyScript ? 1 : 0);
    const bestRank = best
      ? (best.leafSkillRead ? 4 : 0) +
        (best.wroteProduct ? 2 : 0) +
        (best.wroteDocs ? 1 : 0) +
        (best.ranVerifyScript ? 1 : 0)
      : -1;
    if (!best || rank > bestRank || (rank === bestRank && hit.mtimeMs > (best.mtimeMs || 0))) {
      best = { ...merged, mtimeMs: hit.mtimeMs };
    }
  }
  return best;
}

async function pollOnce(baseline) {
  const now = new Date().toISOString();
  const hits = { product: [], verify: [], docs: [] };
  for (const rel of PRODUCT_REL) {
    const abs = join(fixtureApp, rel);
    const dig = await fileDigest(abs);
    if (dig !== baseline[rel]) hits.product.push(rel);
  }
  for (const rel of DOC_REL) {
    if (rel === 'NOTES.md') continue;
    const abs = join(fixtureApp, rel);
    if (!(await pathExists(abs))) continue;
    const dig = await fileDigest(abs);
    const baseDig = baseline[rel];
    if (baseDig && dig !== baseDig) hits.docs.push(rel);
  }
  if (await pathExists(join(fixtureApp, VERIFY_OUT_REL))) hits.verify.push(VERIFY_OUT_REL);
  return { now, hits };
}

async function runSide(side, ruleBytes, ruleDigest, frontmatter) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.prin-redesign-first-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await snapshotBaseline();
  await restoreProduct();
  const baseline = await baselineProduct();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = redesignPrompt(side);
  const pollLog = [];
  let firstProductAt = null;
  let firstVerifyAt = null;
  let firstDocsAt = null;
  const productPaths = new Set();
  const docsPaths = new Set();
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
        for (const p of snap.hits.docs) {
          docsPaths.add(p);
          if (!firstDocsAt) firstDocsAt = snap.now;
        }
        if (snap.hits.verify.length && !firstVerifyAt) firstVerifyAt = snap.now;
        if (snap.hits.product.length || snap.hits.verify.length || snap.hits.docs.length) {
          pollLog.push({
            ts: snap.now,
            product: snap.hits.product,
            verify: snap.hits.verify,
            docs: snap.hits.docs,
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
          'currency',
          'verify',
          'REDESIGN-OK',
          'REDESIGN-FAIL',
          'principle-redesign-from-first-principles',
          'createProduct',
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
      const obs = observeRedesignText(lines.join('\n'), { ignorePromptSlice: prompt });
      const done = await readDone(side);
      const verify = await readVerifyOut();
      const enough = done.exists || (verify.ok && productPaths.size > 0 && docsPaths.size > 0);
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
    for (const p of finalSnap.hits.docs) {
      docsPaths.add(p);
      if (!firstDocsAt) firstDocsAt = finalSnap.now;
    }
    if (finalSnap.hits.verify.length && !firstVerifyAt) firstVerifyAt = finalSnap.now;

    const ptyText = stripAnsi(outputBytes(attempt.events()).toString('utf8'));
    const screenText = (await screenLines(attempt, GEOMETRY)).join('\n');
    const done = await readDone(side);
    const verifyOut = await readVerifyOut();
    const productCheck = await independentProductFixed();
    const docsCheck = await docsPropagatedOk();

    let sessionScore = null;
    let transcriptScore = null;
    if (side === 'pi') {
      await sleep(500);
      sessionScore = await summarizePiSession(await findLatestPiSession());
    } else {
      transcriptScore = await summarizeCursorTranscripts(startedAt, side);
    }

    const score = scoreRedesignFirst({
      frontmatter: frontmatter[side],
      done,
      verifyOut,
      productFixed: productCheck.ok,
      docsPropagated: docsCheck.ok,
      bareRejected: productCheck.bareRejected,
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
      firstDocsAt,
      productPaths: [...productPaths],
      docsPaths: [...docsPaths],
      done,
      verifyOut,
      productCheck,
      docsCheck,
      frontmatter: frontmatter[side],
      session: sessionScore,
      transcript: transcriptScore,
      pollSamples: pollLog.length,
      screenFinal: observeRedesignText(screenText, { ignorePromptSlice: prompt }),
      pty: observeRedesignText(ptyText, { ignorePromptSlice: prompt }),
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
    const snapRels = [...BASELINE_REL, VERIFY_OUT_REL];
    for (const rel of [...new Set(snapRels)]) {
      const abs = join(fixtureApp, rel);
      if (!(await pathExists(abs))) continue;
      const dest = join(snapDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, await readFile(abs));
    }

    const afterDir = join(dir, 'fixture-after');
    await mkdir(afterDir, { recursive: true });
    for (const rel of [...PRODUCT_REL, ...DOC_REL, VERIFY_OUT_REL]) {
      const abs = join(fixtureApp, rel);
      if (!(await pathExists(abs))) continue;
      const dest = join(afterDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, await readFile(abs));
      if (PRODUCT_REL.includes(rel) || DOC_REL.includes(rel) || rel === VERIFY_OUT_REL) {
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
  const fm = { ok: true, name: 'principle-redesign-from-first-principles', disableModelInvocation: true };
  const pass = scoreRedesignFirst({
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: { exists: true, line: 'REDESIGN-OK', ok: true },
    productFixed: true,
    docsPropagated: true,
    bareRejected: true,
    screenText: 'Read principle-redesign-from-first-principles/SKILL.md then redesigned Price',
    ptyText: 'Used principle-redesign-from-first-principles\nprinciple-redesign-from-first-principles/SKILL.md',
    sessionScore: { leafSkillRead: true, wroteProduct: true, wroteDocs: true, ranVerifyScript: true, hostAttached: true },
    transcriptScore: null,
    prompt: redesignPrompt('cursor'),
  });
  const boltOn = scoreRedesignFirst({
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: { exists: true, line: 'REDESIGN-OK', ok: true },
    productFixed: false,
    docsPropagated: true,
    bareRejected: false,
    screenText: 'principle-redesign-from-first-principles/SKILL.md optional currency field',
    ptyText: 'principle-redesign-from-first-principles/SKILL.md',
    sessionScore: { leafSkillRead: true, wroteProduct: true, ranVerifyScript: true, hostAttached: false },
    transcriptScore: null,
    prompt: redesignPrompt('cursor'),
  });
  const noDocs = scoreRedesignFirst({
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: { exists: true, line: 'REDESIGN-OK', ok: true },
    productFixed: true,
    docsPropagated: false,
    bareRejected: true,
    screenText: 'principle-redesign-from-first-principles/SKILL.md REDESIGN-OK',
    ptyText: 'principle-redesign-from-first-principles/SKILL.md REDESIGN-OK',
    sessionScore: { leafSkillRead: true, wroteProduct: true, ranVerifyScript: true },
    transcriptScore: null,
    prompt: redesignPrompt('cursor'),
  });
  const noLeaf = scoreRedesignFirst({
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: { exists: true, line: 'REDESIGN-OK', ok: true },
    productFixed: true,
    docsPropagated: true,
    bareRejected: true,
    screenText: 'REDESIGN-OK',
    ptyText: 'REDESIGN-OK',
    sessionScore: { leafSkillRead: false, wroteProduct: true, hostAttached: false },
    transcriptScore: { leafSkillRead: false },
    prompt: redesignPrompt('cursor'),
  });
  const autoInvoke = scoreRedesignFirst({
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: { exists: true, line: 'REDESIGN-OK', ok: true },
    productFixed: true,
    docsPropagated: true,
    bareRejected: true,
    screenText: 'Used principle-redesign-from-first-principles',
    ptyText: 'Used principle-redesign-from-first-principles',
    sessionScore: { leafSkillRead: false, wroteProduct: true, hostAttached: true },
    transcriptScore: { leafSkillRead: false },
    prompt: redesignPrompt('cursor'),
  });
  const cases = [
    ['pass', pass.contractHeld === true && pass.modelAutoInvoke === false && pass.foundationalRedesign === true],
    ['boltOn', boltOn.contractHeld === false && boltOn.foundationalRedesign === false],
    ['noDocs', noDocs.contractHeld === false && noDocs.docsPropagated === false],
    ['noLeaf', noLeaf.contractHeld === false && noLeaf.leafSkillRead === false],
    ['autoInvoke', autoInvoke.contractHeld === false && autoInvoke.modelAutoInvoke === true],
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
    console.error(JSON.stringify({ error: 'redesign-first frontmatter not ok', frontmatter }, null, 2));
    process.exit(1);
  }
  const preRule = await readFile(referenceRulePath, 'utf8');
  const preDigest = await sha256(referenceRulePath);
  if (preDigest !== LOCKED_FIXTURE_DIGEST) {
    console.error(`Reference rule digest ${preDigest} does not match the locked fixture ${LOCKED_FIXTURE_DIGEST}`);
    process.exit(1);
  }

  // sanity: fixture starts failing verify
  const { spawnSync } = await import('node:child_process');
  const pre = spawnSync(process.execPath, [join(fixtureApp, VERIFY_SCRIPT_REL)], {
    cwd: fixtureApp,
    encoding: 'utf8',
  });
  if (pre.status === 0 || !/REDESIGN-FAIL/.test(pre.stdout || '')) {
    console.error('Expected baseline fixture to fail verify with REDESIGN-FAIL');
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
    `${JSON.stringify({ scenario: 'prin-redesign-first', fixtureDigest: preDigest, frontmatter, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      scenario: 'prin-redesign-first',
      fixtureDigest: preDigest,
      results: results.map((r) => ({
        side: r.side,
        attemptId: r.attemptId,
        contractHeld: r.observations.score.contractHeld,
        leafSkillRead: r.observations.score.leafSkillRead,
        foundationalRedesign: r.observations.score.foundationalRedesign,
        productFixed: r.observations.score.productFixed,
        docsPropagated: r.observations.score.docsPropagated,
      })),
    }),
  );
}
