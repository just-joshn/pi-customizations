#!/usr/bin/env node
// Family 13 create-verify capture:
//   default: generate, then a second turn that rediscovers and reuses the skill
//   --interview: interview from repo, write interview.json, generate skill+feature map; skip prove/maintain/reuse
//   --prove: generate, then live prove (launch/doctor/drive/evidence/cleanup); skip maintain
//   --maintain: generate, live prove, offer maintain; second turn runs /maintain-verification-skill
// Real PTY both sides via the recorder.
//
// Usage:
//   node scripts/capture-create-verify-reuse.mjs [--cursor-only|--pi-only|--both]
//   node scripts/capture-create-verify-reuse.mjs --interview [--cursor-only|--pi-only|--both]
//   node scripts/capture-create-verify-reuse.mjs --prove [--cursor-only|--pi-only|--both]
//   node scripts/capture-create-verify-reuse.mjs --maintain [--cursor-only|--pi-only|--both]
// Evidence root: parity/evidence/create-verify/
import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const argvFlags = new Set(process.argv.slice(2));
const maintainMode = argvFlags.has('--maintain');
const interviewMode = argvFlags.has('--interview');
const proveMode = argvFlags.has('--prove') || maintainMode;
const only = argvFlags.has('--cursor-only')
  ? '--cursor-only'
  : argvFlags.has('--pi-only')
    ? '--pi-only'
    : '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'create-verify');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const SETTLE_MS = 1_500_000;
const PROVE_SETTLE_MS = 1_800_000;
const MAINTAIN_SETTLE_MS = 2_400_000;
const SKILL_NAME = 'verify-hello-cli';
const SCENARIO_REF = maintainMode
  ? 'create-verify:generate-prove-offer-maintain'
  : proveMode
    ? 'create-verify:generate-then-prove'
    : interviewMode
      ? 'setup-create-verify-interview'
      : 'create-verify:generate-then-reuse';
