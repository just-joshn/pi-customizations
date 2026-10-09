#!/usr/bin/env node
// Parameterized Cursor+Pi pair for GitHub-bound cursor-team-kit skills.
// Uses disposable fixture repo just-joshn/team-kit-gh-fixture (cwd under
// parity/fixtures/team-kit-gh). Real PTY both sides. Oracle is on-disk
// STATUS + skill artifact (+ optional gh state checks).
//
// Usage:
//   node parity/scripts/capture-team-kit-gh-skill.mjs <skillId> [--cursor-only|--pi-only|--both]
// Evidence: parity/evidence/team-kit/
import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { sha256 } from '../recorder/files.mjs';
import { outputBytes, startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const execFileAsync = promisify(execFile);

const skillId = process.argv[2];
const only = process.argv[3] ?? '--both';
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'team-kit');
const fixtureRepo = join(root, 'fixtures', 'team-kit-gh');
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const GEOMETRY = { rows: 40, cols: 120 };
const SETTLE_MS = 900_000;
const FIXTURE_PR_URL = 'https://github.com/just-joshn/team-kit-gh-fixture/pull/1';
const FIXTURE_COMMENT_MARKER = 'FIXTURE_REVIEW_COMMENT';
const FIXTURE_GUIDANCE_MARKER = 'FIXTURE_REVIEW_GUIDANCE';

