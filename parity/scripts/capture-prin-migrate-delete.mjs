#!/usr/bin/env node
// prin-migrate-delete: /poteto-mode introduce formatName while callers use
// formatNameLegacy. Observe leaf Read of
// principle-migrate-callers-then-delete-legacy-apis, migrate callers, and
// delete the legacy module in one wave with no permanent shim. Real PTY both sides.
//
// Evidence root: parity/evidence/principles/migrate-delete/
// Usage: node scripts/capture-prin-migrate-delete.mjs [--cursor-only|--pi-only|--both|--self-test]
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
const evidenceRoot = join(root, 'evidence', 'principles', 'migrate-delete');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const migSkillCursor = join(
  root,
  'reference',
  'cursor-plugins',
  'pstack',
  'skills',
  'principle-migrate-callers-then-delete-legacy-apis',
  'SKILL.md',
);
const migSkillPi = join(
  root,
  '..',
  'extensions',
  'pi-pstack',
  'skills',
  'principle-migrate-callers-then-delete-legacy-apis',
  'SKILL.md',
);
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;
const POLL_MS = 400;
const PRODUCT_REL = ['src/legacyFormat.js', 'src/greet.js', 'src/banner.js', 'src/format.js'];
const LEGACY_REL = 'src/legacyFormat.js';
const CALLER_REL = ['src/greet.js', 'src/banner.js'];
const VERIFY_OUT_REL = 'evidence/verify-out.txt';
const VERIFY_SCRIPT_REL = 'scripts/verify.mjs';
const BASELINE_REL = [
  'src/legacyFormat.js',
  'src/greet.js',
  'src/banner.js',
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

function migratePrompt(side) {
  const out = donePath(side);
  return (
    `/poteto-mode Introduce the formatName API described in NOTES.md. ` +
    `greet.js and banner.js still call formatNameLegacy. Migrate those callers and ` +
    `remove the old API in the same change so node scripts/verify.mjs prints MIGRATE-OK. ` +
    `Do not leave a permanent compatibility shim. ` +
    `For any poteto-mode principle you apply before declaring done, read that principle's ` +
    `leaf SKILL.md in full first (not only the poteto-mode Principles index). ` +
    `Work only inside this fixture cwd. Do not edit ledgers, parity/, or files outside ` +
    `this cwd except the named done path. ` +
    `When MIGRATE-OK is on disk, write exactly one line to ${out} as verified=yes|no, then stop.`
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

export function parseMigrateFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { ok: false, disableModelInvocation: null, name: null };
  const body = match[1];
  const name = (body.match(/^name:\s*(.+)$/m) || [])[1]?.trim() ?? null;
  const disableRaw = (body.match(/^disable-model-invocation:\s*(.+)$/m) || [])[1]?.trim() ?? null;
  const disableModelInvocation = disableRaw === 'true' ? true : disableRaw === 'false' ? false : null;
  return {
    ok: name === 'principle-migrate-callers-then-delete-legacy-apis' && disableModelInvocation === true,
    name,
    disableModelInvocation,
  };
}

function isMigrateSkillPath(p) {
  if (!p) return false;
  return /principle-migrate-callers-then-delete-legacy-apis[/\\]SKILL\.md/i.test(String(p));
}

function isLegacyPath(p) {
  if (!p) return false;
  return /src[/\\]legacyFormat\.js/i.test(String(p));
}

function isCallerPath(p) {
  if (!p) return false;
  return /src[/\\](greet|banner)\.js/i.test(String(p));
}

function isFormatPath(p) {
  if (!p) return false;
  return /src[/\\]format\.js/i.test(String(p));
}

function observeMigrateText(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  const potetoMode =
    /\/poteto-mode\b/i.test(hay) ||
    /\[skill\]\s*poteto-mode/i.test(hay) ||
    /\bUsed poteto-mode\b/i.test(hay);
  const leafChrome = /principle-migrate-callers-then-delete-legacy-apis[/\\]SKILL\.md/i.test(hay);
  const usedLeaf = /\bUsed principle-migrate-callers-then-delete-legacy-apis\b/i.test(hay);
  const skillBracketLeaf = /\[skill\]\s*principle-migrate-callers-then-delete-legacy-apis\b/i.test(hay);
  const hostAttached = Boolean(usedLeaf || skillBracketLeaf);
  const verifyMention =
    /scripts\/verify\.mjs/i.test(hay) ||
    /evidence\/verify-out\.txt/i.test(hay) ||
    /\bMIGRATE-OK\b/.test(hay) ||
    /\bMIGRATE-FAIL\b/.test(hay);
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
    if (/principle-migrate-callers-then-delete-legacy-apis[/\\]SKILL\.md/i.test(blob)) {
      calls.push({
        ts,
        name: 'blob-mention',
        args: { path: 'principle-migrate-callers-then-delete-legacy-apis/SKILL.md' },
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
    return /\b(tee|cat\s*>|sed\s+-i|perl\s+-i)\b/.test(cmd) && /src\/(greet|banner|format)\.js/.test(cmd);
  }
  return false;
}

function isDeleteLike(name, args) {
  if (/^(Delete|delete|delete_file|DeleteFile|rm|Remove)$/i.test(name)) return true;
  if (name === 'bash' || name === 'Shell') {
    const cmd = typeof args.command === 'string' ? args.command : '';
    return /\brm\b/.test(cmd) && /legacyFormat/.test(cmd);
  }
  return false;
}

function scoreCallsForMigrate(calls) {
  let leafSkillRead = false;
  let leafSkillReadAt = null;
  let ranVerifyScript = false;
  let firstLegacyDeleteAt = null;
  let firstCallerMigrateAt = null;
  let firstFormatWriteAt = null;
  const toolOrder = [];
  for (const call of calls) {
    const name = String(call.name || '');
    const args = call.args || {};
    const blob = JSON.stringify(args);
    const path = pathFromArgs(args);
    const isRead =
      /^(Read|read|read_file|ReadFile|cat|blob-mention)$/i.test(name) ||
      (name === 'bash' && typeof args.command === 'string' && /\bcat\b/.test(args.command));
    if (isRead && isMigrateSkillPath(path || blob)) {
      leafSkillRead = true;
      if (!leafSkillReadAt) leafSkillReadAt = call.ts || new Date().toISOString();
      toolOrder.push(`${name}(migrate-leaf)`);
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
    if (isDeleteLike(name, args) && (isLegacyPath(path) || isLegacyPath(blob))) {
      if (!firstLegacyDeleteAt) firstLegacyDeleteAt = call.ts || new Date().toISOString();
      toolOrder.push(`${name}(legacy-delete)`);
      continue;
    }
    if (isWriteLike(name, args) && (isCallerPath(path) || isCallerPath(blob))) {
      if (!firstCallerMigrateAt) firstCallerMigrateAt = call.ts || new Date().toISOString();
      toolOrder.push(`${name}(caller)`);
      continue;
    }
    if (isWriteLike(name, args) && (isFormatPath(path) || isFormatPath(blob))) {
      if (!firstFormatWriteAt) firstFormatWriteAt = call.ts || new Date().toISOString();
      toolOrder.push(`${name}(format)`);
      continue;
    }
    if (name) toolOrder.push(name);
  }
  const sameWave =
    Boolean(firstLegacyDeleteAt) &&
    (Boolean(firstCallerMigrateAt) || Boolean(firstFormatWriteAt));
  return {
    leafSkillRead,
    leafSkillReadAt,
    ranVerifyScript,
    firstLegacyDeleteAt,
    firstCallerMigrateAt,
    firstFormatWriteAt,
    sameWave,
    toolOrder: toolOrder.slice(0, 80),
  };
}

export function scoreMigrateDelete({
  frontmatter,
  done,
  verifyOut,
  productOk,
  legacyDeleted,
  callersMigrated,
  formatPresent,
  compatShim,
  sameWave,
  screenText,
  ptyText,
  sessionScore,
  transcriptScore,
  prompt,
}) {
  const screen = observeMigrateText(screenText, { ignorePromptSlice: prompt });
  const pty = observeMigrateText(ptyText, { ignorePromptSlice: prompt });
  const leafSkillRead = Boolean(
    sessionScore?.leafSkillRead ||
      transcriptScore?.leafSkillRead ||
      screen.leafChrome ||
      pty.leafChrome,
  );
  const usedChrome = Boolean(screen.hostAttached || pty.hostAttached || sessionScore?.hostAttached);
  const modelAutoInvoke = usedChrome && !leafSkillRead;
  const waveOk = Boolean(sameWave || sessionScore?.sameWave || transcriptScore?.sameWave);
  const keptVerifyOk = Boolean(verifyOut?.ok);
  const verifiedDone = /^verified=yes\b/i.test((done?.line || '').trim());
  const frontmatterOk = Boolean(frontmatter?.ok);
  const contractHeld =
    frontmatterOk &&
    leafSkillRead &&
    Boolean(legacyDeleted) &&
    Boolean(callersMigrated) &&
    Boolean(formatPresent) &&
    !compatShim &&
    waveOk &&
    productOk &&
    keptVerifyOk &&
    verifiedDone &&
    !modelAutoInvoke;
  return {
    frontmatterOk,
    leafSkillRead,
    usedChrome,
    modelAutoInvoke,
    legacyDeleted: Boolean(legacyDeleted),
    callersMigrated: Boolean(callersMigrated),
    formatPresent: Boolean(formatPresent),
    compatShim: Boolean(compatShim),
    sameWave: waveOk,
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
  await rm(join(fixtureApp, 'src', 'format.js'), { force: true });
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
  return { exists: true, path, line, ok: /^MIGRATE-OK\b/.test(line) };
}

async function diskOracle() {
  const legacyDeleted = !(await pathExists(join(fixtureApp, LEGACY_REL)));
  const formatPresent = await pathExists(join(fixtureApp, 'src', 'format.js'));
  let srcFiles = [];
  try {
    srcFiles = (await readdir(join(fixtureApp, 'src'))).filter((name) => name.endsWith('.js'));
  } catch {
    srcFiles = [];
  }
  let legacySymbol = false;
  let compatShim = false;
  let callersMigrated = true;
  for (const name of srcFiles) {
    const body = await readFile(join(fixtureApp, 'src', name), 'utf8');
    if (/\bformatNameLegacy\b/.test(body) || /\blegacyFormat\b/.test(body)) legacySymbol = true;
    if (/compat|shim|adapter/i.test(name)) compatShim = true;
    if (
      /\bformatNameLegacy\b/.test(body) &&
      /\bformatName\b/.test(body) &&
      /export\s+(?:function|const|\{)/.test(body)
    ) {
      compatShim = true;
    }
    if (CALLER_REL.some((rel) => rel.endsWith(name))) {
      if (!/\bformatName\b/.test(body) || /\bformatNameLegacy\b/.test(body)) callersMigrated = false;
    }
  }
  if (!formatPresent) callersMigrated = false;
  let greetOk = false;
  let bannerOk = false;
  try {
    const greetMod = await import(
      `${pathToFileURL(join(fixtureApp, 'src', 'greet.js')).href}?t=${Date.now()}`
    );
    const bannerMod = await import(
      `${pathToFileURL(join(fixtureApp, 'src', 'banner.js')).href}?t=${Date.now()}`
    );
    greetOk = greetMod.greet() === 'hello, WORLD';
    bannerOk = bannerMod.banner() === 'BANNER:TEAM';
  } catch {
    greetOk = false;
    bannerOk = false;
  }
  const productOk =
    greetOk && bannerOk && legacyDeleted && formatPresent && callersMigrated && !legacySymbol && !compatShim;
  return {
    greetOk,
    bannerOk,
    legacyDeleted,
    formatPresent,
    callersMigrated,
    legacySymbol,
    compatShim,
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
  const cursorText = await readFile(migSkillCursor, 'utf8');
  const piText = await readFile(migSkillPi, 'utf8');
  return {
    cursor: { path: migSkillCursor, ...parseMigrateFrontmatter(cursorText) },
    pi: { path: migSkillPi, ...parseMigrateFrontmatter(piText) },
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'prin-migrate-delete',
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
  const backupPath = `${referenceRulePath}.prin-migrate-delete-backup`;
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
      (/migrate-delete|greet|README|medium|Skill conflicts|Session TTL|fixture-app/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'migrate-delete-fixture-app';
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
  const scored = scoreCallsForMigrate(calls);
  const hostAttached =
    /\bUsed principle-migrate-callers-then-delete-legacy-apis\b/i.test(text) ||
    /\[skill\]\s*principle-migrate-callers-then-delete-legacy-apis\b/i.test(text);
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
          (text.includes(`migrate-delete/fixture-out/${side}/done.txt`) && text.includes('formatName'));
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
    const scored = scoreCallsForMigrate(extractToolCallsFromJsonl(text));
    const leafInBlob = /principle-migrate-callers-then-delete-legacy-apis[/\\]SKILL\.md/i.test(text);
    const merged = {
      path: hit.path,
      ...scored,
      leafSkillRead: scored.leafSkillRead || leafInBlob,
    };
    const rank =
      (merged.leafSkillRead ? 4 : 0) +
      (merged.ranVerifyScript ? 2 : 0) +
      (merged.sameWave ? 1 : 0);
    const bestRank = best
      ? (best.leafSkillRead ? 4 : 0) + (best.ranVerifyScript ? 2 : 0) + (best.sameWave ? 1 : 0)
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
      if (rel === LEGACY_REL && baseline[rel] != null) hits.deleted.push(rel);
      continue;
    }
    const dig = await fileDigest(abs);
    if (dig !== baseline[rel]) {
      hits.product.push(rel);
      if (CALLER_REL.includes(rel)) hits.callers.push(rel);
      if (rel === 'src/format.js') hits.format.push(rel);
    }
  }
  if (await pathExists(join(fixtureApp, VERIFY_OUT_REL))) hits.verify.push(VERIFY_OUT_REL);
  return { now, hits };
}

async function runSide(side, ruleBytes, ruleDigest, frontmatter) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.prin-migrate-delete-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await snapshotBaseline();
  await restoreProduct();
  const baseline = await baselineProduct();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = migratePrompt(side);
  const pollLog = [];
  let firstProductAt = null;
  let firstVerifyAt = null;
  let firstDeletedAt = null;
  let firstCallerAt = null;
  let firstFormatAt = null;
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
        for (const p of snap.hits.callers) {
          productPaths.add(`caller:${p}`);
          if (!firstCallerAt) firstCallerAt = snap.now;
        }
        for (const p of snap.hits.format) {
          productPaths.add(`format:${p}`);
          if (!firstFormatAt) firstFormatAt = snap.now;
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
          'greet.js',
          'banner.js',
          'format.js',
          'verify',
          'MIGRATE-OK',
          'MIGRATE-FAIL',
          'principle-migrate-callers-then-delete-legacy-apis',
          'legacyFormat',
          'formatName',
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
      const obs = observeMigrateText(lines.join('\n'), { ignorePromptSlice: prompt });
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
    for (const p of finalSnap.hits.callers) {
      productPaths.add(`caller:${p}`);
      if (!firstCallerAt) firstCallerAt = finalSnap.now;
    }
    for (const p of finalSnap.hits.format) {
      productPaths.add(`format:${p}`);
      if (!firstFormatAt) firstFormatAt = finalSnap.now;
    }
    if (finalSnap.hits.verify.length && !firstVerifyAt) firstVerifyAt = finalSnap.now;

    const ptyText = stripAnsi(outputBytes(attempt.events()).toString('utf8'));
    const screenText = (await screenLines(attempt, GEOMETRY)).join('\n');
    const done = await readDone(side);
    const verifyOut = await readVerifyOut();
    const oracle = await diskOracle();
    const pollSameWave =
      Boolean(firstDeletedAt) && (Boolean(firstCallerAt) || Boolean(firstFormatAt));

    let sessionScore = null;
    let transcriptScore = null;
    if (side === 'pi') {
      await sleep(500);
      sessionScore = await summarizePiSession(await findLatestPiSession());
    } else {
      transcriptScore = await summarizeCursorTranscripts(startedAt, side);
    }

    const score = scoreMigrateDelete({
      frontmatter: frontmatter[side],
      done,
      verifyOut,
      productOk: oracle.productOk,
      legacyDeleted: oracle.legacyDeleted,
      callersMigrated: oracle.callersMigrated,
      formatPresent: oracle.formatPresent,
      compatShim: oracle.compatShim,
      sameWave: pollSameWave,
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
      firstDeletedAt,
      firstCallerAt,
      firstFormatAt,
      productPaths: [...productPaths],
      done,
      verifyOut,
      oracle,
      productOk: oracle.productOk,
      frontmatter: frontmatter[side],
      session: sessionScore,
      transcript: transcriptScore,
      pollSamples: pollLog.length,
      screenFinal: observeMigrateText(screenText, { ignorePromptSlice: prompt }),
      pty: observeMigrateText(ptyText, { ignorePromptSlice: prompt }),
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
      'src/legacyFormat.js',
      'src/greet.js',
      'src/banner.js',
      'src/format.js',
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
    for (const rel of ['src/greet.js', 'src/banner.js', 'src/format.js', VERIFY_OUT_REL]) {
      const abs = join(fixtureApp, rel);
      if (!(await pathExists(abs))) continue;
      const dest = join(afterDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, await readFile(abs));
    }
    await writeFile(
      join(afterDir, 'legacy-absent.txt'),
      `${JSON.stringify({
        legacyGone: !(await pathExists(join(fixtureApp, LEGACY_REL))),
        formatPresent: await pathExists(join(fixtureApp, 'src', 'format.js')),
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
    name: 'principle-migrate-callers-then-delete-legacy-apis',
    disableModelInvocation: true,
  };
  const base = {
    frontmatter: fm,
    done: { exists: true, line: 'verified=yes' },
    verifyOut: {
      exists: true,
      line: 'MIGRATE-OK greet="hello, WORLD" banner="BANNER:TEAM" files=banner.js,format.js,greet.js',
      ok: true,
    },
    productOk: true,
    legacyDeleted: true,
    callersMigrated: true,
    formatPresent: true,
    compatShim: false,
    sameWave: true,
    screenText: 'Read principle-migrate-callers-then-delete-legacy-apis/SKILL.md then MIGRATE-OK',
    ptyText:
      'Used principle-migrate-callers-then-delete-legacy-apis\nprinciple-migrate-callers-then-delete-legacy-apis/SKILL.md',
    sessionScore: {
      leafSkillRead: true,
      ranVerifyScript: true,
      hostAttached: true,
      sameWave: true,
    },
    transcriptScore: null,
    prompt: migratePrompt('cursor'),
  };
  const pass = scoreMigrateDelete(base);
  const noLeaf = scoreMigrateDelete({
    ...base,
    screenText: 'MIGRATE-OK without leaf',
    ptyText: 'MIGRATE-OK',
    sessionScore: { leafSkillRead: false, ranVerifyScript: true, sameWave: true },
    transcriptScore: { leafSkillRead: false },
  });
  const autoInvoke = scoreMigrateDelete({
    ...base,
    screenText: 'Used principle-migrate-callers-then-delete-legacy-apis',
    ptyText: 'Used principle-migrate-callers-then-delete-legacy-apis',
    sessionScore: {
      leafSkillRead: false,
      ranVerifyScript: true,
      hostAttached: true,
      sameWave: true,
    },
    transcriptScore: { leafSkillRead: false },
  });
  const keptLegacy = scoreMigrateDelete({
    ...base,
    legacyDeleted: false,
    productOk: false,
    verifyOut: { exists: true, line: 'MIGRATE-FAIL', ok: false },
  });
  const shim = scoreMigrateDelete({
    ...base,
    compatShim: true,
    productOk: false,
  });
  const cases = [
    ['pass', pass.contractHeld === true && pass.legacyDeleted === true && pass.compatShim === false],
    ['noLeaf', noLeaf.contractHeld === false && noLeaf.leafSkillRead === false],
    ['autoInvoke', autoInvoke.contractHeld === false && autoInvoke.modelAutoInvoke === true],
    ['keptLegacy', keptLegacy.contractHeld === false && keptLegacy.legacyDeleted === false],
    ['shim', shim.contractHeld === false && shim.compatShim === true],
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
    console.error(JSON.stringify({ error: 'migrate-delete frontmatter not ok', frontmatter }, null, 2));
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
    `${JSON.stringify({ scenario: 'prin-migrate-delete', fixtureDigest: preDigest, frontmatter, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      scenario: 'prin-migrate-delete',
      fixtureDigest: preDigest,
      results: results.map((r) => ({
        side: r.side,
        attemptId: r.attemptId,
        contractHeld: r.observations.score.contractHeld,
        leafSkillRead: r.observations.score.leafSkillRead,
        legacyDeleted: r.observations.score.legacyDeleted,
        callersMigrated: r.observations.score.callersMigrated,
        compatShim: r.observations.score.compatShim,
        sameWave: r.observations.score.sameWave,
      })),
    }),
  );
}