if (interviewMode && (proveMode || maintainMode)) {
  console.error('Use only one of --interview, --prove, --maintain');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function skillRel(side) {
  return side === 'cursor'
    ? join('.cursor', 'skills', SKILL_NAME, 'SKILL.md')
    : join('.pi', 'skills', SKILL_NAME, 'SKILL.md');
}

function skillAbs(side) {
  return join(fixtureApp, skillRel(side));
}

function writeRootFor(side) {
  return join(evidenceRoot, 'fixture-out', side);
}

function reusePath(side) {
  return join(writeRootFor(side), 'reuse.txt');
}

function maintainOutcomePath(side) {
  return join(writeRootFor(side), 'maintain-outcome.txt');
}

function interviewPath(side) {
  return join(writeRootFor(side), 'interview.json');
}

function featureMapPaths(side) {
  const skillDir = join(fixtureApp, side === 'cursor' ? '.cursor' : '.pi', 'skills', SKILL_NAME);
  return {
    readme: join(skillDir, 'features', 'README.md'),
    featureDir: join(skillDir, 'features'),
  };
}

function createPrompt(side) {
  const skillPath = skillRel(side);
  if (interviewMode) {
    const out = interviewPath(side);
    return (
      `/create-verification-skill for this tiny hello-cli only. ` +
      `Interview the repository yourself. Answer Surface, Run, Drive, Observe, and Isolate from files in this cwd. ` +
      `Do not ask the user for any of those five answers when the files already show them. ` +
      `Before writing the skill, write JSON to ${out} with exactly these keys: ` +
      `surface, run, drive, observe, isolate (non-empty strings), ` +
      `evidencePaths (array of relative paths you read), ` +
      `askedUser (boolean), askedUserAbout (array; empty when askedUser is false), ` +
      `baseBuildsOrReported (boolean; true if ./hello.sh works or you reported the break precisely). ` +
      `Then write ${skillPath} with YAML frontmatter name: ${SKILL_NAME} and a real description. ` +
      `Fill Launch, Doctor, Drive, Evidence, Cleanup, and Helpers as ## headings grounded in the interview. ` +
      `Helpers may be the single word None if no helper scripts ship. ` +
      `Every section body must be real text with no TODO or placeholder wording. ` +
      `Cleanup must not kill by process name and must not delete named proof artifacts. ` +
      `Seed features/README.md plus one feature file for the hello print. ` +
      `Skip the live prove-the-skill step and skip the maintain offer. ` +
      `When ${out}, the skill, and the feature map are on disk, list their absolute paths and stop. ` +
      `Do not edit ledgers, parity/, or product package code outside this fixture cwd.`
    );
  }
  if (maintainMode) {
    return (
      `/create-verification-skill for this tiny hello-cli only. ` +
      `Interview from README.md and hello.sh in the cwd. ` +
      `Write ${skillPath} with YAML frontmatter name: ${SKILL_NAME} and a real description. ` +
      `Fill Launch, Doctor, Drive, Evidence, Cleanup, and Helpers as ## headings from ./hello.sh (prints HELLO-FAMILY-13). ` +
      `Helpers may be the single word None if no helper scripts ship. ` +
      `Every section body must be real text with no TODO or placeholder wording. ` +
      `Cleanup must not kill by process name and must not delete named proof artifacts. ` +
      `Seed features/README.md plus one feature file for the hello print. ` +
      `After the skill and feature map are on disk, run the live prove step once end to end: ` +
      `launch, doctor, drive the hello-print feature, capture evidence at the location the skill names, then cleanup. ` +
      `After cleanup, confirm the evidence files still exist at that named location. ` +
      `Prefer the smallest prove path (./hello.sh stdout HELLO-FAMILY-13, exit 0). ` +
      `After prove succeeds, offer the maintenance loop by pointing at /maintain-verification-skill. ` +
      `Do not suggest a cadence unless asked. Do not run /maintain-verification-skill yet. ` +
      `When the offer is on screen, list the absolute paths of the skill and the surviving evidence files and stop. ` +
      `Do not edit ledgers, parity/, or product package code outside this fixture cwd.`
    );
  }
  if (proveMode) {
    return (
      `/create-verification-skill for this tiny hello-cli only. ` +
      `Interview from README.md and hello.sh in the cwd. ` +
      `Write ${skillPath} with YAML frontmatter name: ${SKILL_NAME} and a real description. ` +
      `Fill Launch, Doctor, Drive, Evidence, Cleanup, and Helpers as ## headings from ./hello.sh (prints HELLO-FAMILY-13). ` +
      `Helpers may be the single word None if no helper scripts ship. ` +
      `Every section body must be real text with no TODO or placeholder wording. ` +
      `Cleanup must not kill by process name and must not delete named proof artifacts. ` +
      `Seed features/README.md plus one feature file for the hello print. ` +
      `After the skill and feature map are on disk, run the live prove step once end to end: ` +
      `launch, doctor, drive the hello-print feature, capture evidence at the location the skill names, then cleanup. ` +
      `After cleanup, confirm the evidence files still exist at that named location. ` +
      `Prefer the smallest prove path (./hello.sh stdout HELLO-FAMILY-13, exit 0). ` +
      `Skip the maintain-verification-skill offer entirely. Do not mention maintain unless you must refuse it. ` +
      `When prove is finished, list the absolute paths of the skill and the surviving evidence files and stop. ` +
      `Do not edit ledgers, parity/, or product package code outside this fixture cwd.`
    );
  }
  return (
    `/create-verification-skill for this tiny hello-cli only. ` +
    `Interview from README.md and hello.sh in the cwd. ` +
    `Write ${skillPath} with YAML frontmatter name: ${SKILL_NAME} and a real description. ` +
    `Fill Launch, Doctor, Drive, Evidence, Cleanup, and Helpers as ## headings from ./hello.sh (prints HELLO-FAMILY-13). ` +
    `Helpers may be the single word None if no helper scripts ship. ` +
    `Every section body must be real text with no TODO or placeholder wording. ` +
    `Cleanup must not kill by process name and must not delete named proof artifacts. ` +
    `Seed features/README.md plus one feature file for the hello print. ` +
    `Skip the live prove-the-skill step and skip the maintain offer. ` +
    `When the skill files are on disk, list their absolute paths and stop. ` +
    `Do not edit ledgers, parity/, or product package code outside this fixture cwd.`
  );
}

function reusePrompt(side) {
  const out = reusePath(side);
  const skillPath = skillAbs(side);
  return (
    `Second turn reuse. Discover the ${SKILL_NAME} skill you just generated at ${skillPath}. ` +
    `Do not regenerate it. Read its Launch or Doctor section, then write exactly one line to ${out}: ` +
    `REUSED=${skillPath}. Stop after that write.`
  );
}

function maintainPrompt(side) {
  const out = maintainOutcomePath(side);
  const skillPath = skillAbs(side);
  return (
    `Second turn maintain. Run /maintain-verification-skill against the existing ${SKILL_NAME} skill at ${skillPath}. ` +
    `Do not regenerate the skill from scratch. Only edit that skill directory. Never edit product code (hello.sh, README.md). ` +
    `Complete one maintain pass end to end for this tiny hello-cli (one feature). ` +
    `Report exactly one outcome among clean, changed, or blocked. ` +
    `Write exactly one line to ${out}: OUTCOME=clean or OUTCOME=changed or OUTCOME=blocked. ` +
    `Stop after that write.`
  );
}

function observeCreate(lines) {
  const text = lines.join('\n');
  return {
    createVerifySkill:
      /create-verification-skill/i.test(text) ||
      /\[skill\]\s*create-verification/i.test(text) ||
      /verify-hello-cli/i.test(text),
    wroteSkill: /SKILL\.md|verify-hello-cli|frontmatter|Launch|Doctor/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function observeProve(lines) {
  const text = lines.join('\n');
  return {
    proveMention:
      /live prove|prove step|prove the|running (launch|doctor|drive)|Launch.*Doctor|HELLO-FAMILY-13|artifacts\/hello|\.pi\/evidence/i.test(
        text,
      ),
    maintainMention: /maintain-verification-skill|\/maintain-verification/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function proofCandidatesFor(side) {
  const hostFirst =
    side === 'cursor'
      ? [
          {
            dir: join(fixtureApp, '.cursor', 'skills', SKILL_NAME, 'evidence'),
            stdout: 'hello-stdout.txt',
            stderr: 'hello-stderr.txt',
            exit: 'hello-exit-code.txt',
          },
          {
            dir: join(fixtureApp, '.cursor', 'evidence', 'verify-hello-cli'),
            stdout: 'stdout.txt',
            stderr: 'stderr.txt',
            exit: 'exit-code.txt',
          },
          {
            dir: join(fixtureApp, '.cursor', 'skills', SKILL_NAME, 'evidence'),
            stdout: 'stdout.txt',
            stderr: 'stderr.txt',
            exit: 'exit-code.txt',
          },
        ]
      : [
          {
            dir: join(fixtureApp, '.pi', 'skills', SKILL_NAME, 'evidence', 'hello-print'),
            stdout: 'stdout.txt',
            stderr: 'stderr.txt',
            exit: 'exit-code.txt',
          },
          {
            dir: join(fixtureApp, '.pi', 'skills', SKILL_NAME, 'evidence'),
            stdout: 'hello-stdout.txt',
            stderr: 'hello-stderr.txt',
            exit: 'hello-exit-code.txt',
          },
          {
            dir: join(fixtureApp, '.pi', 'evidence', 'verify-hello-cli'),
            stdout: 'stdout.txt',
            stderr: 'stderr.txt',
            exit: 'exit-code.txt',
          },
          {
            dir: join(fixtureApp, '.pi', 'skills', SKILL_NAME, 'evidence'),
            stdout: 'stdout.txt',
            stderr: 'stderr.txt',
            exit: 'exit-code.txt',
          },
        ];
  return [
    ...hostFirst,
    {
      dir: join(fixtureApp, 'artifacts', 'hello'),
      stdout: 'stdout.txt',
      stderr: 'stderr.txt',
      exit: 'exit-code.txt',
    },
    {
      dir: join(fixtureApp, 'evidence', 'verify-hello-cli'),
      stdout: 'stdout.txt',
      stderr: 'stderr.txt',
      exit: 'exit-code.txt',
    },
  ];
}

async function readProofArtifacts(side = null) {
  const candidates = side ? proofCandidatesFor(side) : [
    ...proofCandidatesFor('cursor'),
    ...proofCandidatesFor('pi'),
  ];
  for (const candidate of candidates) {
    const stdoutPath = join(candidate.dir, candidate.stdout);
    if (!(await pathExists(stdoutPath))) continue;
    const stdout = await readFile(stdoutPath, 'utf8');
    const stdoutOk = /^HELLO-FAMILY-13\n$/.test(stdout) || stdout.trim() === 'HELLO-FAMILY-13';
    const exitPath = join(candidate.dir, candidate.exit);
    let exitOk = false;
    let exitRaw = null;
    if (await pathExists(exitPath)) {
      exitRaw = (await readFile(exitPath, 'utf8')).trim();
      exitOk = exitRaw === '0';
    }
    const stderrPath = join(candidate.dir, candidate.stderr);
    let stderrOk = true;
    if (await pathExists(stderrPath)) {
      stderrOk = (await readFile(stderrPath, 'utf8')).length === 0;
    }
    return {
      exists: true,
      dir: candidate.dir,
      stdoutPath,
      stdoutOk,
      exitOk,
      exitRaw,
      stderrOk,
      pass: stdoutOk && exitOk && stderrOk,
    };
  }
  return {
    exists: false,
    dir: null,
    stdoutPath: null,
    stdoutOk: false,
    exitOk: false,
    exitRaw: null,
    stderrOk: false,
    pass: false,
  };
}

function observeReuse(lines) {
  const text = lines.join('\n');
  return {
    reuseMention: /REUSED=|reuse\.txt|Second turn|rediscover|Discover the verify/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function observeMaintain(lines) {
  const text = lines.join('\n');
  const outcomeMatch = text.match(/\bOUTCOME\s*=\s*(clean|changed|blocked)\b/i);
  return {
    maintainCommand:
      /maintain-verification-skill|\/maintain-verification/i.test(text) ||
      /\[skill\]\s*maintain-verification/i.test(text),
    outcomeMention: outcomeMatch ? outcomeMatch[1].toLowerCase() : null,
    cleanMention: /\bclean\b/i.test(text),
    changedMention: /\bchanged\b/i.test(text),
    blockedMention: /\bblocked\b/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const REQUIRED_SECTIONS = ['Launch', 'Doctor', 'Drive', 'Evidence', 'Cleanup', 'Helpers'];

function hasSectionHeading(body, name) {
  const re = new RegExp(`^##\\s+${name}\\s*$`, 'mi');
  return re.test(body);
}

async function readSkillMeta(side) {
  const path = skillAbs(side);
  if (!(await pathExists(path))) {
    return {
      exists: false,
      path,
      nameOk: false,
      hasDescription: false,
      hasLaunch: false,
      hasHelpers: false,
      sectionsOk: false,
      missingSections: REQUIRED_SECTIONS.slice(),
      hasTodoPlaceholder: false,
      body: null,
    };
  }
  const body = await readFile(path, 'utf8');
  const missingSections = REQUIRED_SECTIONS.filter((name) => !hasSectionHeading(body, name));
  return {
    exists: true,
    path,
    nameOk: /name:\s*verify-hello-cli/.test(body),
    hasDescription: /^description:\s*\S+/m.test(body),
    hasLaunch: hasSectionHeading(body, 'Launch'),
    hasHelpers: hasSectionHeading(body, 'Helpers'),
    sectionsOk: missingSections.length === 0,
    missingSections,
    hasTodoPlaceholder: /\bTODO\b/i.test(body) || /\bTBD\b/.test(body) || /placeholder/i.test(body),
    bodyPreview: body.slice(0, 400),
  };
}

async function readReuse(side) {
  const path = reusePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null, ok: false };
  const line = (await readFile(path, 'utf8')).trim();
  const expected = `REUSED=${skillAbs(side)}`;
  return { exists: true, path, line, ok: line === expected || line.startsWith('REUSED=') };
}

async function readMaintainOutcome(side) {
  const path = maintainOutcomePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null, outcome: null, ok: false };
  const line = (await readFile(path, 'utf8')).trim();
  const match = line.match(/^OUTCOME=(clean|changed|blocked)$/i);
  const outcome = match ? match[1].toLowerCase() : null;
  return { exists: true, path, line, outcome, ok: Boolean(outcome) };
}

function interviewAnswersFromRepo(data) {
  const keys = ['surface', 'run', 'drive', 'observe', 'isolate'];
  const missing = keys.filter((k) => typeof data?.[k] !== 'string' || !data[k].trim());
  const evidencePaths = Array.isArray(data?.evidencePaths)
    ? data.evidencePaths.map((p) => String(p))
    : [];
  const evidenceJoined = evidencePaths.join('\n').toLowerCase();
  const readRepoFiles =
    /readme\.md/.test(evidenceJoined) ||
    /hello\.sh/.test(evidenceJoined) ||
    evidencePaths.some((p) => /(^|\/)(README\.md|hello\.sh)$/i.test(p));
  const askedUser = Boolean(data?.askedUser);
  const askedUserAbout = Array.isArray(data?.askedUserAbout)
    ? data.askedUserAbout.map((x) => String(x).toLowerCase())
    : [];
  const askedAboutObservable = askedUserAbout.some((topic) =>
    /surface|run|drive|observe|isolate|how (does|do) (it|the app) start|what (surface|cli)/i.test(
      topic,
    ),
  );
  const baseBuildsOrReported = data?.baseBuildsOrReported === true;
  return {
    keysOk: missing.length === 0,
    missing,
    evidencePaths,
    readRepoFiles,
    askedUser,
    askedUserAbout,
    askedAboutObservable,
    baseBuildsOrReported,
    ok:
      missing.length === 0 &&
      readRepoFiles &&
      baseBuildsOrReported &&
      (!askedUser || !askedAboutObservable),
  };
}

async function readInterview(side) {
  const path = interviewPath(side);
  if (!(await pathExists(path))) {
    return { exists: false, path, data: null, ...interviewAnswersFromRepo(null), ok: false };
  }
  try {
    const raw = await readFile(path, 'utf8');
    const data = JSON.parse(raw);
    const judged = interviewAnswersFromRepo(data);
    return { exists: true, path, data, ...judged };
  } catch (error) {
    return {
      exists: true,
      path,
      data: null,
      parseError: String(error?.message ?? error),
      ...interviewAnswersFromRepo(null),
      ok: false,
    };
  }
}

async function readFeatureMap(side) {
  const paths = featureMapPaths(side);
  const readmeExists = await pathExists(paths.readme);
  let featureFiles = [];
  if (await pathExists(paths.featureDir)) {
    const { readdir } = await import('node:fs/promises');
    featureFiles = (await readdir(paths.featureDir)).filter(
      (name) => name.endsWith('.md') && name !== 'README.md',
    );
  }
  return {
    readmeExists,
    featureFiles,
    ok: readmeExists && featureFiles.length >= 1,
    paths,
  };
}

function observeInterview(lines) {
  const text = lines.join('\n');
  return {
    interviewMention:
      /interview\.json|Surface|Run|Drive|Observe|Isolate|evidencePaths|askedUser/i.test(text),
    askedUserOnScreen:
      /what (is|are) (the )?(surface|run command|primary surface)|how does (the )?app start|which surface should I/i.test(
        text,
      ),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

async function cleanGenerated(side) {
  // Clear both host skill trees so leftover proof from the other host cannot
  // satisfy this side's on-disk oracle.
  await rm(join(fixtureApp, '.cursor', 'skills', SKILL_NAME), { recursive: true, force: true });
  await rm(join(fixtureApp, '.pi', 'skills', SKILL_NAME), { recursive: true, force: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(reusePath(side), { force: true });
  await rm(maintainOutcomePath(side), { force: true });
  await rm(interviewPath(side), { force: true });
  await rm(join(fixtureApp, 'artifacts'), { recursive: true, force: true });
  await rm(join(fixtureApp, '.pi', 'evidence'), { recursive: true, force: true });
  await rm(join(fixtureApp, '.cursor', 'evidence'), { recursive: true, force: true });
  await rm(join(fixtureApp, 'evidence'), { recursive: true, force: true });
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: SCENARIO_REF,
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
  const backupPath = `${referenceRulePath}.create-verify-reuse-backup`;
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
      (/fixture-app|hello-cli|Skill conflicts/i.test(text) || /medium/i.test(text));
    if (chatReady) return lines;
    await sleep(200);
  }
  throw new Error(`Pi chat not ready within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

async function waitSkillOnDisk(side, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const meta = await readSkillMeta(side);
    if (meta.exists && meta.nameOk && meta.sectionsOk && !meta.hasTodoPlaceholder) return meta;
    await sleep(800);
  }
  return readSkillMeta(side);
}

async function waitInterviewOnDisk(side, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const interview = await readInterview(side);
    if (interview.ok) return interview;
    await sleep(800);
  }
  return readInterview(side);
}

async function waitInterviewSettled(attempt, side, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let calm = 0;
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observeInterview(last);
    const meta = await readSkillMeta(side);
    const interview = await readInterview(side);
    const featureMap = await readFeatureMap(side);
    if (
      interview.ok &&
      meta.exists &&
      meta.nameOk &&
      meta.sectionsOk &&
      !meta.hasTodoPlaceholder &&
      featureMap.ok &&
      !obs.working
    ) {
      calm += 1;
      if (calm >= 3) return last;
    } else {
      calm = 0;
    }
    await sleep(800);
  }
  return last;
}

async function waitReuseOnDisk(side, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const reuse = await readReuse(side);
    if (reuse.ok) return reuse;
    await sleep(800);
  }
  return readReuse(side);
}

async function waitCreateSettled(attempt, side, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let calm = 0;
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observeCreate(last);
    const meta = await readSkillMeta(side);
    if (meta.exists && meta.nameOk && meta.hasHelpers && !obs.working) {
      calm += 1;
      if (calm >= 3) return last;
    } else {
      calm = 0;
    }
    await sleep(800);
  }
  return last;
}

async function waitProveSettled(attempt, side, timeoutMs, { requireMaintainOffer = false } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let calm = 0;
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observeProve(last);
    const meta = await readSkillMeta(side);
    const proof = await readProofArtifacts(side);
    const offerOk = !requireMaintainOffer || obs.maintainMention;
    if (meta.exists && meta.nameOk && meta.sectionsOk && proof.pass && offerOk && !obs.working) {
      calm += 1;
      if (calm >= 3) return last;
    } else {
      calm = 0;
    }
    await sleep(1000);
  }
  return last;
}

async function waitMaintainSettled(attempt, side, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let calm = 0;
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observeMaintain(last);
    const outcome = await readMaintainOutcome(side);
    if (outcome.ok && !obs.working) {
      calm += 1;
      if (calm >= 2) return last;
    } else {
      calm = 0;
    }
    await sleep(1000);
  }
  return last;
}

async function waitMaintainOutcomeOnDisk(side, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const outcome = await readMaintainOutcome(side);
    if (outcome.ok) return outcome;
    await sleep(800);
  }
  return readMaintainOutcome(side);
}

async function waitProofOnDisk(side, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const proof = await readProofArtifacts(side);
    if (proof.pass) return proof;
    await sleep(800);
  }
  return readProofArtifacts(side);
}

async function waitReuseSettled(attempt, side, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let calm = 0;
  while (Date.now() < deadline) {
    last = await screenLines(attempt, GEOMETRY);
    const obs = observeReuse(last);
    const reuse = await readReuse(side);
    if (reuse.ok && !obs.working) {
      calm += 1;
      if (calm >= 2) return last;
    } else {
      calm = 0;
    }
    await sleep(800);
  }
  return last;
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.create-verify-reuse-backup`;
  await mkdir(dir, { recursive: true });
  await cleanGenerated(side);
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const observations = {};
  const prompt1 = createPrompt(side);
  const prompt2 = interviewMode
    ? null
    : maintainMode
      ? maintainPrompt(side)
      : proveMode
        ? null
        : reusePrompt(side);
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

    attempt.input(Buffer.from(prompt1), 'literal_user');
    await sleep(600);
    await dumpScreen(attempt, dir, '01-create-typed', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '02-create-submitted', GEOMETRY);

    try {
      await waitEither(
        attempt,
        GEOMETRY,
        [
          'create-verification',
          'verify-hello-cli',
          'SKILL.md',
          'Launch',
          'Doctor',
          'Interview',
          'interview.json',
          'feature',
          'HELLO-FAMILY-13',
          'prove',
          'maintain-verification',
        ],
        300_000,
      );
    } catch {
      // final settle may still land the skill / proof
    }
    await dumpScreen(attempt, dir, '03-create-signal', GEOMETRY);
    observations.createMid = observeCreate(await screenLines(attempt, GEOMETRY));
    observations.skillMid = await readSkillMeta(side);
    observations.proofMid = await readProofArtifacts(side);
    observations.interviewMid = await readInterview(side);

    if (interviewMode) {
      const interviewLines = await waitInterviewSettled(attempt, side, SETTLE_MS);
      await waitInterviewOnDisk(side, 60_000);
      await waitSkillOnDisk(side, 60_000);
      try {
        await waitSettled(attempt, GEOMETRY, 60_000);
      } catch {
        // best-effort
      }
      await sleep(1500);
      await dumpScreen(attempt, dir, '04-interview-settled', GEOMETRY);
      const finalLines = interviewLines.length
        ? interviewLines
        : await screenLines(attempt, GEOMETRY);
      observations.createFinal = observeCreate(finalLines);
      observations.interviewFinal = observeInterview(finalLines);
      observations.skillAfterCreate = await readSkillMeta(side);
      observations.interview = await readInterview(side);
      observations.featureMap = await readFeatureMap(side);
      observations.interviewOk = Boolean(observations.interview?.ok);
      observations.featureMapOk = Boolean(observations.featureMap?.ok);
      observations.askedUserOnScreen = Boolean(observations.interviewFinal?.askedUserOnScreen);
    } else if (proveMode) {
      const proveLines = await waitProveSettled(attempt, side, PROVE_SETTLE_MS, {
        requireMaintainOffer: maintainMode,
      });
      await waitSkillOnDisk(side, 60_000);
      await waitProofOnDisk(side, 60_000);
      try {
        await waitSettled(attempt, GEOMETRY, 60_000);
      } catch {
        // best-effort
      }
      await sleep(1500);
      await dumpScreen(attempt, dir, '04-prove-settled', GEOMETRY);
      const finalLines = proveLines.length ? proveLines : await screenLines(attempt, GEOMETRY);
      observations.createFinal = observeCreate(finalLines);
      observations.proveFinal = observeProve(finalLines);
      observations.skillAfterCreate = await readSkillMeta(side);
      observations.proofAfter = await readProofArtifacts(side);
      observations.liveProvePassed = Boolean(observations.proofAfter?.pass);
      observations.maintainOffered = Boolean(observations.proveFinal?.maintainMention);
      if (observations.proofAfter?.exists && observations.proofAfter.dir) {
        const proofCopy = join(writeRootFor(side), 'proof');
        await rm(proofCopy, { recursive: true, force: true });
        await cp(observations.proofAfter.dir, proofCopy, { recursive: true });
        observations.proofCopyPath = proofCopy;
      }

      if (maintainMode) {
        attempt.input(Buffer.from(prompt2), 'literal_user');
        await sleep(600);
        await dumpScreen(attempt, dir, '05-maintain-typed', GEOMETRY);
        attempt.input(Buffer.from('\r'), 'literal_user');
        await sleep(2000);
        await dumpScreen(attempt, dir, '06-maintain-submitted', GEOMETRY);

        const maintainLines = await waitMaintainSettled(attempt, side, MAINTAIN_SETTLE_MS);
        await waitMaintainOutcomeOnDisk(side, 60_000);
        try {
          await waitSettled(attempt, GEOMETRY, 60_000);
        } catch {
          // best-effort
        }
        await sleep(1500);
        await dumpScreen(attempt, dir, '07-maintain-settled', GEOMETRY);
        const maintainFinalLines = maintainLines.length
          ? maintainLines
          : await screenLines(attempt, GEOMETRY);
        observations.maintainFinal = observeMaintain(maintainFinalLines);
        observations.maintainOutcome = await readMaintainOutcome(side);
        observations.skillAfterMaintain = await readSkillMeta(side);
        observations.maintainRan = Boolean(
          observations.maintainFinal?.maintainCommand || observations.maintainOutcome?.ok,
        );
        observations.maintainOutcomeOk = Boolean(observations.maintainOutcome?.ok);
      }
    } else {
      const createLines = await waitCreateSettled(attempt, side, SETTLE_MS);
      await waitSkillOnDisk(side, 60_000);
      try {
        await waitSettled(attempt, GEOMETRY, 60_000);
      } catch {
        // best-effort
      }
      await sleep(1500);
      await dumpScreen(attempt, dir, '04-create-settled', GEOMETRY);
      observations.createFinal = observeCreate(
        createLines.length ? createLines : await screenLines(attempt, GEOMETRY),
      );
      observations.skillAfterCreate = await readSkillMeta(side);

      attempt.input(Buffer.from(prompt2), 'literal_user');
      await sleep(600);
      await dumpScreen(attempt, dir, '05-reuse-typed', GEOMETRY);
      attempt.input(Buffer.from('\r'), 'literal_user');
      await sleep(2000);
      await dumpScreen(attempt, dir, '06-reuse-submitted', GEOMETRY);

      const reuseLines = await waitReuseSettled(attempt, side, SETTLE_MS);
      await waitReuseOnDisk(side, 60_000);
      try {
        await waitSettled(attempt, GEOMETRY, 60_000);
      } catch {
        // best-effort
      }
      await sleep(1500);
      await dumpScreen(attempt, dir, '07-reuse-settled', GEOMETRY);
      observations.reuseFinal = observeReuse(
        reuseLines.length ? reuseLines : await screenLines(attempt, GEOMETRY),
      );
      observations.skillAfterReuse = await readSkillMeta(side);
      observations.reuse = await readReuse(side);
    }

    const after = await readFile(rulePath, 'utf8');
    const afterDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), after);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt-create.txt'), `${prompt1}\n`);
    if (prompt2) {
      const prompt2Name = maintainMode ? 'prompt-maintain.txt' : 'prompt-reuse.txt';
      await writeFile(join(dir, prompt2Name), `${prompt2}\n`);
    }
    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      ruleUnchanged: after === ruleBytes,
      afterDigest,
      fixtureDigest: ruleDigest,
      prompt1,
      prompt2,
      observations,
      proveMode,
      maintainMode,
      interviewMode,
    };
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
    await restoreRule(ruleBytes);
  }
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
  const result = await runSide(side, preRule, preDigest);
  results.push(result);
  console.log(JSON.stringify(result));
}
console.log(
  JSON.stringify({
    scenario: SCENARIO_REF,
    interviewMode,
    proveMode,
    maintainMode,
    fixtureDigest: preDigest,
    results,
  }),
);