const SKILLS = {
  'get-pr-comments': {
    lockedSha: '8bf292736cab922276feb4d8377edc2fc4102a7beb62bcd1f3f5cf72a79b16cc',
    pairId: 'team-kit-get-pr-comments-1',
    scenarioRef: 'team-kit:get-pr-comments',
    artifactRel: 'summary.md',
    prompt(side, paths) {
      return (
        `/get-pr-comments Do not ask questions. Follow the get-pr-comments skill. ` +
        `Active PR is ${FIXTURE_PR_URL} on the current branch. ` +
        `Use gh to fetch review and discussion comments. ` +
        `Write a concise grouped action list to ${paths.artifact} that includes the exact marker ` +
        `${FIXTURE_COMMENT_MARKER} if that comment exists. ` +
        `Then write exactly one line to ${paths.done} as ` +
        `STATUS=verified|not-verified|inconclusive|env-blocked reason=<short phrase> and stop. ` +
        `Artifacts stay under ${paths.outRoot}. Do not edit parity ledgers. Do not force-push.`
      );
    },
    async postCheck(side, paths) {
      const text = (await readIfExists(paths.artifact)) || '';
      return {
        artifactHasMarker: text.includes(FIXTURE_COMMENT_MARKER),
        artifactBytes: text.length,
      };
    },
  },
  'make-pr-easy-to-review': {
    lockedSha: 'e8da0d4a85b7c04823698f539251617389f827fd9137100ef7eaea5dcc992fe7',
    pairId: 'team-kit-make-pr-easy-to-review-1',
    scenarioRef: 'team-kit:make-pr-easy-to-review',
    artifactRel: 'reviewer-notes.md',
    prompt(side, paths) {
      return (
        `/make-pr-easy-to-review Do not ask questions. Follow the make-pr-easy-to-review skill. ` +
        `Target PR ${FIXTURE_PR_URL}. Do not rewrite git history and do not force-push. ` +
        `Improve reviewability via PR description and notes only. ` +
        `Update the PR body with a TL;DR and include the exact marker ${FIXTURE_GUIDANCE_MARKER}. ` +
        `Also write ${paths.artifact} with the same guidance. ` +
        `Then write exactly one line to ${paths.done} as ` +
        `STATUS=verified|not-verified|inconclusive|env-blocked reason=<short phrase> and stop. ` +
        `Artifacts stay under ${paths.outRoot}. Do not edit parity ledgers.`
      );
    },
    async postCheck(side, paths) {
      const local = (await readIfExists(paths.artifact)) || '';
      let prBody = '';
      try {
        const { stdout } = await execFileAsync(
          'gh',
          ['pr', 'view', '1', '--repo', 'just-joshn/team-kit-gh-fixture', '--json', 'body', '-q', '.body'],
          { cwd: fixtureRepo, maxBuffer: 2_000_000 },
        );
        prBody = stdout;
      } catch (error) {
        prBody = `ERROR:${error.message}`;
      }
      return {
        artifactHasMarker: local.includes(FIXTURE_GUIDANCE_MARKER),
        prBodyHasMarker: prBody.includes(FIXTURE_GUIDANCE_MARKER),
        artifactBytes: local.length,
      };
    },
  },
  'new-branch-and-pr': {
    lockedSha: '4e8f502fcf48553949387a9a7f58b21349e0ff87c24bf8ff5c0013e9da6819fd',
    pairId: 'team-kit-new-branch-and-pr-1',
    scenarioRef: 'team-kit:new-branch-and-pr',
    artifactRel: 'pr-url.txt',
    prompt(side, paths) {
      const branch = `fixture/new-branch-${side}-${Date.now().toString(36)}`;
      return (
        `/new-branch-and-pr Do not ask questions. Follow the new-branch-and-pr skill. ` +
        `From this fixture repo, create branch ${branch} from latest main, ` +
        `make a tiny focused change (append one line to README.md mentioning ${side}), ` +
        `commit, push, and open a PR into main. ` +
        `Write the new PR URL alone to ${paths.artifact}. ` +
        `Then write exactly one line to ${paths.done} as ` +
        `STATUS=verified|not-verified|inconclusive|env-blocked reason=<short phrase> and stop. ` +
        `Artifacts stay under ${paths.outRoot}. Do not edit parity ledgers. Do not force-push.`
      );
    },
    async postCheck(side, paths) {
      const url = ((await readIfExists(paths.artifact)) || '').trim();
      let prExists = false;
      if (/^https:\/\/github\.com\/just-joshn\/team-kit-gh-fixture\/pull\/\d+/.test(url)) {
        try {
          await execFileAsync('gh', ['pr', 'view', url, '--json', 'url'], {
            cwd: fixtureRepo,
            maxBuffer: 1_000_000,
          });
          prExists = true;
        } catch {
          prExists = false;
        }
      }
      return { prUrl: url, prExists };
    },
  },
  'pr-review-canvas': {
    lockedSha: '88a07a2459197acba3c5e06b7d695e35ad618a998442b72d05cdba4efc117ac6',
    pairId: 'team-kit-pr-review-canvas-1',
    scenarioRef: 'team-kit:pr-review-canvas',
    artifactRel: 'review-canvas.html',
    seedExtraFiles: true,
    prompt(side, paths) {
      return (
        `/pr-review-canvas Do not ask questions. Follow the pr-review-canvas skill. ` +
        `Generate an interactive HTML review for ${FIXTURE_PR_URL}. ` +
        `Use gh api for PR metadata/files/comments. Inject styles.css and renderer.js from the skill directory. ` +
        `Write the final HTML to ${paths.artifact}. It must include the PR title or number and marker FIXTURE_CANVAS. ` +
        `Do not open a browser. When the HTML file is written with FIXTURE_CANVAS, write STATUS=verified. ` +
        `Then write exactly one line to ${paths.done} as ` +
        `STATUS=verified|not-verified|inconclusive|env-blocked reason=<short phrase> and stop. ` +
        `Artifacts stay under ${paths.outRoot}. Do not edit parity ledgers. Do not force-push.`
      );
    },
    async postCheck(side, paths) {
      const html = (await readIfExists(paths.artifact)) || '';
      return {
        artifactHasMarker: html.includes('FIXTURE_CANVAS'),
        hasHtmlStructure: /<html[\s>]/i.test(html) && /<body[\s>]/i.test(html),
        artifactBytes: html.length,
      };
    },
  },
  'review-and-ship': {
    lockedSha: '5c8e88c91e726e024c824d2b02be6bfc7ad81ac5e67c104ef2b66840715373c1',
    pairId: 'team-kit-review-and-ship-1',
    scenarioRef: 'team-kit:review-and-ship',
    artifactRel: 'ship-notes.md',
    useFreshBranch: true,
    prompt(side, paths) {
      const branch = `fixture/review-ship-${side}-${Date.now().toString(36)}`;
      return (
        `/review-and-ship Do not ask questions. Follow the review-and-ship skill. ` +
        `From main, create branch ${branch}, append one README.md line mentioning REVIEW_SHIP_${side}, ` +
        `commit, push, open a PR into main, and write findings plus the PR URL to ${paths.artifact}. ` +
        `Include marker FIXTURE_SHIP in ${paths.artifact}. ` +
        `Then write exactly one line to ${paths.done} as ` +
        `STATUS=verified|not-verified|inconclusive|env-blocked reason=<short phrase> and stop. ` +
        `Artifacts stay under ${paths.outRoot}. Do not edit parity ledgers. Do not force-push.`
      );
    },
    async postCheck(side, paths) {
      const text = (await readIfExists(paths.artifact)) || '';
      const urlMatch = text.match(
        /https:\/\/github\.com\/just-joshn\/team-kit-gh-fixture\/pull\/\d+/,
      );
      let prExists = false;
      if (urlMatch) {
        try {
          await execFileAsync('gh', ['pr', 'view', urlMatch[0], '--json', 'url'], {
            cwd: fixtureRepo,
            maxBuffer: 1_000_000,
          });
          prExists = true;
        } catch {
          prExists = false;
        }
      }
      return {
        artifactHasMarker: text.includes('FIXTURE_SHIP'),
        prUrl: urlMatch?.[0] ?? null,
        prExists,
        artifactBytes: text.length,
      };
    },
  },
  'fix-ci': {
    lockedSha: '925f8c3e11de8bcc0cd015ec907f4d00b12cde6714246554ed3a52e096536522',
    pairId: 'team-kit-fix-ci-1',
    scenarioRef: 'team-kit:fix-ci',
    artifactRel: 'ci-fix-notes.md',
    needsFailingPr: true,
    prompt(side, paths, ctx = {}) {
      const prUrl = ctx.failingPrUrl || FIXTURE_PR_URL;
      return (
        `/fix-ci Do not ask questions. Follow the fix-ci skill. ` +
        `Active PR is ${prUrl}. Inspect failing checks with gh pr checks. ` +
        `Apply the smallest fix so npm test passes, push, and re-check until green or report the blocker. ` +
        `Write iteration notes to ${paths.artifact} including marker FIXTURE_CI_FIX and the failing job name. ` +
        `Then write exactly one line to ${paths.done} as ` +
        `STATUS=verified|not-verified|inconclusive|env-blocked reason=<short phrase> and stop. ` +
        `Artifacts stay under ${paths.outRoot}. Do not edit parity ledgers. Do not force-push. Do not fabricate CI.`
      );
    },
    async postCheck(side, paths, ctx = {}) {
      const text = (await readIfExists(paths.artifact)) || '';
      let checksPass = false;
      let checkSummary = '';
      const pr = ctx.failingPrNumber;
      if (pr) {
        try {
          const { stdout } = await execFileAsync(
            'gh',
            ['pr', 'checks', String(pr), '--repo', 'just-joshn/team-kit-gh-fixture'],
            { cwd: fixtureRepo, maxBuffer: 2_000_000 },
          );
          checkSummary = stdout.trim();
          checksPass = /pass/i.test(stdout) && !/\bfail\b/i.test(stdout);
        } catch (error) {
          checkSummary = `ERROR:${error.message}`;
        }
      }
      return {
        artifactHasMarker: text.includes('FIXTURE_CI_FIX'),
        checksPass,
        checkSummary,
        artifactBytes: text.length,
      };
    },
  },
  'loop-on-ci': {
    lockedSha: '66b85dbd2bc3700386283539292a55438652bbe227271fd90b73b74525b9b9de',
    pairId: 'team-kit-loop-on-ci-1',
    scenarioRef: 'team-kit:loop-on-ci',
    artifactRel: 'ci-loop-notes.md',
    needsFailingPr: true,
    prompt(side, paths, ctx = {}) {
      const prUrl = ctx.failingPrUrl || FIXTURE_PR_URL;
      return (
        `/loop-on-ci Do not ask questions. Follow the loop-on-ci skill. ` +
        `Active PR is ${prUrl}. Use gh pr checks as source of truth. ` +
        `If failed, fix and push; if pending, watch. Loop until green or STATUS=env-blocked with measured blocker. ` +
        `Write loop notes to ${paths.artifact} including marker FIXTURE_CI_LOOP. ` +
        `Then write exactly one line to ${paths.done} as ` +
        `STATUS=verified|not-verified|inconclusive|env-blocked reason=<short phrase> and stop. ` +
        `Artifacts stay under ${paths.outRoot}. Do not edit parity ledgers. Do not force-push. Do not fabricate CI.`
      );
    },
    async postCheck(side, paths, ctx = {}) {
      const text = (await readIfExists(paths.artifact)) || '';
      let checksPass = false;
      let checkSummary = '';
      const pr = ctx.failingPrNumber;
      if (pr) {
        try {
          const { stdout } = await execFileAsync(
            'gh',
            ['pr', 'checks', String(pr), '--repo', 'just-joshn/team-kit-gh-fixture'],
            { cwd: fixtureRepo, maxBuffer: 2_000_000 },
          );
          checkSummary = stdout.trim();
          checksPass = /pass/i.test(stdout) && !/\bfail\b/i.test(stdout);
        } catch (error) {
          checkSummary = `ERROR:${error.message}`;
        }
      }
      return {
        artifactHasMarker: text.includes('FIXTURE_CI_LOOP'),
        checksPass,
        checkSummary,
        artifactBytes: text.length,
      };
    },
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stripAnsi = (text) =>
  text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(path) {
  if (!(await pathExists(path))) return null;
  return readFile(path, 'utf8');
}

function writeRootFor(side, skill) {
  return join(evidenceRoot, 'fixture-out', side, skill);
}

function donePath(side, skill) {
  return join(writeRootFor(side, skill), 'done.txt');
}

function artifactPath(side, skill, rel) {
  return join(writeRootFor(side, skill), rel);
}

function pathsFor(side, skillCfg) {
  const outRoot = writeRootFor(side, skillId);
  return {
    outRoot,
    done: donePath(side, skillId),
    artifact: artifactPath(side, skillId, skillCfg.artifactRel),
  };
}

async function readDone(side) {
  const path = donePath(side, skillId);
  if (!(await pathExists(path))) return { exists: false, path, line: null, status: null };
  const line = (await readFile(path, 'utf8')).trim();
  const m = line.match(/^STATUS=(verified|not-verified|inconclusive|env-blocked)\b/i);
  return { exists: true, path, line, status: m ? m[1].toLowerCase() : null };
}

function observeSkill(text, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  const skillRe = new RegExp(`\\b/?${skillId}\\b`, 'i');
  return {
    skillMention: skillRe.test(hay) || new RegExp(`\\[skill\\]\\s*${skillId}\\b`, 'i').test(hay),
    ghMention: /\bgh\b/i.test(hay) || /github\.com\/just-joshn\/team-kit-gh-fixture/i.test(hay),
    envBlocked: /\benv[- ]blocked\b/i.test(hay),
    working: /[\u2800-\u28FF]/.test(hay) || /\bWorking\b/.test(hay),
    fixtureComment: hay.includes(FIXTURE_COMMENT_MARKER),
    fixtureGuidance: hay.includes(FIXTURE_GUIDANCE_MARKER),
  };
}

function scoreSide({ done, screenObs, ptyObs, post }) {
  const skillPath = Boolean(screenObs?.skillMention) || Boolean(ptyObs?.skillMention);
  const envBlocked = done?.status === 'env-blocked' || Boolean(screenObs?.envBlocked);
  let artifactOk = false;
  if (skillId === 'get-pr-comments') artifactOk = Boolean(post?.artifactHasMarker);
  else if (skillId === 'make-pr-easy-to-review') {
    artifactOk = Boolean(post?.artifactHasMarker) || Boolean(post?.prBodyHasMarker);
  } else if (skillId === 'new-branch-and-pr') artifactOk = Boolean(post?.prExists);
  else if (skillId === 'pr-review-canvas') {
    artifactOk = Boolean(post?.artifactHasMarker) && Boolean(post?.hasHtmlStructure);
  } else if (skillId === 'review-and-ship') {
    artifactOk = Boolean(post?.artifactHasMarker) && Boolean(post?.prExists);
  } else if (skillId === 'fix-ci' || skillId === 'loop-on-ci') {
    artifactOk = Boolean(post?.artifactHasMarker) && Boolean(post?.checksPass);
  }
  const closed = Boolean(done?.status === 'verified' && skillPath && artifactOk);
  return {
    skillPath,
    envBlocked,
    doneStatus: done?.status ?? null,
    artifactOk,
    post: post ?? null,
    closed,
    honestBlocker: !closed && envBlocked,
  };
}

async function seedPiSkill(skillCfg) {
  const lockedDir = join(root, 'reference', 'cursor-plugins', 'cursor-team-kit', 'skills', skillId);
  const lockedSkill = join(lockedDir, 'SKILL.md');
  const destDir = join(fixtureRepo, '.pi', 'skills', skillId);
  const dest = join(destDir, 'SKILL.md');
  await mkdir(destDir, { recursive: true });
  await cp(lockedSkill, dest);
  if (skillCfg.seedExtraFiles) {
    for (const name of ['styles.css', 'renderer.js', 'template.html']) {
      const src = join(lockedDir, name);
      if (await pathExists(src)) await cp(src, join(destDir, name));
    }
  }
  const digest = (await sha256(dest)).replace(/^sha256:/, '');
  if (digest !== skillCfg.lockedSha) {
    throw new Error(`Seeded Pi ${skillId} hash ${digest} != locked ${skillCfg.lockedSha}`);
  }
  return { path: dest, sha256: digest };
}

async function cleanGenerated(side, skillCfg) {
  const out = writeRootFor(side, skillId);
  await mkdir(out, { recursive: true });
  await rm(donePath(side, skillId), { force: true });
  await rm(artifactPath(side, skillId, skillCfg.artifactRel), { force: true });
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side, skillId),
    side,
    scenarioRef: SKILLS[skillId].scenarioRef,
    fixtureRef: { path: fixturePath, digest: fixtureDigest },
    artifactPaths: [],
    launch: { argv, cwd, env },
    geometry: GEOMETRY,
  };
}

