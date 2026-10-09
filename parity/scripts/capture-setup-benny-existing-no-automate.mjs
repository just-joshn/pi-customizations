#!/usr/bin/env node
// setup-benny-existing-no-automate: update path for existing Benny automations.
// Expect no /automate, editor checklist, no replacement/duplicate creates.
// Real PTY both sides via recorder. Do not fabricate Automations editor UI.
//
// Usage: node scripts/capture-setup-benny-existing-no-automate.mjs [--cursor-only|--pi-only|--both|--self-test]
// Evidence root: parity/evidence/setup-benny/existing-no-automate/
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { sha256 } from '../recorder/files.mjs';
import { outputBytes, startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const setupBennyRoot = join(root, 'evidence', 'setup-benny');
const evidenceRoot = join(setupBennyRoot, 'existing-no-automate');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const seedDir = join(evidenceRoot, 'seed');
const productRel = join('src', 'app.js');
const productAbs = join(fixtureApp, productRel);
const forAgentsRel = join('.upstream', 'automations', 'benny', 'FOR_AGENTS.md');
const setupSkillRel = join(
  '.upstream',
  'automations',
  'benny',
  'skills',
  'setup-benny',
  'SKILL.md',
);
const inventoryRel = join('.cursor', 'benny', 'existing-live-automations.json');
const inventoryAbs = join(fixtureApp, inventoryRel);
const configRel = join('.cursor', 'benny', 'configuration.yaml');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 900_000;
const POLL_MS = 500;

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

function setupPrompt(side) {
  const out = donePath(side);
  return (
    `Help set up Benny for this repository. ` +
    `Follow ${forAgentsRel} so ${setupSkillRel} is read (section 7 Prepare the live automations, Existing automations). ` +
    `Triage and repro automations already exist. Inventory stub: ${inventoryRel} ` +
    `(names benny-triage id auto_fixture_triage_001 and benny-reproduce id auto_fixture_repro_001). ` +
    `User-owned config is already at ${configRel}. ` +
    `I want to UPDATE the existing automations, not create new ones. ` +
    `Per setup-benny, do not use the built-in /automate skill to search for, inspect, or update existing automations. ` +
    `Finish any remaining validation, then give me the concise editor checklist from setup-benny for both triage and repro. ` +
    `Ask me to update each existing automation directly in its Automations editor. Do not create replacements or duplicates. ` +
    `This session is a CLI PTY. Do not fabricate an Automations editor UI or pretend you opened it. ` +
    `If the Automations editor cannot be opened here, still give the checklist and tell me to edit in the real editor. ` +
    `Do not edit parity ledgers or ${productRel}. Do not invent real cloud automation IDs. ` +
    `When you stop, write exactly one line to ${out} as ` +
    `STATUS=checklist-ok|used-automate|created-duplicate|editor-blocked|blocked|other reason=<short phrase> then stop.`
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

async function fileDigest(path) {
  if (!(await pathExists(path))) return null;
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null, status: null };
  const line = (await readFile(path, 'utf8')).trim();
  const m = line.match(
    /^STATUS=(checklist-ok|used-automate|created-duplicate|editor-blocked|blocked|other)\b/i,
  );
  return { exists: true, path, line, status: m ? m[1].toLowerCase() : null };
}

async function walkFiles(dir, out = []) {
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
      await walkFiles(abs, out);
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

async function snapshotAutomationRels() {
  const files = await walkFiles(join(fixtureApp, '.cursor', 'automations', 'benny'));
  return new Set(files.map((abs) => relative(fixtureApp, abs).split(sep).join('/')));
}

async function detectDuplicateCreates(fixtureRoot, beforeRelSet) {
  const dest = join(fixtureRoot, '.cursor', 'automations', 'benny');
  const files = await walkFiles(dest);
  const created = [];
  for (const abs of files) {
    const rel = relative(fixtureRoot, abs).split(sep).join('/');
    if (beforeRelSet.has(rel)) continue;
    if (/\.(md|ya?ml|json|jsonc|txt)$/i.test(rel)) created.push(rel);
  }
  // Also flag new live-looking drafts outside the pack inventory.
  const extrasRoot = join(fixtureRoot, '.cursor', 'automations');
  const all = await walkFiles(extrasRoot);
  for (const abs of all) {
    const rel = relative(fixtureRoot, abs).split(sep).join('/');
    if (rel.startsWith('.cursor/automations/benny/')) continue;
    if (beforeRelSet.has(rel)) continue;
    if (/benny-(triage|reproduce)/i.test(rel) || /automation/i.test(rel)) created.push(rel);
  }
  return created;
}

export function observeExistingNoAutomate(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  const invokeAutomate =
    /\[skill\]\s*automate\b/i.test(hay) ||
    /\bUsed\s+automate\b/i.test(hay) ||
    /\binvok(?:e|ed|ing)\s+(?:the\s+)?(?:built-in\s+)?(?:\/)?automate\b/i.test(hay) ||
    /skills\/automate\/SKILL\.md/i.test(hay) ||
    /\b(?:running|following|opening)\s+(?:the\s+)?(?:built-in\s+)?(?:\/)?automate\b/i.test(hay);
  const mentionAutomate = /\/automate\b/i.test(hay) || /\bautomate skill\b/i.test(hay);
  const refuseAutomate =
    /\bdo not use\b[^\n]{0,60}\/?automate\b/i.test(hay) ||
    /\bnot use\b[^\n]{0,60}\/?automate\b/i.test(hay) ||
    /\bcreation-only\b/i.test(hay) ||
    /\bwithout\b[^\n]{0,40}\/?automate\b/i.test(hay) ||
    /\bavoid\b[^\n]{0,40}\/?automate\b/i.test(hay);
  // Refuse language mentioning /automate is not a use. Tool/invoke chrome is.
  const usedAutomate = invokeAutomate || (mentionAutomate && !refuseAutomate);
  const automateUsedForUpdate = Boolean(invokeAutomate || (usedAutomate && !refuseAutomate));
  const checklistChrome =
    /\beditor checklist\b/i.test(hay) ||
    /\bchecklist\b/i.test(hay) ||
    (/\bName and description\b/i.test(hay) &&
      /\btriage-issue-reports\/SKILL\.md\b/i.test(hay) &&
      /\breproduce-and-fix-issues\/SKILL\.md\b/i.test(hay)) ||
    (/\bAutomations editor\b/i.test(hay) &&
      /\bbenny-triage\b/i.test(hay) &&
      /\bbenny-reproduce\b/i.test(hay));
  const askEditorUpdate =
    /\bAutomations editor\b/i.test(hay) ||
    /\bupdate each existing automation\b/i.test(hay) ||
    /\bedit each automation\b/i.test(hay) ||
    /\bupdate .+ in (?:its|the) Automations editor\b/i.test(hay);
  const noDuplicateChrome =
    /\bdo not create (?:replacements|duplicates)\b/i.test(hay) ||
    /\bwithout creating (?:replacements|duplicates)\b/i.test(hay) ||
    /\bno (?:replacements|duplicates)\b/i.test(hay);
  const editorBlockedChrome =
    /\bAutomations editor\b[^\n]{0,80}\b(unavailable|cannot|can't|not available|CLI|PTY)\b/i.test(
      hay,
    ) ||
    /\b(unavailable|cannot|can't|not available)\b[^\n]{0,80}\bAutomations editor\b/i.test(hay);
  return {
    usedAutomate,
    refuseAutomate,
    automateUsedForUpdate,
    checklistChrome,
    askEditorUpdate,
    noDuplicateChrome,
    editorBlockedChrome,
    working: /[\u2800-\u28FF]/.test(hay) || /\bWorking\b/.test(hay),
  };
}

export function scoreExistingNoAutomate({
  done,
  productBeforeDigest,
  productAfterDigest,
  screenText,
  ptyText,
  sessionSummary,
  transcriptSummary,
  prompt,
  inventoryIntact,
  duplicateCreated,
}) {
  const screen = observeExistingNoAutomate(screenText, { ignorePromptSlice: prompt });
  const pty = observeExistingNoAutomate(ptyText, { ignorePromptSlice: prompt });
  const productUnchanged =
    Boolean(productBeforeDigest) &&
    Boolean(productAfterDigest) &&
    productBeforeDigest === productAfterDigest;
  const automateHit = Boolean(
    sessionSummary?.automateUsed ||
      transcriptSummary?.automateUsed ||
      screen.automateUsedForUpdate ||
      pty.automateUsedForUpdate,
  );
  const checklist =
    Boolean(screen.checklistChrome || pty.checklistChrome) ||
    Boolean(sessionSummary?.checklistChrome) ||
    Boolean(transcriptSummary?.checklistChrome) ||
    done?.status === 'checklist-ok';
  const askEditor =
    Boolean(screen.askEditorUpdate || pty.askEditorUpdate) ||
    Boolean(sessionSummary?.askEditorUpdate) ||
    Boolean(transcriptSummary?.askEditorUpdate);
  const dup = Boolean(duplicateCreated?.length) || done?.status === 'created-duplicate';
  const statusUsedAutomate = done?.status === 'used-automate';
  const statusEditorBlocked = done?.status === 'editor-blocked';
  const statusChecklistOk = done?.status === 'checklist-ok';
  const statusBlocked = done?.status === 'blocked';

  let outcome = 'inconclusive';
  if (automateHit || statusUsedAutomate) {
    outcome = 'used_automate';
  } else if (dup) {
    outcome = 'created_duplicate';
  } else if (
    checklist &&
    askEditor &&
    inventoryIntact &&
    productUnchanged &&
    !automateHit &&
    !dup &&
    (statusChecklistOk || statusEditorBlocked || done?.exists)
  ) {
    // checklist-ok is preferred; editor-blocked with checklist still proves no-automate path
    outcome = statusEditorBlocked && !statusChecklistOk ? 'editor_blocked_with_checklist' : 'checklist_no_automate';
  } else if (statusEditorBlocked && !checklist) {
    outcome = 'env_blocker';
  } else if (statusBlocked) {
    outcome = 'blocked';
  } else if (checklist && !automateHit && !dup && productUnchanged && inventoryIntact) {
    outcome = 'checklist_no_automate';
  }

  if (statusChecklistOk && !automateHit && !dup && productUnchanged && inventoryIntact && checklist) {
    outcome = 'checklist_no_automate';
  }

  const contractHeld = outcome === 'checklist_no_automate' || outcome === 'editor_blocked_with_checklist';
  return {
    productUnchanged,
    inventoryIntact: Boolean(inventoryIntact),
    automateHit,
    checklist,
    askEditor,
    duplicateCreated: duplicateCreated || [],
    statusChecklistOk,
    statusUsedAutomate,
    statusEditorBlocked,
    statusBlocked,
    screen,
    pty,
    outcome,
    contractHeld,
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'setup-benny-existing-no-automate',
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
  const backupPath = `${referenceRulePath}.setup-benny-existing-no-automate-backup`;
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

async function restoreSeedFiles() {
  await mkdir(join(fixtureApp, '.cursor', 'benny'), { recursive: true });
  if (await pathExists(join(seedDir, 'existing-live-automations.json'))) {
    await copyFile(join(seedDir, 'existing-live-automations.json'), inventoryAbs);
  }
  if (await pathExists(join(seedDir, 'configuration.yaml'))) {
    await copyFile(join(seedDir, 'configuration.yaml'), join(fixtureApp, configRel));
  }
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
      (/fixture-app|Benny|benny|medium|Skill conflicts|README|setup|existing/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function findLatestPiSession() {
  const sessionsRoot = join(piAgentDir, 'sessions');
  const needle = 'existing-no-automate';
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
        if (!best || st.mtimeMs > best.ms) best = { path: abs, ms: st.mtimeMs };
      }
    }
  }
  await walk(sessionsRoot);
  return best?.path ?? null;
}

function summarizeToolBlob(text) {
  const obs = observeExistingNoAutomate(text);
  const toolPathHit = /skills\/automate\/SKILL\.md/i.test(text);
  return {
    automateUsed: Boolean(toolPathHit || obs.automateUsedForUpdate),
    checklistChrome: obs.checklistChrome,
    askEditorUpdate: obs.askEditorUpdate,
  };
}

async function summarizePiSession(sessionPath) {
  if (!sessionPath || !(await pathExists(sessionPath))) return null;
  const text = await readFile(sessionPath, 'utf8');
  const lines = text.split('\n').filter(Boolean);
  const toolOrder = [];
  let forAgentsRead = false;
  let setupBennyRead = false;
  let inventoryRead = false;
  let automateUsed = false;
  const assistantTexts = [];
  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = o.message || o;
    const role = msg.role || o.role;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    if (role === 'user') continue;
    for (const part of content) {
      if (part.type === 'toolCall' || part.type === 'tool_use') {
        const name = part.name || part.toolName || '';
        const args = part.arguments || part.input || {};
        const argBlob = JSON.stringify(args);
        let label = name;
        if (/FOR_AGENTS\.md/i.test(argBlob)) {
          forAgentsRead = true;
          label = `${name}(FOR_AGENTS.md)`;
        }
        if (/setup-benny\/SKILL\.md/i.test(argBlob)) {
          setupBennyRead = true;
          label = `${name}(setup-benny/SKILL.md)`;
        }
        if (/existing-live-automations\.json/i.test(argBlob)) {
          inventoryRead = true;
          label = `${name}(existing-live-automations.json)`;
        }
        if (/skills\/automate\/SKILL\.md/i.test(argBlob) || /\/automate\b/i.test(argBlob)) {
          automateUsed = true;
          label = `${name}(automate)`;
        }
        toolOrder.push(label);
      }
      if (part.type === 'text' && typeof part.text === 'string') {
        assistantTexts.push(part.text);
      }
    }
  }
  const joined = assistantTexts.join('\n\n');
  const chrome = summarizeToolBlob(`${text}\n${joined}`);
  return {
    sessionPath,
    forAgentsRead,
    setupBennyRead,
    inventoryRead,
    automateUsed: automateUsed || chrome.automateUsed,
    checklistChrome: chrome.checklistChrome,
    askEditorUpdate: chrome.askEditorUpdate,
    toolOrder: toolOrder.slice(0, 160),
    assistantJoined: joined,
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
          (text.includes(`existing-no-automate/fixture-out/${side}/done.txt`) &&
            text.includes('existing-live-automations'));
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
    const chrome = summarizeToolBlob(text);
    const setupBennyRead = /setup-benny\/SKILL\.md/i.test(text);
    const inventoryRead = /existing-live-automations\.json/i.test(text);
    const rank =
      (chrome.checklistChrome ? 4 : 0) +
      (chrome.askEditorUpdate ? 2 : 0) +
      (setupBennyRead ? 1 : 0) -
      (chrome.automateUsed ? 8 : 0);
    const bestRank = best
      ? (best.checklistChrome ? 4 : 0) +
        (best.askEditorUpdate ? 2 : 0) +
        (best.setupBennyRead ? 1 : 0) -
        (best.automateUsed ? 8 : 0)
      : -999;
    if (!best || rank > bestRank || (rank === bestRank && hit.mtimeMs > (best.mtimeMs || 0))) {
      best = {
        path: hit.path,
        mtimeMs: hit.mtimeMs,
        setupBennyRead,
        inventoryRead,
        ...chrome,
      };
    }
  }
  return best;
}

async function inventoryStillIntact() {
  if (!(await pathExists(inventoryAbs))) return false;
  const text = await readFile(inventoryAbs, 'utf8');
  return (
    /auto_fixture_triage_001/.test(text) &&
    /auto_fixture_repro_001/.test(text) &&
    /benny-triage/.test(text) &&
    /benny-reproduce/.test(text)
  );
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.setup-benny-existing-no-automate-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await restoreSeedFiles();
  if (side === 'pi') await ensurePiTrust();
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = setupPrompt(side);
  const productBeforeDigest = await fileDigest(productAbs);
  const beforeAutos = await snapshotAutomationRels();
  // Mark all current automation files as baseline (including sibling dirs if any)
  const allBefore = await walkFiles(join(fixtureApp, '.cursor', 'automations'));
  for (const abs of allBefore) {
    beforeAutos.add(relative(fixtureApp, abs).split(sep).join('/'));
  }
  const pollLog = [];
  let attempt;
  const startedAt = Date.now();
  try {
    if (!(await pathExists(join(fixtureApp, forAgentsRel)))) {
      throw new Error(`FOR_AGENTS missing at ${join(fixtureApp, forAgentsRel)}`);
    }
    if (!(await pathExists(join(fixtureApp, setupSkillRel)))) {
      throw new Error(`setup-benny skill missing at ${join(fixtureApp, setupSkillRel)}`);
    }
    if (!(await pathExists(inventoryAbs))) {
      throw new Error(`Existing automation inventory missing at ${inventoryAbs}`);
    }
    const liveDigest = await sha256(referenceRulePath);
    if (liveDigest !== LOCKED_FIXTURE_DIGEST) {
      throw new Error(
        `Aborting ${side}: reference rule digest ${liveDigest} != locked ${LOCKED_FIXTURE_DIGEST}`,
      );
    }
    await writeFile(rulePath, ruleBytes);
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
        const lines = await screenLines(attempt, GEOMETRY);
        const obs = observeExistingNoAutomate(lines.join('\n'), { ignorePromptSlice: prompt });
        const done = await readDone(side);
        if (
          obs.checklistChrome ||
          obs.automateUsedForUpdate ||
          obs.askEditorUpdate ||
          obs.editorBlockedChrome ||
          done.exists
        ) {
          pollLog.push({
            ts: new Date().toISOString(),
            ...obs,
            doneExists: done.exists,
            doneStatus: done.status,
            inventoryIntact: await inventoryStillIntact(),
            productDigest: await fileDigest(productAbs),
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
          'STATUS=',
          'checklist',
          'Automations editor',
          '/automate',
          'benny-triage',
          'benny-reproduce',
          'do not use',
          'creation-only',
        ],
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
      const obs = observeExistingNoAutomate(text, { ignorePromptSlice: prompt });
      if (done.exists && !obs.working) {
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

    stopPoll.abort();
    await pollLoop.catch(() => {});

    const settledText = (await screenLines(attempt, GEOMETRY)).join('\n');
    const ptyText = stripAnsi(outputBytes(attempt.events()).toString('utf8'));
    const done = await readDone(side);
    const productAfterDigest = await fileDigest(productAbs);
    const inventoryIntact = await inventoryStillIntact();
    const duplicateCreated = await detectDuplicateCreates(fixtureApp, beforeAutos);

    let sessionSummary = null;
    let transcriptSummary = null;
    if (side === 'pi') {
      await sleep(500);
      sessionSummary = await summarizePiSession(await findLatestPiSession());
    } else {
      transcriptSummary = await summarizeCursorTranscripts(startedAt, side);
    }

    const score = scoreExistingNoAutomate({
      done,
      productBeforeDigest,
      productAfterDigest,
      screenText: settledText,
      ptyText,
      sessionSummary,
      transcriptSummary,
      prompt,
      inventoryIntact,
      duplicateCreated,
    });

    const observations = {
      forAgentsRel,
      setupSkillRel,
      inventoryRel,
      productRel,
      productBeforeDigest,
      productAfterDigest,
      productUnchanged: score.productUnchanged,
      inventoryIntact: score.inventoryIntact,
      done,
      outcome: score.outcome,
      contractHeld: score.contractHeld,
      automateHit: score.automateHit,
      checklist: score.checklist,
      askEditor: score.askEditor,
      duplicateCreated: score.duplicateCreated,
      screen: score.screen,
      pty: score.pty,
      session: sessionSummary
        ? {
            sessionPath: sessionSummary.sessionPath,
            forAgentsRead: sessionSummary.forAgentsRead,
            setupBennyRead: sessionSummary.setupBennyRead,
            inventoryRead: sessionSummary.inventoryRead,
            automateUsed: sessionSummary.automateUsed,
            checklistChrome: sessionSummary.checklistChrome,
            askEditorUpdate: sessionSummary.askEditorUpdate,
            toolOrder: sessionSummary.toolOrder,
          }
        : null,
      transcript: transcriptSummary,
      pollSamples: pollLog.length,
      scorerNote:
        'checklist_no_automate requires checklist + ask-editor chrome, no /automate update path, inventory intact, no duplicate creates, product unchanged',
    };

    const afterRule = await readFile(rulePath, 'utf8');
    const afterRuleDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), afterRule);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
    await writeFile(join(dir, 'poll-log.json'), `${JSON.stringify(pollLog, null, 2)}\n`);
    if (done.exists) {
      await writeFile(join(dir, 'done-copy.txt'), `${done.line}\n`);
    }
    await writeFile(join(dir, 'inventory-copy.json'), await readFile(inventoryAbs));

    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      ruleUnchanged: afterRule === ruleBytes,
      afterDigest: afterRuleDigest,
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
    await restoreSeedFiles();
  }
}

async function selfTest() {
  const prompt = setupPrompt('cursor');
  const pass = scoreExistingNoAutomate({
    done: {
      exists: true,
      status: 'checklist-ok',
      line: 'STATUS=checklist-ok reason=gave editor checklist without automate',
    },
    productBeforeDigest: 'aaa',
    productAfterDigest: 'aaa',
    screenText:
      'Editor checklist for benny-triage and benny-reproduce. Update each in its Automations editor. Do not create duplicates. Name and description. triage-issue-reports/SKILL.md reproduce-and-fix-issues/SKILL.md',
    ptyText: 'creation-only. do not use /automate. Automations editor checklist',
    sessionSummary: { automateUsed: false, checklistChrome: true, askEditorUpdate: true },
    transcriptSummary: null,
    prompt,
    inventoryIntact: true,
    duplicateCreated: [],
  });
  const usedAuto = scoreExistingNoAutomate({
    done: { exists: true, status: 'used-automate', line: 'STATUS=used-automate reason=opened automate' },
    productBeforeDigest: 'aaa',
    productAfterDigest: 'aaa',
    screenText: 'Invoking /automate to update existing benny-triage',
    ptyText: 'Used automate',
    sessionSummary: { automateUsed: true },
    transcriptSummary: null,
    prompt,
    inventoryIntact: true,
    duplicateCreated: [],
  });
  const dup = scoreExistingNoAutomate({
    done: {
      exists: true,
      status: 'created-duplicate',
      line: 'STATUS=created-duplicate reason=new draft',
    },
    productBeforeDigest: 'aaa',
    productAfterDigest: 'aaa',
    screenText: 'Editor checklist Automations editor benny-triage benny-reproduce',
    ptyText: 'checklist',
    sessionSummary: { automateUsed: false, checklistChrome: true, askEditorUpdate: true },
    transcriptSummary: null,
    prompt,
    inventoryIntact: true,
    duplicateCreated: ['.cursor/automations/benny-triage-v2.yaml'],
  });
  const obsRefuse = observeExistingNoAutomate(
    'The built-in automate skill is creation-only. Do not use /automate to update existing automations. Editor checklist follows.',
    { ignorePromptSlice: prompt },
  );
  const cases = [
    ['pass', pass.contractHeld === true && pass.outcome === 'checklist_no_automate'],
    ['usedAuto', usedAuto.contractHeld === false && usedAuto.outcome === 'used_automate'],
    ['dup', dup.contractHeld === false && dup.outcome === 'created_duplicate'],
    ['refuseNotHit', obsRefuse.automateUsedForUpdate === false && obsRefuse.refuseAutomate === true],
  ];
  const failed = cases.filter(([, ok]) => !ok);
  console.log(JSON.stringify({ selfTest: failed.length === 0, cases, pass, usedAuto, dup, obsRefuse }, null, 2));
  if (failed.length) process.exit(1);
}

if (isMain && only === '--self-test') {
  await selfTest();
  process.exit(0);
}

if (isMain) {
  const preRule = await readFile(referenceRulePath, 'utf8');
  const preDigest = await sha256(referenceRulePath);
  if (preDigest !== LOCKED_FIXTURE_DIGEST) {
    console.error(
      `Reference rule digest ${preDigest} does not match the locked fixture ${LOCKED_FIXTURE_DIGEST}`,
    );
    process.exit(1);
  }
  if (!(await pathExists(join(fixtureApp, forAgentsRel)))) {
    console.error(`Fixture pack missing ${forAgentsRel}`);
    process.exit(1);
  }
  if (!(await pathExists(join(fixtureApp, setupSkillRel)))) {
    console.error(`Fixture pack missing ${setupSkillRel}`);
    process.exit(1);
  }
  if (!(await pathExists(inventoryAbs))) {
    console.error(`Fixture inventory missing ${inventoryRel}`);
    process.exit(1);
  }
  await mkdir(evidenceRoot, { recursive: true });
  await restoreSeedFiles();

  const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
  const results = [];
  for (const side of sides) {
    const result = await runSide(side, preRule, preDigest);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await writeFile(
    join(evidenceRoot, 'capture-results.json'),
    `${JSON.stringify({ scenario: 'setup-benny-existing-no-automate', fixtureDigest: preDigest, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      scenario: 'setup-benny-existing-no-automate',
      fixtureDigest: preDigest,
      results: results.map((r) => ({
        side: r.side,
        attemptId: r.attemptId,
        contractHeld: r.observations.contractHeld,
        outcome: r.observations.outcome,
        automateHit: r.observations.automateHit,
        checklist: r.observations.checklist,
      })),
    }),
  );
}
