#!/usr/bin/env node
// Parameterized team-kit local-skill pair capture.
// Cursor loads locked cursor-team-kit via --plugin-dir.
// Pi gets the same SKILL.md bytes seeded under .pi/skills/<skillId>/.
// Real PTY both sides. Oracle is on-disk done marker + skill-specific checks.
//
// Usage:
//   node parity/scripts/capture-team-kit-local-skill.mjs --skill=<id> [--cursor-only|--pi-only|--both]
// Evidence: parity/evidence/team-kit/
import { access, cp, mkdir, readFile, rename, rm, writeFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { sha256 } from '../recorder/files.mjs';
import { outputBytes, startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'team-kit');
const teamKitSkills = join(root, 'reference', 'cursor-plugins', 'cursor-team-kit', 'skills');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 900_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stripAnsi = (text) =>
  text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');

function parseArgs(argv) {
  let skill = null;
  let only = '--both';
  for (const arg of argv) {
    if (arg.startsWith('--skill=')) skill = arg.slice('--skill='.length);
    else if (arg === '--cursor-only' || arg === '--pi-only' || arg === '--both') only = arg;
  }
  return { skill, only };
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function runGit(cwd, args, env = {}) {
  const result = spawnSync('git', args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function writeRootFor(side, skillId) {
  const path = join(evidenceRoot, 'fixture-out', side, skillId);
  await mkdir(path, { recursive: true });
  return path;
}

function donePath(side, skillId) {
  return join(evidenceRoot, 'fixture-out', side, skillId, 'done.txt');
}

function summaryPath(side, skillId) {
  return join(evidenceRoot, 'fixture-out', side, skillId, 'summary.md');
}

async function readDone(side, skillId) {
  const path = donePath(side, skillId);
  if (!(await pathExists(path))) return { exists: false, path, line: null, status: null };
  const line = (await readFile(path, 'utf8')).trim();
  const m = line.match(/^STATUS=(verified|not-verified|inconclusive|env-blocked)\b/i);
  return { exists: true, path, line, status: m ? m[1].toLowerCase() : null };
}

function observeSkill(text, skillId, { ignorePromptSlice } = {}) {
  let hay = stripAnsi(text || '');
  if (ignorePromptSlice) hay = hay.split(ignorePromptSlice).join(' ');
  const escaped = skillId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const slash = new RegExp(`\\/${escaped}\\b`, 'i');
  const bare = new RegExp(`\\b${escaped}\\b`, 'i');
  const bracket = new RegExp(`\\[skill\\]\\s*${escaped}\\b`, 'i');
  return {
    skillMention: slash.test(hay) || bare.test(hay) || bracket.test(hay),
    envBlocked: /\benv[- ]blocked\b/i.test(hay),
    working: /[\u2800-\u28FF]/.test(hay) || /\bWorking\b/.test(hay),
  };
}

const SKILLS = {
  'check-compiler-errors': {
    lockedSha256: '1ad76beccd581fc285199334709e0a37cdc2f76e5d0d33c90e1dc21905518004',
    pairId: 'team-kit-check-compiler-errors-1',
    waitTokens: ['check-compiler-errors', 'STATUS=', 'typecheck', 'FIXED', 'error'],
    async seed(fixtureApp) {
      await mkdir(join(fixtureApp, 'src'), { recursive: true });
      await mkdir(join(fixtureApp, 'scripts'), { recursive: true });
      await writeFile(
        join(fixtureApp, 'package.json'),
        `${JSON.stringify(
          {
            name: 'team-kit-check-compiler-errors-fixture',
            private: true,
            type: 'module',
            scripts: { typecheck: 'node scripts/typecheck.mjs' },
          },
          null,
          2,
        )}\n`,
      );
      await writeFile(
        join(fixtureApp, 'scripts', 'typecheck.mjs'),
        `import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(import.meta.dirname, '..', 'src', 'broken.js'), 'utf8');
if (/VALUE\\s*=\\s*null\\s*;/.test(src)) {
  console.error('typecheck failed: VALUE must be a number, found null');
  process.exit(1);
}
if (!/VALUE\\s*=\\s*7\\s*;/.test(src)) {
  console.error('typecheck failed: VALUE must equal 7');
  process.exit(1);
}
console.log('typecheck ok');
`,
      );
      await writeFile(join(fixtureApp, 'src', 'broken.js'), 'export const VALUE = null;\n');
    },
    prompt(side, skillId, fixtureApp) {
      const outRoot = join(evidenceRoot, 'fixture-out', side, skillId);
      const done = donePath(side, skillId);
      const summary = summaryPath(side, skillId);
      return (
        `/check-compiler-errors Do not ask questions. Follow the check-compiler-errors skill. ` +
        `Workspace is ${fixtureApp}. Run npm run typecheck. Fix src/broken.js so typecheck passes ` +
        `(VALUE must be the number 7). Re-run until clean. Write a short error/fix summary to ${summary}. ` +
        `Then write exactly one line to ${done} as ` +
        `STATUS=verified|not-verified|inconclusive|env-blocked reason=<short phrase> and stop. ` +
        `Artifacts stay under ${outRoot}. Do not edit parity ledgers. Do not commit.`
      );
    },
    async oracle(side, skillId, fixtureApp) {
      const typecheck = spawnSync('npm', ['run', 'typecheck'], {
        cwd: fixtureApp,
        encoding: 'utf8',
      });
      const src = await readFile(join(fixtureApp, 'src', 'broken.js'), 'utf8');
      const summaryExists = await pathExists(summaryPath(side, skillId));
      const done = await readDone(side, skillId);
      const typecheckOk = typecheck.status === 0 && /VALUE\s*=\s*7\s*;/.test(src);
      return {
        typecheckOk,
        summaryExists,
        done,
        closed: Boolean(typecheckOk && summaryExists && done.status === 'verified'),
        honestBlocker: done.status === 'env-blocked',
      };
    },
  },
  'fix-merge-conflicts': {
    lockedSha256: '738b251281b30fd33e3892d0679cf94249e9c9e29e1bed40bcdde4a6aca98a76',
    pairId: 'team-kit-fix-merge-conflicts-1',
    waitTokens: ['fix-merge-conflicts', 'STATUS=', 'conflict', 'resolved'],
    async seed(fixtureApp) {
      await mkdir(fixtureApp, { recursive: true });
      runGit(fixtureApp, ['init']);
      runGit(fixtureApp, ['config', 'user.email', 'fixture@example.com']);
      runGit(fixtureApp, ['config', 'user.name', 'Fixture User']);
      await writeFile(join(fixtureApp, 'value.txt'), 'base\n');
      runGit(fixtureApp, ['add', 'value.txt']);
      runGit(fixtureApp, ['commit', '-m', 'base']);
      runGit(fixtureApp, ['branch', '-M', 'main']);
      runGit(fixtureApp, ['checkout', '-b', 'feature']);
      await writeFile(join(fixtureApp, 'value.txt'), 'feature-value\n');
      runGit(fixtureApp, ['add', 'value.txt']);
      runGit(fixtureApp, ['commit', '-m', 'feature']);
      runGit(fixtureApp, ['checkout', 'main']);
      await writeFile(join(fixtureApp, 'value.txt'), 'main-value\n');
      runGit(fixtureApp, ['add', 'value.txt']);
      runGit(fixtureApp, ['commit', '-m', 'main']);
      spawnSync('git', ['merge', 'feature', '--no-edit'], {
        cwd: fixtureApp,
        encoding: 'utf8',
      });
      const text = await readFile(join(fixtureApp, 'value.txt'), 'utf8');
      if (!text.includes('<<<<<<<')) {
        await writeFile(
          join(fixtureApp, 'value.txt'),
          '<<<<<<< HEAD\nmain-value\n=======\nfeature-value\n>>>>>>> feature\n',
        );
      }
    },
    prompt(side, skillId, fixtureApp) {
      const outRoot = join(evidenceRoot, 'fixture-out', side, skillId);
      const done = donePath(side, skillId);
      const summary = summaryPath(side, skillId);
      return (
        `/fix-merge-conflicts Do not ask questions. Follow the fix-merge-conflicts skill. ` +
        `Workspace is ${fixtureApp}. Resolve conflict markers in value.txt. ` +
        `Final file content must be exactly one line: resolved-value ` +
        `(no conflict markers). Do not push. Write a short resolution summary to ${summary}. ` +
        `Then write exactly one line to ${done} as ` +
        `STATUS=verified|not-verified|inconclusive|env-blocked reason=<short phrase> and stop. ` +
        `Artifacts stay under ${outRoot}. Do not edit parity ledgers. Do not commit unless staging resolution requires it; prefer writing the resolved file and summarizing.`
      );
    },
    async oracle(side, skillId, fixtureApp) {
      const text = await readFile(join(fixtureApp, 'value.txt'), 'utf8');
      const markersGone = !/^(<<<<<<<|=======|>>>>>>>)/m.test(text);
      const exact = text.trim() === 'resolved-value';
      const summaryExists = await pathExists(summaryPath(side, skillId));
      const done = await readDone(side, skillId);
      return {
        markersGone,
        exact,
        summaryExists,
        done,
        closed: Boolean(markersGone && exact && summaryExists && done.status === 'verified'),
        honestBlocker: done.status === 'env-blocked',
      };
    },
  },
  deslop: {
    lockedSha256: '2f7b7def74af7ed11f5b44b4d32f0f91fca8c5d1f92bf2171e8d12fd33a0f810',
    pairId: 'team-kit-deslop-1',
    waitTokens: ['deslop', 'STATUS=', 'slop', 'cleaned'],
    async seed(fixtureApp) {
      await mkdir(join(fixtureApp, 'src'), { recursive: true });
      runGit(fixtureApp, ['init']);
      runGit(fixtureApp, ['config', 'user.email', 'fixture@example.com']);
      runGit(fixtureApp, ['config', 'user.name', 'Fixture User']);
      await writeFile(
        join(fixtureApp, 'src', 'util.js'),
        'export function double(n) {\n  return n * 2;\n}\n',
      );
      runGit(fixtureApp, ['add', 'src/util.js']);
      runGit(fixtureApp, ['commit', '-m', 'clean util']);
      runGit(fixtureApp, ['branch', '-M', 'main']);
      runGit(fixtureApp, ['checkout', '-b', 'slop-branch']);
      await writeFile(
        join(fixtureApp, 'src', 'util.js'),
        [
          '// This helper function doubles the provided numeric input value for convenience',
          'export function double(n) {',
          '  // Defensive check in case n is somehow not a number',
          '  try {',
          '    const value = /** @type {any} */ (n);',
          '    return value * 2;',
          '  } catch (error) {',
          '    // Unexpected, but keep going',
          '    return 0;',
          '  }',
          '}',
          '',
        ].join('\n'),
      );
    },
    prompt(side, skillId, fixtureApp) {
      const outRoot = join(evidenceRoot, 'fixture-out', side, skillId);
      const done = donePath(side, skillId);
      const summary = summaryPath(side, skillId);
      return (
        `/deslop Do not ask questions. Follow the deslop skill. ` +
        `Workspace is ${fixtureApp}. Diff against main and remove AI slop from src/util.js. ` +
        `Restore a minimal double(n) implementation without the try/catch, without @type any, ` +
        `and without the explanatory comments. Keep behavior double(n)=n*2. ` +
        `Write a 1-3 sentence summary to ${summary}. ` +
        `Then write exactly one line to ${done} as ` +
        `STATUS=verified|not-verified|inconclusive|env-blocked reason=<short phrase> and stop. ` +
        `Artifacts stay under ${outRoot}. Do not edit parity ledgers. Do not commit.`
      );
    },
    async oracle(side, skillId, fixtureApp) {
      const text = await readFile(join(fixtureApp, 'src', 'util.js'), 'utf8');
      const slopGone =
        !/try\s*\{/.test(text) &&
        !/@type\s*\{any\}/.test(text) &&
        !/This helper function doubles/.test(text) &&
        !/Defensive check/.test(text);
      const keepsBehavior = /return\s+n\s*\*\s*2/.test(text) || /return\s+n\*2/.test(text);
      const summaryExists = await pathExists(summaryPath(side, skillId));
      const done = await readDone(side, skillId);
      return {
        slopGone,
        keepsBehavior,
        summaryExists,
        done,
        closed: Boolean(slopGone && keepsBehavior && summaryExists && done.status === 'verified'),
        honestBlocker: done.status === 'env-blocked',
      };
    },
  },
  'control-cli': {
    lockedSha256: '13ac93e595bbda2000849bdb815d5f2ca03f7c2ca63788c8335f9212b9b422a2',
    pairId: 'team-kit-control-cli-1',
    waitTokens: ['control-cli', 'STATUS=', 'PONG', 'transcript', 'tmux'],
    async seed(fixtureApp) {
      await mkdir(fixtureApp, { recursive: true });
      await writeFile(
        join(fixtureApp, 'toy-cli.mjs'),
        `import readline from 'node:readline';
process.stdout.write('READY\\n');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('line', (line) => {
  if (line.trim() === 'ping') {
    process.stdout.write('PONG\\n');
    rl.close();
    process.exit(0);
  }
});
`,
      );
    },
    prompt(side, skillId, fixtureApp) {
      const outRoot = join(evidenceRoot, 'fixture-out', side, skillId);
      const done = donePath(side, skillId);
      const summary = summaryPath(side, skillId);
      const transcript = join(outRoot, 'transcript.txt');
      return (
        `/control-cli Do not ask questions. Follow the control-cli skill. ` +
        `Build a temporary local harness (tmux or PTY) under /tmp to drive ` +
        `node ${join(fixtureApp, 'toy-cli.mjs')}. Wait for READY, send ping, capture PONG. ` +
        `Save the transcript to ${transcript}. Write a short harness summary to ${summary}. ` +
        `Then write exactly one line to ${done} as ` +
        `STATUS=verified|not-verified|inconclusive|env-blocked reason=<short phrase> and stop. ` +
        `Artifacts stay under ${outRoot}. Do not edit parity ledgers.`
      );
    },
    async oracle(side, skillId) {
      const outRoot = join(evidenceRoot, 'fixture-out', side, skillId);
      const transcriptPath = join(outRoot, 'transcript.txt');
      const summaryExists = await pathExists(summaryPath(side, skillId));
      const done = await readDone(side, skillId);
      let transcriptOk = false;
      if (await pathExists(transcriptPath)) {
        const t = await readFile(transcriptPath, 'utf8');
        transcriptOk = /\bREADY\b/.test(t) && /\bPONG\b/.test(t);
      }
      return {
        transcriptOk,
        summaryExists,
        done,
        closed: Boolean(transcriptOk && summaryExists && done.status === 'verified'),
        honestBlocker: done.status === 'env-blocked',
      };
    },
  },
  'what-did-i-get-done': {
    lockedSha256: '479813c9abaacb5b6b0531f1de7dc5eb2f3bd9673707a992d1073335836e82f8',
    pairId: 'team-kit-what-did-i-get-done-1',
    waitTokens: ['what-did-i-get-done', 'STATUS=', 'summary', 'ALPHA'],
    async seed(fixtureApp) {
      await mkdir(fixtureApp, { recursive: true });
      runGit(fixtureApp, ['init']);
      runGit(fixtureApp, ['config', 'user.email', 'worker@example.com']);
      runGit(fixtureApp, ['config', 'user.name', 'Worker']);
      try {
        runGit(fixtureApp, ['branch', '-M', 'main']);
      } catch {
        // ignore
      }
      const env = {
        GIT_AUTHOR_DATE: '2026-10-07T12:00:00',
        GIT_COMMITTER_DATE: '2026-10-07T12:00:00',
      };
      await writeFile(join(fixtureApp, 'alpha.txt'), 'alpha\n');
      runGit(fixtureApp, ['add', 'alpha.txt'], env);
      runGit(fixtureApp, ['commit', '-m', 'ship ALPHA feature'], env);
      await writeFile(join(fixtureApp, 'beta.txt'), 'beta\n');
      runGit(
        fixtureApp,
        ['add', 'beta.txt'],
        { GIT_AUTHOR_DATE: '2026-10-08T12:00:00', GIT_COMMITTER_DATE: '2026-10-08T12:00:00' },
      );
      runGit(
        fixtureApp,
        ['commit', '-m', 'ship BETA polish'],
        { GIT_AUTHOR_DATE: '2026-10-08T12:00:00', GIT_COMMITTER_DATE: '2026-10-08T12:00:00' },
      );
    },
    prompt(side, skillId, fixtureApp) {
      const outRoot = join(evidenceRoot, 'fixture-out', side, skillId);
      const done = donePath(side, skillId);
      const summary = summaryPath(side, skillId);
      return (
        `/what-did-i-get-done Do not ask questions. Follow the what-did-i-get-done skill. ` +
        `Workspace is ${fixtureApp}. Summarize authored commits for the last 7 days. ` +
        `Write the status update to ${summary}. It must include the real date range used and mention ALPHA. ` +
        `Then write exactly one line to ${done} as ` +
        `STATUS=verified|not-verified|inconclusive|env-blocked reason=<short phrase> and stop. ` +
        `Artifacts stay under ${outRoot}. Do not edit parity ledgers.`
      );
    },
    async oracle(side, skillId) {
      const summaryFile = summaryPath(side, skillId);
      const summaryExists = await pathExists(summaryFile);
      const done = await readDone(side, skillId);
      let mentionsAlpha = false;
      let hasRange = false;
      if (summaryExists) {
        const text = await readFile(summaryFile, 'utf8');
        mentionsAlpha = /\bALPHA\b/.test(text);
        hasRange = /\d{4}-\d{2}-\d{2}/.test(text) || /last\s+7\s+days/i.test(text);
      }
      return {
        summaryExists,
        mentionsAlpha,
        hasRange,
        done,
        closed: Boolean(summaryExists && mentionsAlpha && hasRange && done.status === 'verified'),
        honestBlocker: done.status === 'env-blocked',
      };
    },
  },
  'weekly-review': {
    lockedSha256: 'b56a2c283916b4551aeb322398ab99a19b4b5d7678ffd7f9c9f3df9fa05f4712',
    pairId: 'team-kit-weekly-review-1',
    waitTokens: ['weekly-review', 'STATUS=', 'bug', 'tech debt', 'net-new'],
    async seed(fixtureApp) {
      return SKILLS['what-did-i-get-done'].seed(fixtureApp);
    },
    prompt(side, skillId, fixtureApp) {
      const outRoot = join(evidenceRoot, 'fixture-out', side, skillId);
      const done = donePath(side, skillId);
      const summary = summaryPath(side, skillId);
      return (
        `/weekly-review Do not ask questions. Follow the weekly-review skill. ` +
        `Workspace is ${fixtureApp}. Produce the weekly recap for authored commits. ` +
        `Write it to ${summary}. Include 2-5 bullets and a short classification paragraph covering ` +
        `bug fixes, tech debt, and net-new work. Mention ALPHA. ` +
        `Then write exactly one line to ${done} as ` +
        `STATUS=verified|not-verified|inconclusive|env-blocked reason=<short phrase> and stop. ` +
        `Artifacts stay under ${outRoot}. Do not edit parity ledgers.`
      );
    },
    async oracle(side, skillId) {
      const summaryFile = summaryPath(side, skillId);
      const summaryExists = await pathExists(summaryFile);
      const done = await readDone(side, skillId);
      let mentionsAlpha = false;
      let hasClass = false;
      if (summaryExists) {
        const text = await readFile(summaryFile, 'utf8');
        mentionsAlpha = /\bALPHA\b/.test(text);
        hasClass =
          /bug/i.test(text) && (/tech\s*debt/i.test(text) || /debt/i.test(text)) && /net[- ]?new/i.test(text);
      }
      return {
        summaryExists,
        mentionsAlpha,
        hasClass,
        done,
        closed: Boolean(summaryExists && mentionsAlpha && hasClass && done.status === 'verified'),
        honestBlocker: done.status === 'env-blocked',
      };
    },
  },
  'thermo-nuclear-code-quality-review': {
    lockedSha256: '7faca08b51b643b2ddd0836f92af15574444024685dcc1e677dbbb39ae8c9e8f',
    pairId: 'team-kit-thermo-nuclear-code-quality-review-1',
    waitTokens: ['thermo-nuclear', 'STATUS=', 'judo', 'maintainability', 'review'],
    async seed(fixtureApp) {
      await mkdir(join(fixtureApp, 'src'), { recursive: true });
      runGit(fixtureApp, ['init']);
      runGit(fixtureApp, ['config', 'user.email', 'fixture@example.com']);
      runGit(fixtureApp, ['config', 'user.name', 'Fixture User']);
      await writeFile(
        join(fixtureApp, 'src', 'process.js'),
        'export function processItem(item) {\n  return item;\n}\n',
      );
      runGit(fixtureApp, ['add', 'src/process.js']);
      runGit(fixtureApp, ['commit', '-m', 'base']);
      runGit(fixtureApp, ['branch', '-M', 'main']);
      runGit(fixtureApp, ['checkout', '-b', 'messy']);
      await writeFile(
        join(fixtureApp, 'src', 'process.js'),
        [
          'export function processItem(item) {',
          '  let result = item;',
          '  if (item != null) {',
          '    if (typeof item === "object") {',
          '      if (item.kind === "a") {',
          '        if (item.value > 0) {',
          '          result = { ...item, value: item.value + 1 };',
          '        } else {',
          '          result = { ...item, value: 0 };',
          '        }',
          '      } else if (item.kind === "b") {',
          '        if (item.value > 0) {',
          '          result = { ...item, value: item.value + 2 };',
          '        } else {',
          '          result = { ...item, value: 0 };',
          '        }',
          '      } else {',
          '        result = item;',
          '      }',
          '    }',
          '  }',
          '  return result;',
          '}',
          '',
        ].join('\n'),
      );
    },
    prompt(side, skillId, fixtureApp) {
      const outRoot = join(evidenceRoot, 'fixture-out', side, skillId);
      const done = donePath(side, skillId);
      const summary = summaryPath(side, skillId);
      return (
        `/thermo-nuclear-code-quality-review Do not ask questions. Follow the thermo-nuclear-code-quality-review skill. ` +
        `Workspace is ${fixtureApp}. Review the current branch diff against main for src/process.js. ` +
        `Write the review to ${summary}. The review must mention spaghetti or nested conditionals ` +
        `and propose at least one structural simplification (code judo). Do not edit source files. ` +
        `Then write exactly one line to ${done} as ` +
        `STATUS=verified|not-verified|inconclusive|env-blocked reason=<short phrase> and stop. ` +
        `Artifacts stay under ${outRoot}. Do not edit parity ledgers.`
      );
    },
    async oracle(side, skillId) {
      const summaryFile = summaryPath(side, skillId);
      const summaryExists = await pathExists(summaryFile);
      const done = await readDone(side, skillId);
      let mentionsNest = false;
      let proposesSimplify = false;
      if (summaryExists) {
        const text = await readFile(summaryFile, 'utf8');
        mentionsNest = /spaghetti|nested|conditionals?/i.test(text);
        proposesSimplify = /simplif|extract|lookup|table|map|judo|restructur/i.test(text);
      }
      return {
        summaryExists,
        mentionsNest,
        proposesSimplify,
        done,
        closed: Boolean(
          summaryExists && mentionsNest && proposesSimplify && done.status === 'verified',
        ),
        honestBlocker: done.status === 'env-blocked',
      };
    },
  },
  'run-smoke-tests': {
    lockedSha256: '848c9f34af50f8a0edecbdc239707b694f5f9ac497c61b5907f2bf0caa1372fb',
    pairId: 'team-kit-run-smoke-tests-1',
    waitTokens: ['run-smoke-tests', 'STATUS=', 'smoketest', 'SMOKE_OK'],
    async seed(fixtureApp) {
      await mkdir(join(fixtureApp, 'scripts'), { recursive: true });
      await writeFile(
        join(fixtureApp, 'package.json'),
        `${JSON.stringify(
          {
            name: 'team-kit-run-smoke-tests-fixture',
            private: true,
            type: 'module',
            scripts: { smoketest: 'node scripts/smoketest.mjs' },
          },
          null,
          2,
        )}\n`,
      );
      await writeFile(join(fixtureApp, 'app.js'), 'export const ready = false;\n');
      await writeFile(
        join(fixtureApp, 'scripts', 'smoketest.mjs'),
        `import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(import.meta.dirname, '..', 'app.js'), 'utf8');
if (!/export\\s+const\\s+ready\\s*=\\s*true\\s*;/.test(src)) {
  console.error('smoketest failed: ready must be true');
  process.exit(1);
}
console.log('SMOKE_OK');
`,
      );
    },
    prompt(side, skillId, fixtureApp) {
      const outRoot = join(evidenceRoot, 'fixture-out', side, skillId);
      const done = donePath(side, skillId);
      const summary = summaryPath(side, skillId);
      return (
        `/run-smoke-tests Do not ask questions. Follow the run-smoke-tests skill. ` +
        `Workspace is ${fixtureApp}. Run npm run smoketest. It currently fails. ` +
        `Apply a minimal fix so ready is true, rerun until SMOKE_OK, and write the results summary to ${summary}. ` +
        `Then write exactly one line to ${done} as ` +
        `STATUS=verified|not-verified|inconclusive|env-blocked reason=<short phrase> and stop. ` +
        `Artifacts stay under ${outRoot}. Do not edit parity ledgers.`
      );
    },
    async oracle(side, skillId, fixtureApp) {
      const app = await readFile(join(fixtureApp, 'app.js'), 'utf8');
      const fixed = /export\s+const\s+ready\s*=\s*true\s*;/.test(app);
      const summaryExists = await pathExists(summaryPath(side, skillId));
      const done = await readDone(side, skillId);
      let mentionsSmoke = false;
      if (summaryExists) {
        const text = await readFile(summaryPath(side, skillId), 'utf8');
        mentionsSmoke = /SMOKE_OK|smoketest|pass/i.test(text);
      }
      return {
        fixed,
        summaryExists,
        mentionsSmoke,
        done,
        closed: Boolean(fixed && summaryExists && mentionsSmoke && done.status === 'verified'),
        honestBlocker: done.status === 'env-blocked',
      };
    },
  },
  'control-ui': {
    lockedSha256: '410cae25bdb1e5d2323b126abc5047b0213be7fdb0195710213fa8de8a751871',
    pairId: 'team-kit-control-ui-1',
    waitTokens: ['control-ui', 'STATUS=', 'screenshot', 'UI_PROBE'],
    async seed(fixtureApp) {
      await mkdir(join(fixtureApp, 'public'), { recursive: true });
      await writeFile(
        join(fixtureApp, 'public', 'index.html'),
        `<!doctype html><html><head><title>UI Probe</title></head>
<body><main><h1>UI Probe</h1>
<button id="go">Go</button>
<p id="out" data-testid="out">idle</p>
<script>
document.getElementById('go').addEventListener('click', () => {
  document.getElementById('out').textContent = 'UI_PROBE_OK';
});
</script></body></html>
`,
      );
      await writeFile(
        join(fixtureApp, 'serve.mjs'),
        `import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = join(import.meta.dirname, 'public');
const server = http.createServer((req, res) => {
  const body = readFileSync(join(root, 'index.html'));
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(body);
});
server.listen(8765, '127.0.0.1', () => console.log('listening 8765'));
`,
      );
    },
    prompt(side, skillId, fixtureApp) {
      const outRoot = join(evidenceRoot, 'fixture-out', side, skillId);
      const done = donePath(side, skillId);
      const summary = summaryPath(side, skillId);
      const shot = join(outRoot, 'ui-harness-after.png');
      return (
        `/control-ui Do not ask questions. Follow the control-ui skill. ` +
        `Workspace is ${fixtureApp}. Start node ${join(fixtureApp, 'serve.mjs')} if needed. ` +
        `Use a local browser/CDP harness (Chrome headless is fine; do not add Playwright as a project dependency) ` +
        `to open http://127.0.0.1:8765, click the Go button, confirm #out becomes UI_PROBE_OK, ` +
        `and save a screenshot to ${shot}. Write harness notes to ${summary} including the marker UI_PROBE. ` +
        `Then write exactly one line to ${done} as ` +
        `STATUS=verified|not-verified|inconclusive|env-blocked reason=<short phrase> and stop. ` +
        `If the host cannot drive a browser, STATUS=env-blocked with the measured blocker. ` +
        `Artifacts stay under ${outRoot}. Do not edit parity ledgers.`
      );
    },
    async oracle(side, skillId) {
      const outRoot = join(evidenceRoot, 'fixture-out', side, skillId);
      const shot = join(outRoot, 'ui-harness-after.png');
      const summaryExists = await pathExists(summaryPath(side, skillId));
      const shotExists = await pathExists(shot);
      const done = await readDone(side, skillId);
      let hasProbe = false;
      if (summaryExists) {
        const text = await readFile(summaryPath(side, skillId), 'utf8');
        hasProbe = /UI_PROBE/.test(text);
      }
      return {
        shotExists,
        summaryExists,
        hasProbe,
        done,
        closed: Boolean(shotExists && summaryExists && hasProbe && done.status === 'verified'),
        honestBlocker: done.status === 'env-blocked',
      };
    },
  },
  'workflow-from-chats': {
    lockedSha256: 'b568176390165921c5e351cc73b553e3e997f92c9f85dfb1c5a220c943fbaa16',
    pairId: 'team-kit-workflow-from-chats-1',
    waitTokens: ['workflow-from-chats', 'STATUS=', 'preference', 'FIXTURE_PREF'],
    async seed(fixtureApp) {
      const chatDir = join(fixtureApp, 'synthetic-chats');
      await mkdir(chatDir, { recursive: true });
      await writeFile(
        join(chatDir, 'parent-alpha.jsonl'),
        [
          JSON.stringify({
            role: 'user',
            text: 'I prefer short commits. Always run tests before opening a PR. Never force-push.',
          }),
          JSON.stringify({
            role: 'assistant',
            text: 'Understood. I will keep commits small and test before PRs.',
          }),
          JSON.stringify({
            role: 'user',
            text: 'Stop summarizing chats. FIXTURE_PREF: encode the test-before-PR rule.',
          }),
        ].join('\n') + '\n',
      );
      await writeFile(
        join(chatDir, 'README.md'),
        'Synthetic parent transcripts for workflow-from-chats fixture. Not live Cursor paths.\n',
      );
    },
    prompt(side, skillId, fixtureApp) {
      const outRoot = join(evidenceRoot, 'fixture-out', side, skillId);
      const done = donePath(side, skillId);
      const summary = summaryPath(side, skillId);
      const ruleOut = join(outRoot, 'extracted-preferences.md');
      return (
        `/workflow-from-chats Do not ask questions. Follow the workflow-from-chats skill. ` +
        `Treat ${join(fixtureApp, 'synthetic-chats')} as the parent transcript corpus for this fixture ` +
        `(do not invent other chats). Extract durable preferences. ` +
        `Write the synthesis to ${summary} and a reusable rule draft to ${ruleOut}. ` +
        `Both must include the exact marker FIXTURE_PREF and mention test-before-PR. ` +
        `Then write exactly one line to ${done} as ` +
        `STATUS=verified|not-verified|inconclusive|env-blocked reason=<short phrase> and stop. ` +
        `Artifacts stay under ${outRoot}. Do not edit parity ledgers. Do not expose secrets.`
      );
    },
    async oracle(side, skillId) {
      const outRoot = join(evidenceRoot, 'fixture-out', side, skillId);
      const ruleOut = join(outRoot, 'extracted-preferences.md');
      const summaryExists = await pathExists(summaryPath(side, skillId));
      const ruleExists = await pathExists(ruleOut);
      const done = await readDone(side, skillId);
      let markerOk = false;
      let testPref = false;
      for (const path of [summaryPath(side, skillId), ruleOut]) {
        if (!(await pathExists(path))) continue;
        const text = await readFile(path, 'utf8');
        if (/FIXTURE_PREF/.test(text)) markerOk = true;
        if (/test[- ]before[- ]PR/i.test(text)) testPref = true;
      }
      return {
        summaryExists,
        ruleExists,
        markerOk,
        testPref,
        done,
        closed: Boolean(
          summaryExists && ruleExists && markerOk && testPref && done.status === 'verified',
        ),
        honestBlocker: done.status === 'env-blocked',
      };
    },
  },
};

function fixtureAppFor(skillId) {
  return join(evidenceRoot, 'fixture-apps', skillId);
}

function sideEvidenceRoot(skillId, side) {
  return join(evidenceRoot, skillId, side);
}

async function seedPiSkill(skillId, lockedSha) {
  const lockedSkill = join(teamKitSkills, skillId, 'SKILL.md');
  const destDir = join(fixtureAppFor(skillId), '.pi', 'skills', skillId);
  const dest = join(destDir, 'SKILL.md');
  await mkdir(destDir, { recursive: true });
  await cp(lockedSkill, dest);
  const digest = (await sha256(dest)).replace(/^sha256:/, '');
  if (digest !== lockedSha) {
    throw new Error(`Seeded Pi ${skillId} hash ${digest} != locked ${lockedSha}`);
  }
  return { path: dest, sha256: digest };
}

async function cleanGenerated(side, skillId) {
  const out = await writeRootFor(side, skillId);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath, skillId }) {
  return {
    root: sideEvidenceRoot(skillId, side),
    side,
    scenarioRef: `team-kit:${skillId}`,
    fixtureRef: { path: fixturePath, digest: fixtureDigest },
    artifactPaths: [],
    launch: { argv, cwd, env },
    geometry: GEOMETRY,
  };
}

const cursorSpec = (skillId, fixtureDigest) =>
  spec({
    side: 'cursor',
    cwd: fixtureAppFor(skillId),
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
    skillId,
  });

const piSpec = (skillId, fixtureDigest) =>
  spec({
    side: 'pi',
    cwd: fixtureAppFor(skillId),
    argv: [localBin('pi'), '--model', 'claude-subscription/claude-sonnet-5-5:medium'],
    env: {
      TERM: 'xterm-256color',
      HOME: process.env.HOME ?? '',
      PATH: process.env.PATH ?? '',
      PI_CODING_AGENT_DIR: piAgentDir,
    },
    fixtureDigest,
    fixturePath: piRulePath,
    skillId,
  });

async function restoreRule(bytes) {
  const backupPath = `${referenceRulePath}.team-kit-local-skill-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function ensurePiTrust(fixtureApp) {
  const trustPath = join(piAgentDir, 'trust.json');
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

async function waitPiChatReady(attempt, timeoutMs, skillId) {
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
      (new RegExp(skillId, 'i').test(text) ||
        /Skill conflicts|medium/i.test(text) ||
        /fixture-apps/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function waitSkillSettled(attempt, side, skillId, timeoutMs, prompt) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let calm = 0;
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observeSkill(last.join('\n'), skillId, { ignorePromptSlice: prompt });
    const done = await readDone(side, skillId);
    const enough = done.status === 'verified' || done.status === 'env-blocked' || done.status === 'not-verified';
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

async function prepareFixture(skillId, conf) {
  const fixtureApp = fixtureAppFor(skillId);
  await rm(fixtureApp, { recursive: true, force: true });
  await mkdir(fixtureApp, { recursive: true });
  await conf.seed(fixtureApp);
  return fixtureApp;
}

async function runSide(side, skillId, conf, ruleBytes, ruleDigest) {
  const dir = sideEvidenceRoot(skillId, side);
  const backupPath = `${referenceRulePath}.team-kit-local-skill-backup`;
  await mkdir(dir, { recursive: true });
  const fixtureApp = await prepareFixture(skillId, conf);
  await cleanGenerated(side, skillId);
  let seeded = null;
  if (side === 'pi') seeded = await seedPiSkill(skillId, conf.lockedSha256);
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = conf.prompt(side, skillId, fixtureApp);
  const observations = {};
  let attempt;
  try {
    await writeFile(rulePath, ruleBytes);
    if (side === 'pi') await ensurePiTrust(fixtureApp);
    attempt = await startAttempt(
      side === 'cursor' ? cursorSpec(skillId, ruleDigest) : piSpec(skillId, ruleDigest),
    );
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitPiChatReady(attempt, 120_000, skillId);
    }
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);

    attempt.input(Buffer.from(prompt), 'literal_user');
    await sleep(600);
    await dumpScreen(attempt, dir, '01-typed', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '02-submitted', GEOMETRY);

    try {
      await waitEither(attempt, GEOMETRY, conf.waitTokens, 300_000);
    } catch {
      // settle may still land artifacts
    }
    await dumpScreen(attempt, dir, '03-signal', GEOMETRY);

    const settledLines = await waitSkillSettled(attempt, side, skillId, SETTLE_MS, prompt);
    try {
      await waitSettled(attempt, GEOMETRY, 60_000);
    } catch {
      // best-effort
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '04-settled', GEOMETRY);

    const finalLines = settledLines.length ? settledLines : await screenLines(attempt, GEOMETRY);
    const ptyText = Buffer.from(outputBytes(attempt.events())).toString('utf8');
    observations.screenFinal = observeSkill(finalLines.join('\n'), skillId, {
      ignorePromptSlice: prompt,
    });
    observations.pty = observeSkill(ptyText, skillId, { ignorePromptSlice: prompt });
    observations.done = await readDone(side, skillId);
    observations.summaryExists = await pathExists(summaryPath(side, skillId));
    observations.seededSkill = seeded;
    observations.oracle = await conf.oracle(side, skillId, fixtureApp);
    const skillPath =
      Boolean(observations.screenFinal?.skillMention) || Boolean(observations.pty?.skillMention);
    observations.score = {
      skillPath,
      envBlocked: Boolean(observations.oracle?.honestBlocker),
      doneStatus: observations.done?.status ?? null,
      oracleClosed: Boolean(observations.oracle?.closed),
      closed: Boolean(observations.oracle?.closed && skillPath),
      honestBlocker: Boolean(observations.oracle?.honestBlocker && !observations.oracle?.closed),
      oracle: observations.oracle,
    };

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

async function loadSideFromDisk(skillId, side) {
  const obsPath = join(sideEvidenceRoot(skillId, side), 'observations.json');
  if (!(await pathExists(obsPath))) return null;
  const observations = JSON.parse(await readFile(obsPath, 'utf8'));
  const sideRoot = sideEvidenceRoot(skillId, side);
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

async function writePair(skillId, conf, results, preDigest, lockedSkillDigest) {
  const bySide = Object.fromEntries(results.map((r) => [r.side, r]));
  if (!bySide.cursor) bySide.cursor = await loadSideFromDisk(skillId, 'cursor');
  if (!bySide.pi) bySide.pi = await loadSideFromDisk(skillId, 'pi');
  if (!bySide.cursor || !bySide.pi) return null;
  const cursor = bySide.cursor;
  const pi = bySide.pi;
  const bothClosed =
    Boolean(cursor.observations?.score?.closed) && Boolean(pi.observations?.score?.closed);
  const pair = {
    schema: 1,
    pairId: conf.pairId,
    scenarioRef: `team-kit:${skillId}`,
    journeyFamily: 'cursor-team-kit',
    skillId,
    skillMdPath: `parity/reference/cursor-plugins/cursor-team-kit/skills/${skillId}/SKILL.md`,
    skillMdSha256: lockedSkillDigest,
    fixtureDigest: preDigest,
    steps: [
      { wait: 'ready screen (Tip: on Cursor; Pi chat ready without Trust dialog)' },
      { send: `/${skillId} ...` },
      { send: '\r' },
      { wait: 'STATUS=verified with skill oracle, or STATUS=env-blocked' },
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
      seededSkill: pi.observations?.seededSkill ?? null,
      observations: pi.observations?.score ?? null,
    },
    skillClosure: {
      [skillId]: bothClosed ? 'closed_by_this_pair' : 'open',
    },
    note:
      'Cursor loads locked team-kit via --plugin-dir. Pi seeds the same SKILL.md bytes under .pi/skills/<skill>/.',
    verdict: bothClosed ? 'pass' : 'fail',
  };
  const pairPath = join(evidenceRoot, `pair-${conf.pairId}.json`);
  await writeFile(pairPath, `${JSON.stringify(pair, null, 2)}\n`, { flag: 'w' });
  return pairPath;
}

if (isMain) {
  const { skill, only } = parseArgs(process.argv.slice(2));
  if (!skill || !SKILLS[skill]) {
    console.error(
      `Usage: node parity/scripts/capture-team-kit-local-skill.mjs --skill=<${Object.keys(SKILLS).join('|')}> [--both|--cursor-only|--pi-only]`,
    );
    process.exit(2);
  }
  const conf = SKILLS[skill];
  const lockedSkill = join(teamKitSkills, skill, 'SKILL.md');
  const preRule = await readFile(referenceRulePath, 'utf8');
  const preDigest = await sha256(referenceRulePath);
  if (preDigest !== LOCKED_FIXTURE_DIGEST) {
    console.error(
      `Reference rule digest ${preDigest} does not match the locked fixture ${LOCKED_FIXTURE_DIGEST}`,
    );
    process.exit(1);
  }
  const lockedSkillDigest = (await sha256(lockedSkill)).replace(/^sha256:/, '');
  if (lockedSkillDigest !== conf.lockedSha256) {
    console.error(`Locked ${skill} SKILL.md hash drift: ${lockedSkillDigest}`);
    process.exit(1);
  }
  const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
  const results = [];
  for (const side of sides) {
    const result = await runSide(side, skill, conf, preRule, preDigest);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  const pairPath = await writePair(skill, conf, results, preDigest, lockedSkillDigest);
  await writeFile(
    join(evidenceRoot, `capture-results-${skill}.json`),
    `${JSON.stringify({ scenario: `team-kit:${skill}`, fixtureDigest: preDigest, pairPath, results }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      scenario: `team-kit:${skill}`,
      fixtureDigest: preDigest,
      pairPath,
      results: results.map((r) => ({
        side: r.side,
        attemptId: r.attemptId,
        closed: r.observations.score.closed,
        doneStatus: r.observations.score.doneStatus,
        skillPath: r.observations.score.skillPath,
        oracleClosed: r.observations.score.oracleClosed,
        honestBlocker: r.observations.score.honestBlocker,
      })),
    }),
  );
}