const cursorSpec = (fixtureDigest) =>
  spec({
    side: 'cursor',
    cwd: fixtureRepo,
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
    cwd: fixtureRepo,
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
  const backupPath = `${referenceRulePath}.team-kit-gh-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function ensurePiTrust() {
  const trustPath = join(piAgentDir, 'trust.json');
  let current = {};
  try {
    current = JSON.parse(await readFile(trustPath, 'utf8'));
  } catch {
    current = {};
  }
  if (current[fixtureRepo] === true) return;
  await mkdir(piAgentDir, { recursive: true });
  await writeFile(trustPath, `${JSON.stringify({ ...current, [fixtureRepo]: true }, null, 2)}\n`);
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
      (/claude-subscription|claude-sonnet/i.test(text) || /\$0\.\d+/.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function waitSkillSettled(attempt, side, timeoutMs, prompt) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let calm = 0;
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observeSkill(last.join('\n'), { ignorePromptSlice: prompt });
    const done = await readDone(side);
    const enough =
      done.status === 'verified' ||
      done.status === 'not-verified' ||
      done.status === 'inconclusive' ||
      done.status === 'env-blocked';
    if (enough && !obs.working) {
      calm += 1;
      if (calm >= 3) return last;
    } else {
      calm = 0;
    }
    await sleep(800);
  }
  return last;
}

async function ensureFixtureOnSeedBranch(skillCfg) {
  await execFileAsync('git', ['fetch', 'origin'], { cwd: fixtureRepo });
  if (
    skillId === 'new-branch-and-pr' ||
    skillCfg?.useFreshBranch ||
    skillCfg?.needsFailingPr
  ) {
    await execFileAsync('git', ['checkout', 'main'], { cwd: fixtureRepo });
    await execFileAsync('git', ['pull', '--ff-only', 'origin', 'main'], { cwd: fixtureRepo });
  } else {
    await execFileAsync('git', ['checkout', 'fixture/pr-comments-seed'], { cwd: fixtureRepo });
    await execFileAsync('git', ['pull', '--ff-only', 'origin', 'fixture/pr-comments-seed'], {
      cwd: fixtureRepo,
    });
  }
}

async function createFailingPr(side) {
  const branch = `fixture/fail-ci-${side}-${Date.now().toString(36)}`;
  await execFileAsync('git', ['checkout', 'main'], { cwd: fixtureRepo });
  await execFileAsync('git', ['pull', '--ff-only', 'origin', 'main'], { cwd: fixtureRepo });
  await execFileAsync('git', ['checkout', '-b', branch], { cwd: fixtureRepo });
  const helloPath = join(fixtureRepo, 'hello.js');
  const hello = await readFile(helloPath, 'utf8');
  let broken = hello;
  if (/VALUE\s*[:=]\s*\d+/.test(hello)) {
    broken = hello.replace(/VALUE\s*[:=]\s*\d+/, (m) => m.replace(/\d+/, '0'));
  } else {
    broken = "module.exports = { VALUE: 0, label: 'broken' };\n";
  }
  if (broken === hello) {
    broken = "module.exports = { VALUE: 0, label: 'broken-for-ci' };\n";
  }
  await writeFile(helloPath, broken);
  await execFileAsync('git', ['add', 'hello.js'], { cwd: fixtureRepo });
  await execFileAsync('git', ['commit', '-m', `fixture: break ci for ${skillId} ${side}`], {
    cwd: fixtureRepo,
  });
  await execFileAsync('git', ['push', '-u', 'origin', branch], { cwd: fixtureRepo });
  const { stdout: prUrl } = await execFileAsync(
    'gh',
    [
      'pr',
      'create',
      '--repo',
      'just-joshn/team-kit-gh-fixture',
      '--base',
      'main',
      '--head',
      branch,
      '--title',
      `fixture fail-ci ${skillId} ${side}`,
      '--body',
      `Intentional failing CI for ${skillId} pair capture (${side}).`,
    ],
    { cwd: fixtureRepo, maxBuffer: 1_000_000 },
  );
  const url = prUrl.trim();
  const number = Number(url.match(/\/pull\/(\d+)/)?.[1] || 0);
  const deadline = Date.now() + 300_000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFileAsync(
        'gh',
        ['pr', 'checks', String(number), '--repo', 'just-joshn/team-kit-gh-fixture'],
        { cwd: fixtureRepo, maxBuffer: 2_000_000 },
      );
      last = stdout;
    } catch (error) {
      // gh pr checks exits non-zero when any check fails; stdout still has the table.
      last = String(error.stdout || error.stderr || error.message || error);
      if (String(error.message || error).includes('Expected failing')) throw error;
    }
    if (/\bfail\b/i.test(last)) break;
    if (/pass/i.test(last) && !/pending|queued|in_progress|fail/i.test(last)) {
      throw new Error(`Expected failing checks on PR ${number}, got:\n${last}`);
    }
    await sleep(5000);
  }
  if (!/\bfail\b/i.test(last)) {
    throw new Error(`Timed out waiting for failing checks on ${url}. Last:\n${last}`);
  }
  return { failingPrUrl: url, failingPrNumber: number, branch, initialChecks: last };
}

async function runSide(side, ruleBytes, ruleDigest, skillCfg, sideCtx = {}) {
  const dir = join(evidenceRoot, side, skillId);
  const backupPath = `${referenceRulePath}.team-kit-gh-backup`;
  await mkdir(dir, { recursive: true });
  await ensureFixtureOnSeedBranch(skillCfg);
  let ctx = { ...sideCtx };
  if (skillCfg.needsFailingPr && !ctx.failingPrUrl) {
    ctx = { ...ctx, ...(await createFailingPr(side)) };
  } else if (ctx.branch) {
    await execFileAsync('git', ['checkout', ctx.branch], { cwd: fixtureRepo });
  }
  await cleanGenerated(side, skillCfg);
  let seeded = null;
  if (side === 'pi') seeded = await seedPiSkill(skillCfg);
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const paths = pathsFor(side, skillCfg);
  await mkdir(paths.outRoot, { recursive: true });
  const prompt = skillCfg.prompt(side, paths, ctx);
  const observations = {};
  let attempt;
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
          skillId,
          'STATUS=',
          'gh ',
          FIXTURE_COMMENT_MARKER,
          FIXTURE_GUIDANCE_MARKER,
          'FIXTURE_CANVAS',
          'FIXTURE_SHIP',
          'FIXTURE_CI_FIX',
          'FIXTURE_CI_LOOP',
          'pull/',
        ],
        300_000,
      );
    } catch {
      // settle may still land artifacts
    }
    await dumpScreen(attempt, dir, '03-signal', GEOMETRY);

    const settledLines = await waitSkillSettled(attempt, side, SETTLE_MS, prompt);
    try {
      await waitSettled(attempt, GEOMETRY, 60_000);
    } catch {
      // best-effort
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '04-settled', GEOMETRY);

    const finalLines = settledLines.length ? settledLines : await screenLines(attempt, GEOMETRY);
    const ptyText = Buffer.from(outputBytes(attempt.events())).toString('utf8');
    observations.screenFinal = observeSkill(finalLines.join('\n'), { ignorePromptSlice: prompt });
    observations.pty = observeSkill(ptyText, { ignorePromptSlice: prompt });
    observations.done = await readDone(side);
    observations.post = await skillCfg.postCheck(side, paths, ctx);
    observations.sideCtx = ctx;
    observations.seededSkill = seeded;
    observations.score = scoreSide({
      done: observations.done,
      screenObs: observations.screenFinal,
      ptyObs: observations.pty,
      post: observations.post,
    });

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, `prompt-${skillId}.txt`), `${prompt}\n`);
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
  }
}

async function loadSideFromDisk(side) {
  const obsPath = join(evidenceRoot, side, skillId, 'observations.json');
  if (!(await pathExists(obsPath))) return null;
  const observations = JSON.parse(await readFile(obsPath, 'utf8'));
  const sideRoot = join(evidenceRoot, side, skillId);
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(sideRoot, { withFileTypes: true });
  let attemptId = null;
  let attemptDir = null;
  let identity = null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const identPath = join(sideRoot, entry.name, 'identity.json');
    if (!(await pathExists(identPath))) continue;
    attemptId = entry.name;
    attemptDir = join(sideRoot, entry.name);
    identity = JSON.parse(await readFile(identPath, 'utf8'));
  }
  if (!attemptId) return null;
  return {
    side,
    attemptId,
    attemptDir,
    ruleUnchanged: true,
    afterDigest: identity?.fixtureRef?.digest ?? null,
    observations,
    identity,
  };
}

async function writePair(results, preDigest, lockedSkillDigest, skillCfg) {
  const bySide = Object.fromEntries(results.map((r) => [r.side, r]));
  if (!bySide.cursor) bySide.cursor = await loadSideFromDisk('cursor');
  if (!bySide.pi) bySide.pi = await loadSideFromDisk('pi');
  if (!bySide.cursor || !bySide.pi) return null;
  const cursor = bySide.cursor;
  const pi = bySide.pi;
  const bothClosed =
    Boolean(cursor.observations?.score?.closed) && Boolean(pi.observations?.score?.closed);
  const pair = {
    schema: 1,
    pairId: skillCfg.pairId,
    scenarioRef: skillCfg.scenarioRef,
    journeyFamily: 'cursor-team-kit',
    skillId,
    skillMdPath: `parity/reference/cursor-plugins/cursor-team-kit/skills/${skillId}/SKILL.md`,
    skillMdSha256: lockedSkillDigest,
    fixtureDigest: preDigest,
    fixturePrUrl: FIXTURE_PR_URL,
    fixtureRepo: 'https://github.com/just-joshn/team-kit-gh-fixture',
    steps: [
      { wait: 'ready screen (Tip: on Cursor; Pi chat ready without Trust dialog)' },
      { send: `/${skillId} ...` },
      { send: '\r' },
      { wait: 'STATUS=verified with skill artifact oracle, or STATUS=env-blocked' },
      { cancel: true },
    ],
    cursor: {
      attemptId: cursor.attemptId,
      dir: cursor.attemptDir,
      ruleUnchanged: cursor.ruleUnchanged,
      afterDigest: cursor.afterDigest,
      executable: cursor.identity?.executable ?? null,
      observedEnv: cursor.identity?.observedEnv ?? null,
      donePath: donePath('cursor', skillId),
      artifactPath: artifactPath('cursor', skillId, skillCfg.artifactRel),
      observations: cursor.observations?.score ?? null,
    },
    pi: {
      attemptId: pi.attemptId,
      dir: pi.attemptDir,
      ruleUnchanged: pi.ruleUnchanged,
      afterDigest: pi.afterDigest,
      executable: pi.identity?.executable ?? null,
      observedEnv: pi.identity?.observedEnv ?? null,
      donePath: donePath('pi', skillId),
      artifactPath: artifactPath('pi', skillId, skillCfg.artifactRel),
      seededSkill: pi.observations?.seededSkill ?? null,
      observations: pi.observations?.score ?? null,
    },
    skillClosure: {
      [skillId]: bothClosed ? 'closed_by_this_pair' : 'open',
    },
    note:
      'Cursor loads locked team-kit via --plugin-dir. Pi seeds the same SKILL.md bytes under .pi/skills/<skill>/. Fixture is disposable just-joshn/team-kit-gh-fixture. Full 18-skill closure is not claimed by this pair alone.',
    verdict: bothClosed ? 'pass' : 'fail',
  };
  const pairPath = join(evidenceRoot, `pair-${skillCfg.pairId}.json`);
  await writeFile(pairPath, `${JSON.stringify(pair, null, 2)}\n`, { flag: 'w' });
  return pairPath;
}

if (isMain) {
  if (!skillId || !SKILLS[skillId]) {
    console.error(
      `Usage: node parity/scripts/capture-team-kit-gh-skill.mjs <${Object.keys(SKILLS).join('|')}> [--cursor-only|--pi-only|--both]`,
    );
    process.exit(2);
  }
  const skillCfg = SKILLS[skillId];
  const lockedSkill = join(
    root,
    'reference',
    'cursor-plugins',
    'cursor-team-kit',
    'skills',
    skillId,
    'SKILL.md',
  );
  const preRule = await readFile(referenceRulePath, 'utf8');
  const preDigest = await sha256(referenceRulePath);
  if (preDigest !== LOCKED_FIXTURE_DIGEST) {
    console.error(
      `Reference rule digest ${preDigest} does not match the locked fixture ${LOCKED_FIXTURE_DIGEST}`,
    );
    process.exit(1);
  }
  const lockedSkillDigest = (await sha256(lockedSkill)).replace(/^sha256:/, '');
  if (lockedSkillDigest !== skillCfg.lockedSha) {
    console.error(`Locked ${skillId} SKILL.md hash drift: ${lockedSkillDigest}`);
    process.exit(1);
  }
  if (!(await pathExists(join(fixtureRepo, '.git')))) {
    console.error(`Fixture repo missing at ${fixtureRepo}`);
    process.exit(1);
  }

  const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
  const results = [];
  for (const side of sides) {
    const result = await runSide(side, preRule, preDigest, skillCfg);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  const pairPath = await writePair(results, preDigest, lockedSkillDigest, skillCfg);
  await writeFile(
    join(evidenceRoot, `capture-results-${skillId}.json`),
    `${JSON.stringify({ scenario: skillCfg.scenarioRef, fixtureDigest: preDigest, pairPath, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      scenario: skillCfg.scenarioRef,
      fixtureDigest: preDigest,
      pairPath,
      results: results.map((r) => ({
        side: r.side,
        attemptId: r.attemptId,
        closed: r.observations.score.closed,
        doneStatus: r.observations.score.doneStatus,
        skillPath: r.observations.score.skillPath,
        artifactOk: r.observations.score.artifactOk,
        honestBlocker: r.observations.score.honestBlocker,
        post: r.observations.score.post,
      })),
    }),
  );
}
